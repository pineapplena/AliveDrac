import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const runtimeDir = join(root, '.desktop-runtime');
const builderCli = join(root, 'node_modules', 'electron-builder', 'cli.js');
const icon = join(root, 'build', 'icon.ico');

if (!existsSync(join(root, 'dist', 'server', 'index.js'))) {
  console.error('缺少 dist/server/index.js，先运行：pnpm build');
  process.exit(1);
}
if (!existsSync(builderCli)) {
  console.error('缺少 electron-builder，先运行：pnpm install');
  process.exit(1);
}
if (!existsSync(icon)) {
  console.error('缺少 build/icon.ico，先生成应用图标');
  process.exit(1);
}

mkdirSync(runtimeDir, { recursive: true });
cpSync(process.execPath, join(runtimeDir, 'node.exe'));

const tempDir = join(root, '.nsis-tmp');
const cacheDir = join(root, '.electron-builder-cache');
mkdirSync(tempDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const env = {
  ...process.env,
  TMP: tempDir,
  TEMP: tempDir,
  ELECTRON_BUILDER_CACHE: cacheDir,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    'https://npmmirror.com/mirrors/electron-builder-binaries/'
};

execFileSync(process.execPath, [builderCli, '--win', 'nsis'], {
  cwd: root,
  stdio: 'inherit',
  env
});

console.log(`Installer ready: release/installer/Alive-Setup-${version}.exe`);
