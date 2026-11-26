import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const node = process.execPath;
const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs');
const vite = resolve(root, 'node_modules/vite/bin/vite.js');

for (const file of [tsx, vite]) {
  if (!existsSync(file)) {
    console.error(`缺少依赖文件：${file}\n请先运行 pnpm install`);
    process.exit(1);
  }
}

const children = [];
function run(name, args, color) {
  const child = spawn(node, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env }
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with ${code}`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', [tsx, 'watch', 'server/index.ts'], '36');
run('web', [vite, '--host', '127.0.0.1'], '35');

console.log('\n  Alive is starting…');
console.log('  App   http://127.0.0.1:5173');
console.log('  API   http://127.0.0.1:8788\n');
