import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const www = path.join(root, 'www');

const COPY_FILES = ['index.html', 'app.js', 'sw.js', 'manifest.json'];
const COPY_DIRS = ['icons', 'vendor'];

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else copyFile(from, to);
  }
}

rmDir(www);
fs.mkdirSync(www, { recursive: true });

for (const file of COPY_FILES) {
  copyFile(path.join(root, file), path.join(www, file));
}

for (const dir of COPY_DIRS) {
  copyDir(path.join(root, dir), path.join(www, dir));
}

const configSrc = fs.existsSync(path.join(root, 'config.js'))
  ? path.join(root, 'config.js')
  : path.join(root, 'config.example.js');
copyFile(configSrc, path.join(www, 'config.js'));

await build({
  entryPoints: [path.join(root, 'native-gps.mjs')],
  outfile: path.join(www, 'native-gps.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  logLevel: 'info',
});

console.log('Built Capacitor web assets in www/');
