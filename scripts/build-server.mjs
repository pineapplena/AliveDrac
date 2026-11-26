import { build } from 'esbuild';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

await build({
  entryPoints: [resolve(root, 'server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: resolve(root, 'dist/server/index.js'),
  external: ['node:sqlite'],
  sourcemap: false,
  minify: false,
  logLevel: 'info'
});
