import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = process.env.ALIVE_ROOT ? resolve(process.env.ALIVE_ROOT) : process.cwd();
export const DATA_DIR = process.env.ALIVE_DATA_DIR
  ? resolve(process.env.ALIVE_DATA_DIR)
  : resolve(ROOT, 'data');
export const ASSETS_DIR = resolve(DATA_DIR, 'assets');
export const SEED_DIR = resolve(ROOT, 'seed');
export const WEB_DIST = resolve(ROOT, 'dist', 'web');
export const PORT = Number(process.env.ALIVE_PORT ?? 8788);
export const HOST = process.env.ALIVE_HOST ?? '127.0.0.1';
export const VERSION = '1.5.0';

for (const dir of [DATA_DIR, ASSETS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function seedPath(name: string): string {
  return resolve(SEED_DIR, name);
}

