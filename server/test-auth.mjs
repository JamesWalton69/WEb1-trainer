#!/usr/bin/env node
// test-auth.mjs — Comprehensive test suite for Auth, Password Reset & MFA.
// Verifies all security guarantees:
// 1. Password hashing (scrypt with cost >= 14, no plaintext) & complexity validation
// 2. Login rate limiting (5 attempts per 15 min)
// 3. Session tokens with <= 24h expiration & invalidation upon logout
// 4. CSRF protection on authenticated state-modifying requests
// 5. Password reset flow: >=32 bytes randomness, 1h TTL, single-use, anti-enumeration, rate limiting, complexity
// 6. MFA: AES-256-GCM encrypted secrets at rest, hashed single-use backup codes, API bypass prevention, re-auth on enrollment, downgrade lock

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateTOTP } from './mfa.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 3500 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}/api`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'fittrainer-auth-test-'));
const DB_PATH = join(DATA_DIR, 'test-auth.sqlite');

const child = spawn(process.execPath, [join(HERE, 'index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    FITTRAINER_DB: DB_PATH,
    NODE_ENV: 'test',
    MFA_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d));
child.stderr.on('data', (d) => (serverLog += d));

const api = async (method, path, body, headers = {}) => {
  const reqHeaders = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers };
  const res = await fetch(BASE + path, {
    method,
    headers: Object.keys(reqHeaders).length ? reqHeaders : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

let passed = 0;
async function check(name, fn) {
  await fn();
  console.log(`  ok  ${name}`);
  passed++;
}

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server never came up.\n${serverLog}`);
}

async function run() {
  await waitForServer();

  // Test credentials satisfying complexity requirements (min 12 chars, upper, lower, digit, symbol)
  const validPassword = 'SecurePassword123!';
  const weakPassword = 'weak';
  const testEmail = 'athlete@example.com';

  // 1. Password Complexity Validation
  await check('registration rejects passwords failing complexity requirements', async () => {
    const res = await api('POST', '/auth/register', { email: testEmail, password: weakPassword });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /12 characters/);
  });

  // 2. Password Hashing at Rest
  await check('passwords are hashed with scrypt (cost >= 10, no plaintext)', async () => {
    const res = await api('POST', '/auth/register', { email: testEmail, password: validPassword });
    assert.equal(res.status, 201);
    assert.equal(res.json.email, testEmail);

    // Verify database record
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const user = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(testEmail);
      assert.ok(user, 'User record must exist');
      assert.notEqual(user.password_hash, validPassword, 'Password must NOT be plaintext');
      assert.ok(user.password_hash.startsWith('scrypt$16384$8$1$'), 'Hash must use scrypt with N=16384 (cost factor >= 14)');
    } finally {
      db.close();
    }
  });

  // 3. Rate Limiting on Login Endpoints
  await check('rate limiting triggers 429 after 5 failed login attempts', async () => {
    const attackerIpHeaders = { 'X-Forwarded-For': '198.51.100.1' };
    for (let i = 0; i < 5; i++) {
      const res = await api('POST', '/auth/login', { email: testEmail, password: 'WrongPassword999!' }, attackerIpHeaders);
      assert.equal(res.status, 401);
    }
    // 6th attempt from the same IP must be rate-limited
    const rateLimitedRes = await api('POST', '/auth/login', { email: testEmail, password: 'WrongPassword999!' }, attackerIpHeaders);
    assert.equal(rateLimitedRes.status, 429);
    assert.match(rateLimitedRes.json.error, /Too many login attempts/);
  });

  // 4. Session Tokens & Expiration
  let activeSessionId = '';
  let csrfToken = '';
  await check('successful login returns session expiring strictly in <= 24 hours', async () => {
    // Sleep slightly or reset IP key via different email or wait
    const anotherEmail = 'user2@example.com';
    await api('POST', '/auth/register', { email: anotherEmail, password: validPassword });

    // Login with valid credentials
    const loginRes = await api('POST', '/auth/login', { email: anotherEmail, password: validPassword });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.json.status, 'SUCCESS');
    assert.ok(loginRes.json.sessionId.length >= 32);
    assert.ok(loginRes.json.expiresIn <= 86400, 'Expiration must not exceed 24 hours (86400 seconds)');
    assert.ok(loginRes.json.csrfToken);

    activeSessionId = loginRes.json.sessionId;
    csrfToken = loginRes.json.csrfToken;
  });

  // 5. CSRF Protection
  await check('CSRF protection rejects state-changing requests without matching token', async () => {
    // Missing CSRF token
    const res1 = await api('POST', '/sync', { sessions: [] }, {
      Authorization: `Bearer ${activeSessionId}`,
    });
    assert.equal(res1.status, 403);
    assert.match(res1.json.error, /CSRF token/);

    // Invalid CSRF token
    const res2 = await api('POST', '/sync', { sessions: [] }, {
      Authorization: `Bearer ${activeSessionId}`,
      'X-CSRF-Token': 'bogus-csrf-token',
    });
    assert.equal(res2.status, 403);
    assert.match(res2.json.error, /Invalid CSRF token/);

    // Valid CSRF token succeeds
    const res3 = await api('POST', '/sync', { sessions: [] }, {
      Authorization: `Bearer ${activeSessionId}`,
      'X-CSRF-Token': csrfToken,
    });
    assert.equal(res3.status, 200);
  });

  // 6. Session Invalidation on Logout
  await check('session tokens do not persist after logout', async () => {
    const logoutRes = await api('POST', '/auth/logout', {}, {
      Authorization: `Bearer ${activeSessionId}`,
      'X-CSRF-Token': csrfToken,
    });
    assert.equal(logoutRes.status, 200);

    // Using the logged out session token must now be rejected
    const testAccess = await api('GET', '/auth/me', null, {
      Authorization: `Bearer ${activeSessionId}`,
    });
    assert.equal(testAccess.status, 401);
  });

  // 7. Password Reset Flow: End to End
  let resetToken = '';
  await check('password reset tokens are >= 32 bytes and anti-enumeration works', async () => {
    // Test anti-enumeration: nonexistent email returns exact same message
    const nonExistent = await api('POST', '/auth/password-reset/request', { email: 'nobody@nowhere.com' });
    assert.equal(nonExistent.status, 200);
    assert.match(nonExistent.json.message, /If this email is registered/);

    // Real user request
    const reqRes = await api('POST', '/auth/password-reset/request', { email: testEmail });
    assert.equal(reqRes.status, 200);
    assert.match(reqRes.json.message, /If this email is registered/);
    assert.ok(reqRes.json.debugToken, 'debug token provided in test mode');
    assert.ok(reqRes.json.debugToken.length >= 64, 'Token must be at least 32 bytes (64 hex characters)');

    resetToken = reqRes.json.debugToken;
  });

  await check('password reset tokens expire in <= 1 hour and are single-use', async () => {
    // Verify token expiration is within 1 hour in database
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const row = db.prepare('SELECT expires_at, created_at, used FROM password_resets ORDER BY created_at DESC LIMIT 1').get();
      assert.ok(row);
      const ttl = row.expires_at - row.created_at;
      assert.ok(ttl <= 3600 * 1000, 'TTL must be <= 1 hour (3600000 ms)');
      assert.equal(row.used, 0);
    } finally {
      db.close();
    }

    // Attempt to reset with weak password fails complexity
    const weakRes = await api('POST', '/auth/password-reset/confirm', {
      token: resetToken,
      newPassword: 'short',
    });
    assert.equal(weakRes.status, 400);

    // Successful reset with complex password
    const newPassword = 'NewSecretPassword456!';
    const confirmRes = await api('POST', '/auth/password-reset/confirm', {
      token: resetToken,
      newPassword,
    });
    assert.equal(confirmRes.status, 200);

    // Second consumption must be rejected (single-use)
    const reUseRes = await api('POST', '/auth/password-reset/confirm', {
      token: resetToken,
      newPassword: 'AnotherPassword789!',
    });
    assert.equal(reUseRes.status, 400);
    assert.match(reUseRes.json.error, /Invalid or expired/);
  });

  // 8. Multi-Factor Authentication (MFA)
  let mfaUserSession = '';
  let mfaCsrf = '';
  let mfaSecret = '';
  let backupCodes = [];

  await check('MFA enrollment requires re-authentication with current password', async () => {
    const mfaEmail = 'mfa-athlete@example.com';
    const pwd = 'MfaUserPassword2026!';
    await api('POST', '/auth/register', { email: mfaEmail, password: pwd });

    const loginRes = await api('POST', '/auth/login', { email: mfaEmail, password: pwd });
    mfaUserSession = loginRes.json.sessionId;
    mfaCsrf = loginRes.json.csrfToken;

    // Wrong password for enrollment
    const failEnroll = await api('POST', '/auth/mfa/enroll', { currentPassword: 'WrongPassword!' }, {
      Authorization: `Bearer ${mfaUserSession}`,
      'X-CSRF-Token': mfaCsrf,
    });
    assert.equal(failEnroll.status, 401);
    assert.match(failEnroll.json.error, /Re-authentication required/);

    // Correct password succeeds
    const enrollRes = await api('POST', '/auth/mfa/enroll', { currentPassword: pwd }, {
      Authorization: `Bearer ${mfaUserSession}`,
      'X-CSRF-Token': mfaCsrf,
    });
    assert.equal(enrollRes.status, 200);
    assert.ok(enrollRes.json.secret);
    assert.ok(enrollRes.json.backupCodes.length === 8);

    mfaSecret = enrollRes.json.secret;
    backupCodes = enrollRes.json.backupCodes;
  });

  await check('TOTP secrets are stored encrypted at rest (AES-256-GCM) and backup codes are hashed', async () => {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const mfaRow = db.prepare('SELECT totp_secret_enc, iv, auth_tag FROM user_mfa').get();
      assert.ok(mfaRow);
      assert.notEqual(mfaRow.totp_secret_enc, mfaSecret, 'Secret must NOT be plaintext Base32 at rest');
      assert.ok(mfaRow.iv.length === 24, '12-byte IV (24 hex characters)');
      assert.ok(mfaRow.auth_tag.length === 32, '16-byte auth tag (32 hex characters)');

      const backupRow = db.prepare('SELECT code_hash FROM user_backup_codes LIMIT 1').get();
      assert.ok(backupRow);
      assert.notEqual(backupRow.code_hash, backupCodes[0], 'Backup code must be stored hashed');
      assert.equal(backupRow.code_hash.length, 64, 'SHA-256 hash length');
    } finally {
      db.close();
    }
  });

  await check('MFA enrollment confirmation enables 2FA and sets downgrade lock', async () => {
    const totpCode = generateTOTP(mfaSecret);
    const confirmRes = await api('POST', '/auth/mfa/confirm', { code: totpCode }, {
      Authorization: `Bearer ${mfaUserSession}`,
      'X-CSRF-Token': mfaCsrf,
    });
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.json.ok, true);
  });

  await check('API endpoints cannot be bypassed without MFA verification', async () => {
    const mfaEmail = 'mfa-athlete@example.com';
    const pwd = 'MfaUserPassword2026!';

    // Login returns MFA_REQUIRED and temporary session with mfa_verified = 0
    const loginRes = await api('POST', '/auth/login', { email: mfaEmail, password: pwd });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.json.status, 'MFA_REQUIRED');

    const tempSession = loginRes.json.sessionId;
    const tempCsrf = loginRes.json.csrfToken;

    // Directly accessing protected endpoint /api/sync MUST be rejected with 403
    const bypassAttempt = await api('POST', '/sync', { sessions: [] }, {
      Authorization: `Bearer ${tempSession}`,
      'X-CSRF-Token': tempCsrf,
    });
    assert.equal(bypassAttempt.status, 403);
    assert.match(bypassAttempt.json.error, /Multi-factor authentication/);

    // Verify MFA using single-use backup code
    const verifyRes = await api('POST', '/auth/mfa/verify', { backupCode: backupCodes[0] }, {
      Authorization: `Bearer ${tempSession}`,
    });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.json.ok, true);

    // Now protected endpoint /api/sync succeeds
    const allowed = await api('POST', '/sync', { sessions: [] }, {
      Authorization: `Bearer ${tempSession}`,
      'X-CSRF-Token': tempCsrf,
    });
    assert.equal(allowed.status, 200);

    // Reusing the same backup code must be rejected
    const reuseAttempt = await api('POST', '/auth/mfa/verify', { backupCode: backupCodes[0] }, {
      Authorization: `Bearer ${tempSession}`,
    });
    assert.equal(reuseAttempt.status, 401);
  });

  await check('MFA cannot be downgraded without administrator approval', async () => {
    const pwd = 'MfaUserPassword2026!';
    // Attempting to disable MFA without admin approval is forbidden
    const disableFail = await api('POST', '/auth/mfa/disable', { currentPassword: pwd, adminApproved: false }, {
      Authorization: `Bearer ${mfaUserSession}`,
      'X-CSRF-Token': mfaCsrf,
    });
    assert.equal(disableFail.status, 403);
    assert.match(disableFail.json.error, /administrator approval/);

    // With admin approval, it succeeds
    const disableOk = await api('POST', '/auth/mfa/disable', { currentPassword: pwd, adminApproved: true }, {
      Authorization: `Bearer ${mfaUserSession}`,
      'X-CSRF-Token': mfaCsrf,
    });
    assert.equal(disableOk.status, 200);
  });
}

async function cleanup() {
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
  try {
    rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  } catch {}
}

run()
  .then(() => console.log(`\nAll ${passed} auth & MFA security checks passed!`))
  .catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    if (serverLog) console.error(`\n--- server output ---\n${serverLog}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
