#!/usr/bin/env node
/**
 * Downloads the Inter and Outfit variable webfonts into public/fonts/ so the
 * app can serve them itself and make zero third-party requests at runtime.
 *
 *   npm run fonts
 *
 * Run this once after cloning, and again only if you want to refresh the
 * files. The binaries are gitignored on purpose — keeping ~200 KB of fonts
 * out of git history, at the cost of one setup step.
 *
 * Zero dependencies: Node >= 18 for global fetch.
 */

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'fonts');

// A modern desktop UA is required — the CSS API serves legacy .ttf to
// unrecognised clients, and only variable woff2 to current browsers.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const FAMILIES = [
  { slug: 'inter', query: 'Inter:wght@100..900' },
  { slug: 'outfit', query: 'Outfit:wght@100..900' },
];

// Only these subsets are used by the UI. Others (cyrillic, greek, vietnamese)
// would be dead weight.
const WANTED_SUBSETS = new Set(['latin', 'latin-ext']);

/**
 * The CSS API annotates each @font-face with a `/* subset *\/` comment, so we
 * pair each comment with the woff2 URL of the block that follows it.
 */
function parseFaces(css) {
  const faces = [];
  const blocks = css.split('/*').slice(1);
  for (const block of blocks) {
    const subset = block.slice(0, block.indexOf('*/')).trim();
    const url = block.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
    if (subset && url) faces.push({ subset, url });
  }
  return faces;
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let written = 0;
  for (const { slug, query } of FAMILIES) {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(query)}&display=swap`;
    const res = await fetch(cssUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Font CSS request failed: ${res.status} ${res.statusText}`);
    const css = await res.text();

    const faces = parseFaces(css).filter((f) => WANTED_SUBSETS.has(f.subset));
    if (faces.length === 0) {
      throw new Error(`No latin woff2 found for ${slug}. Google may have changed the CSS API.`);
    }

    for (const { subset, url } of faces) {
      const dest = join(OUT_DIR, `${slug}-${subset}.woff2`);
      const bytes = await download(url);
      await writeFile(dest, bytes);
      console.log(`  public/fonts/${slug}-${subset}.woff2  ${(bytes.length / 1024).toFixed(1)} KB`);
      written++;
    }
  }

  console.log(`\nWrote ${written} font files. src/fonts.css already points at them.`);
}

main().catch(async (err) => {
  console.error(`\nCould not download fonts: ${err.message}`);
  // main() has already created OUT_DIR, so its existence proves nothing — count
  // the actual binaries. Having a usable set already on disk is the difference
  // between "the refresh failed, carry on" and "this build will ship without
  // fonts", and deploy.sh runs under `set -e`, so the exit code decides whether
  // a deploy aborts here.
  const woff2 = await readdir(OUT_DIR).then(
    (files) => files.filter((f) => f.endsWith('.woff2')),
    () => [],
  );
  if (woff2.length) {
    console.error(`Keeping the ${woff2.length} font file(s) already in public/fonts/.`);
    process.exit(0);
  }
  console.error(
    'public/fonts/ has no .woff2 files, so the app will fall back to system\n' +
    'fonts (system-ui / Segoe UI / SF Pro). That is harmless but not what the\n' +
    'design expects — re-run `npm run fonts` once you have network access.',
  );
  process.exit(1);
});
