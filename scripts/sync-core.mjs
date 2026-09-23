import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHonestWindows } from './honest-windows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinFile = JSON.parse(await fs.readFile(path.join(root, 'core-pin.json'), 'utf8'));
const pin = pinFile.pin;
const repository = pinFile.repository;
const coreDir = path.join(root, '.core');
const sparseDirs = ['scripts', 'browser-src', 'studio', 'mobile-src', 'vendor', 'download', 'assets'];

if (!/^[0-9a-f]{40}$/.test(pin)) throw new Error('core-pin.json pin must be a 40-character commit SHA.');

function git(args, cwd = coreDir) {
  execFileSync('git', args, { cwd, stdio: 'inherit', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

function gitOut(args, cwd = coreDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}

await fs.rm(coreDir, { recursive: true, force: true });
execFileSync('git', ['clone', '--filter=blob:none', '--sparse', '--depth', '1', repository, coreDir], {
  stdio: 'inherit',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
});

let head = gitOut(['rev-parse', 'HEAD']);
if (head !== pin) {
  git(['fetch', '--depth', '1', 'origin', pin]);
  git(['checkout', '--detach', 'FETCH_HEAD']);
  head = gitOut(['rev-parse', 'HEAD']);
}
if (head !== pin) throw new Error(`Core checkout ${head} does not match pin ${pin}.`);

git(['sparse-checkout', 'set', ...sparseDirs]);
for (const dir of sparseDirs) {
  await fs.access(path.join(coreDir, dir));
}
for (const skipped of ['android', 'ios']) {
  try {
    await fs.access(path.join(coreDir, skipped));
    throw new Error(`Sparse checkout included ${skipped}. This shell pulls the web/browser build only.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmEnv = { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' };
delete npmEnv.NODE_ENV;
execFileSync(npm, ['install', '--include=dev', '--ignore-scripts'], { cwd: coreDir, stdio: 'inherit', env: npmEnv });
execFileSync(npm, ['run', 'build:browser'], {
  cwd: coreDir,
  stdio: 'inherit',
  env: { ...npmEnv, NODE_ENV: 'production' }
});

const browserDist = path.join(coreDir, 'browser-dist');
const voices = path.join(root, 'voices');
await fs.rm(voices, { recursive: true, force: true });
await fs.cp(browserDist, voices, {
  recursive: true,
  filter(source) {
    const rel = path.relative(browserDist, source);
    if (!rel) return true;
    const top = rel.split(path.sep)[0];
    return top !== 'get' && top !== 'download';
  }
});
await fs.rm(path.join(voices, 'get'), { recursive: true, force: true });
await fs.rm(path.join(voices, 'download'), { recursive: true, force: true });

const downloadPage = withHonestWindows(await fs.readFile(path.join(coreDir, 'download', 'index.html'), 'utf8'));
await fs.mkdir(path.join(root, 'get'), { recursive: true });
await fs.mkdir(path.join(root, 'download'), { recursive: true });
await fs.writeFile(path.join(root, 'get', 'index.html'), downloadPage);
await fs.writeFile(path.join(root, 'download', 'index.html'), downloadPage);

const staged = {
  repository,
  pin,
  label: pinFile.label,
  browserBuild: 'npm run build:browser',
  voices: 'browser-dist',
  get: 'download/index.html',
  download: 'download/index.html'
};
await fs.writeFile(path.join(root, 'staged.json'), JSON.stringify(staged, null, 2) + '\n');

for (const required of ['index.html', 'studio.html', 'api.js', 'workstation/app.js', 'lab/index.html', 'lab/account-entry.js', 'favicon.svg', 'manifest.webmanifest']) {
  await fs.access(path.join(voices, required));
}
const indexText = await fs.readFile(path.join(voices, 'index.html'), 'utf8');
if (!indexText.includes('content="0.7.0"')) throw new Error('Canonical studio was not staged under voices/.');
console.log(`Staged Core ${pin} browser build under voices/ and Core download/index.html at get/ and download/.`);
