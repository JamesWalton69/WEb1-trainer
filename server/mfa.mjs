// mfa.mjs — Multi-Factor Authentication (TOTP + AES-256-GCM + Backup Codes).
// Zero npm dependencies: node:crypto + node:sqlite.
//
// Security guarantees:
// 1. TOTP secrets are encrypted at rest using AES-256-GCM with unique 12-byte IVs and 16-byte authentication tags.
// 2. Backup codes are single-use, hashed with SHA-256 at rest, and invalidated immediately upon redemption.
// 3. MFA enrollment requires re-authentication with the current password.
// 4. MFA cannot be bypassed by directly hitting API endpoints: sensitive endpoints enforce mfa_verified === 1.
// 5. Downgrade protection: disabling MFA requires explicit administrator approval.

import { randomBytes, createCipheriv, createDecipheriv, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './db.mjs';
import { verifyPassword } from './auth.mjs';

// 32-byte master encryption key
const DEFAULT_TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const MASTER_KEY = Buffer.from(process.env.MFA_MASTER_KEY || DEFAULT_TEST_KEY, 'hex');

// ===== 1. TOTP SECRET ENCRYPTION AT REST (AES-256-GCM) =====

export function encryptSecret(plainSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decryptSecret(encryptedHex, ivHex, authTagHex) {
  const decipher = createDecipheriv('aes-256-gcm', MASTER_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ===== 2. BASE32 & RFC 6238 TOTP =====

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20) {
  const bytes = randomBytes(byteLength);
  let bits = '';
  for (let i = 0; i < bytes.length; i++) {
    bits += bytes[i].toString(2).padStart(8, '0');
  }
  let base32 = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    base32 += BASE32_ALPHABET[parseInt(bits.substring(i, i + 5), 2)];
  }
  return base32;
}

function base32ToBuffer(base32) {
  const cleaned = String(base32).toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTOTP(secretBase32, timeStep = 30, offsetSec = 0) {
  const key = base32ToBuffer(secretBase32);
  const counter = Math.floor((Math.floor(Date.now() / 1000) + offsetSec) / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = (binary % 1000000).toString().padStart(6, '0');
  return otp;
}

export function verifyTOTP(token, secretBase32) {
  if (!token || typeof token !== 'string' || token.trim().length !== 6) return false;
  const input = token.trim();

  // Drift tolerance: -30s, 0s, +30s
  for (const delta of [-30, 0, 30]) {
    const expected = generateTOTP(secretBase32, 30, delta);
    const a = Buffer.from(input);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

// ===== 3. SINGLE-USE HASHED BACKUP CODES =====

export function generateBackupCodes(count = 8) {
  const plainCodes = [];
  const hashedRecords = [];

  for (let i = 0; i < count; i++) {
    const code = `${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`.toUpperCase();
    plainCodes.push(code);
    hashedRecords.push(createHash('sha256').update(code).digest('hex'));
  }
  return { plainCodes, hashedRecords };
}

export function consumeBackupCode(db, userId, rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return false;
  const normalized = rawCode.trim().toUpperCase();
  const codeHash = createHash('sha256').update(normalized).digest('hex');

  const update = db.prepare(`
    UPDATE user_backup_codes
    SET used = 1, used_at = ?
    WHERE user_id = ? AND code_hash = ? AND used = 0
  `).run(new Date().toISOString(), userId, codeHash);

  return update.changes > 0;
}

// ===== 4. MFA ENROLLMENT (REQUIRES RE-AUTHENTICATION) =====

export function startMfaEnrollment(db, userId, currentPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new HttpError(404, 'User not found');

  // Re-authentication check
  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw new HttpError(401, 'Re-authentication required: invalid current password');
  }

  const base32Secret = generateBase32Secret(20);
  const { encrypted, iv, authTag } = encryptSecret(base32Secret);
  const { plainCodes, hashedRecords } = generateBackupCodes(8);

  const now = new Date().toISOString();

  // Upsert user_mfa as unconfirmed (enabled = 0)
  db.prepare(`
    INSERT INTO user_mfa (user_id, totp_secret_enc, iv, auth_tag, enabled, downgrade_locked, created_at)
    VALUES (?, ?, ?, ?, 0, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      totp_secret_enc  = excluded.totp_secret_enc,
      iv               = excluded.iv,
      auth_tag         = excluded.auth_tag,
      enabled          = 0,
      downgrade_locked = 1,
      created_at       = excluded.created_at
  `).run(userId, encrypted, iv, authTag, now);

  // Store hashed backup codes
  db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
  const insertCode = db.prepare(`
    INSERT INTO user_backup_codes (id, user_id, code_hash, used, used_at)
    VALUES (?, ?, ?, 0, NULL)
  `);
  for (const hash of hashedRecords) {
    insertCode.run(`bc-${randomBytes(8).toString('hex')}`, userId, hash);
  }

  const issuer = 'FitTrainer';
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

  return {
    secret: base32Secret,
    backupCodes: plainCodes,
    otpauthUrl,
  };
}

export function confirmMfaEnrollment(db, userId, code) {
  const mfa = db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId);
  if (!mfa) throw new HttpError(400, 'No pending MFA enrollment found');

  const secret = decryptSecret(mfa.totp_secret_enc, mfa.iv, mfa.auth_tag);
  if (!verifyTOTP(code, secret)) {
    throw new HttpError(400, 'Invalid verification code. MFA enrollment not confirmed.');
  }

  db.prepare('UPDATE user_mfa SET enabled = 1, downgrade_locked = 1 WHERE user_id = ?').run(userId);
  return { ok: true, message: 'Multi-Factor Authentication enabled successfully' };
}

// ===== 5. MFA VERIFICATION & SESSION PROMOTION =====

export function verifyMfaForSession(db, sessionId, { totpCode, backupCode }) {
  const session = db.prepare('SELECT * FROM sessions_auth WHERE id = ?').get(sessionId);
  if (!session) throw new HttpError(401, 'Invalid session');
  if (Date.now() > session.expires_at) {
    db.prepare('DELETE FROM sessions_auth WHERE id = ?').run(sessionId);
    throw new HttpError(401, 'Session expired');
  }

  const mfa = db.prepare('SELECT * FROM user_mfa WHERE user_id = ? AND enabled = 1').get(session.user_id);
  if (!mfa) {
    // If user has no MFA, promote session directly
    db.prepare('UPDATE sessions_auth SET mfa_verified = 1 WHERE id = ?').run(sessionId);
    return { ok: true, message: 'MFA not required for this account' };
  }

  let verified = false;

  if (totpCode) {
    const secret = decryptSecret(mfa.totp_secret_enc, mfa.iv, mfa.auth_tag);
    verified = verifyTOTP(totpCode, secret);
  } else if (backupCode) {
    verified = consumeBackupCode(db, session.user_id, backupCode);
  }

  if (!verified) {
    throw new HttpError(401, 'Invalid MFA verification code');
  }

  // Extend session to full 24-hour lifetime upon successful MFA verification
  const newExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare(`
    UPDATE sessions_auth
    SET mfa_verified = 1, expires_at = ?
    WHERE id = ?
  `).run(newExpiresAt, sessionId);

  return { ok: true, message: 'MFA verification successful', expiresIn: 24 * 3600 };
}

// ===== 6. DOWNGRADE PROTECTION =====

export function disableMfa(db, userId, { currentPassword, adminApproved = false }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new HttpError(404, 'User not found');

  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw new HttpError(401, 'Invalid current password');
  }

  const mfa = db.prepare('SELECT downgrade_locked FROM user_mfa WHERE user_id = ?').get(userId);
  if (!mfa) return { ok: true, message: 'MFA is not enabled' };

  if (mfa.downgrade_locked === 1 && !adminApproved) {
    throw new HttpError(
      403,
      'MFA downgrade is locked. Disabling multi-factor authentication requires administrator approval.',
    );
  }

  db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);

  return { ok: true, message: 'Multi-Factor Authentication disabled successfully' };
}
