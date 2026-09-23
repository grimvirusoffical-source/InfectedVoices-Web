import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WINDOWS_BODY, WINDOWS_CTA, WINDOWS_RELEASES_URL, claimsSignedOrSha, withHonestWindows } from './honest-windows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinFile = JSON.parse(await fs.readFile(path.join(root, 'core-pin.json'), 'utf8'));
const staged = JSON.parse(await fs.readFile(path.join(root, 'staged.json'), 'utf8'));
const failures = [];

function fail(message) {
  failures.push(message);
}

if (pinFile.pin !== '2fb04c2ce1ac4e49ea9105207f436b8b6cf1d80d') fail('core-pin.json is not the Stress CLEAR BAR PASS pin.');
if (staged.pin !== pinFile.pin) fail('staged.json pin does not match core-pin.json.');
if (staged.browserBuild !== 'npm run build:browser') fail('staged.json must record npm run build:browser.');
if (staged.get !== 'download/index.html' || staged.download !== 'download/index.html') {
  fail('get and download must both come from Core download/index.html.');
}

const getPage = await fs.readFile(path.join(root, 'get', 'index.html'));
const downloadPage = await fs.readFile(path.join(root, 'download', 'index.html'));
if (!getPage.equals(downloadPage)) fail('/get and /download pages differ.');
const page = getPage.toString('utf8');
const requiredPhrases = [
  'This page is <code>/get</code> and <code>/download</code>',
  'does not host raw store binaries',
  'App Store only. This page does not offer an ipa.',
  'Google Play only. This page does not offer an aab.',
  'No Mac .app is published.',
  'href="/voices"',
  'Open web'
];
for (const phrase of requiredPhrases) {
  if (!page.includes(phrase)) fail(`Download page is missing: ${phrase}`);
}
if (!page.includes(WINDOWS_BODY)) fail(`Download page is missing: ${WINDOWS_BODY}`);
if (!page.includes(`>${WINDOWS_CTA}<`)) fail(`Download page is missing the ${WINDOWS_CTA} call to action.`);
if (!page.includes(`href="${WINDOWS_RELEASES_URL}"`)) fail(`Download page is missing ${WINDOWS_RELEASES_URL}.`);
if (claimsSignedOrSha(page)) {
  fail('Download page claims Signed or SHA-256 before InfectedVoices-Windows Releases has a real Authenticode installer.');
}

const rewritten = withHonestWindows(`<article>
      <h2>Windows</h2>
      <p>The Windows build is signed. Its SHA-256 is published beside that installer. The GitHub source zipball is source, not the Windows app.</p>
    </article>`);
if (claimsSignedOrSha(rewritten)) fail('Sync rewrite still leaves a Signed or SHA-256 Windows claim.');
if (!rewritten.includes(WINDOWS_BODY) || !rewritten.includes(`href="${WINDOWS_RELEASES_URL}"`)) {
  fail('Sync rewrite does not produce the unprovisioned Windows Releases copy.');
}

const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
for (const phrase of [
  pinFile.pin,
  'feature-parity',
  'Free',
  'Basic',
  'Pro',
  'trial',
  '/voices',
  '/get',
  'App Store',
  'Google Play',
  'ipa',
  'aab',
  '.app',
  'build:browser',
  'Windows',
  'EAS',
  WINDOWS_BODY,
  WINDOWS_CTA,
  WINDOWS_RELEASES_URL
]) {
  if (!readme.includes(phrase)) fail(`README is missing ${phrase}.`);
}

const index = await fs.readFile(path.join(root, 'voices', 'index.html'), 'utf8');
if (!index.includes('content="0.7.0"')) fail('voices/index.html is not the Core 0.7.0 studio.');
for (const required of ['studio.html', 'api.js', 'workstation/app.js', 'lab/index.html', 'favicon.svg', 'manifest.webmanifest']) {
  try {
    await fs.access(path.join(root, 'voices', required));
  } catch {
    fail(`voices/${required} is missing.`);
  }
}

const forbiddenExt = new Set(['.ipa', '.aab']);
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.core' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith('.app')) fail(`Mac app bundle staged: ${path.relative(root, full)}`);
      await walk(full);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (forbiddenExt.has(ext)) fail(`Raw store binary staged: ${path.relative(root, full)}`);
  }
}
await walk(root);

for (const native of ['android', 'ios', 'eas.json', 'START-EAS-CLOUD-RELEASE.cmd']) {
  try {
    await fs.access(path.join(root, native));
    fail(`Native or EAS artifact must stay in Core: ${native}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Web shell consumes Core ${pinFile.pin}.`);
