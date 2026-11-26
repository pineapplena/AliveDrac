import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const version = String(process.argv[2] ?? '').trim().replace(/^v/, '');
if (!version) {
  console.error('Usage: node scripts/set-release-version.mjs 1.5.1');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const packagePath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
pkg.version = version;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const configPath = join(root, 'server', 'config.ts');
const config = readFileSync(configPath, 'utf8');
writeFileSync(
  configPath,
  config.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${version}';`),
  'utf8'
);

console.log(`Release version set to ${version}`);
