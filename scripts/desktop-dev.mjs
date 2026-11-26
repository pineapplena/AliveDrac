import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const electron = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const main = resolve(root, 'desktop', 'main.cjs');

if (!existsSync(electron)) {
  console.error('Electron 运行时不存在。先运行：pnpm exec electron --version');
  process.exit(1);
}

const child = spawn(electron, [main], {
  cwd: root,
  stdio: 'inherit',
  env: (() => {
    const env = {
      ...process.env,
      ALIVE_NODE: process.execPath,
      ALIVE_DESKTOP_ROOT: root,
      ALIVE_DESKTOP_PORT: process.env.ALIVE_DESKTOP_PORT || '8790',
      ALIVE_DATA_DIR: process.env.ALIVE_DATA_DIR || resolve(root, 'data')
    };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  })()
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
