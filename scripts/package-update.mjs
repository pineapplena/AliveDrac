import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(root, 'release');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const source = resolve(releaseRoot, `Alive-v${version}-win-x64`);
if (!existsSync(source)) {
  throw new Error(`Full package not found: ${source}. Run pnpm package:win first.`);
}

const includeRuntime = process.argv.includes('--with-runtime');
const staging = resolve(releaseRoot, `.update-v${version}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, 'app', 'dist'), { recursive: true });
mkdirSync(join(staging, 'app', 'scripts'), { recursive: true });
mkdirSync(join(staging, 'docs'), { recursive: true });

cpSync(join(source, 'app', 'dist'), join(staging, 'app', 'dist'), { recursive: true });
cpSync(join(source, 'app', 'scripts'), join(staging, 'app', 'scripts'), { recursive: true });
cpSync(join(source, 'app', 'package.json'), join(staging, 'app', 'package.json'));
cpSync(join(source, 'docs', '语音与生图配置教程.md'), join(staging, 'docs', '语音与生图配置教程.md'));
cpSync(join(source, 'Alive.exe'), join(staging, 'Alive.exe'));
for (const name of ['启动 Alive.cmd', '停止 Alive.cmd']) {
  const file = join(source, name);
  if (existsSync(file)) cpSync(file, join(staging, name));
}
if (includeRuntime) {
  cpSync(join(source, 'runtime'), join(staging, 'runtime'), { recursive: true });
}

writeFileSync(
  join(staging, 'update.json'),
  JSON.stringify(
    {
      version,
      includesRuntime: includeRuntime,
      excludes: ['app/data', 'app/seed', 'app/logs'],
      note: '只覆盖程序文件；不要覆盖 app/data。'
    },
    null,
    2
  ) + '\n',
  'utf8'
);

writeFileSync(
  join(staging, '更新说明.txt'),
  `Alive v${version} 代码覆盖更新

适用：已经安装旧版、想保留聊天/记忆/约定/角色/API Key 和全部设置的用户。
支持从 v1.1.0 直接覆盖升级到 v1.4.0，不要求先安装 v1.2.0 或 v1.3.0。

步骤：
1. 先运行安装目录里的“停止 Alive.cmd”。
2. 备份整个 app\\data 文件夹。更新包不会包含也不会主动覆盖它，但备份仍然必要。
3. 把这个更新包解压到 Alive 的安装根目录，覆盖同名程序文件。
4. 双击 Alive.exe。
5. 打开页面后确认版本和原有数据都在。

不要删除 app\\data，不要把更新包解压到一个新的空文件夹。
如果这次更新包含 runtime，更新包会带 runtime 文件夹；没有带就继续使用原来的 runtime。

本次更新：
- 包含：app\\dist、app\\scripts、app\\package.json、Alive.exe
- 包含：docs\\语音与生图配置教程.md
- ${includeRuntime ? '包含：runtime' : '不包含：runtime（普通代码更新）'}
- 不包含：app\\data、app\\seed、app\\logs
`,
  'utf8'
);

const zipPath = resolve(releaseRoot, `Alive-v${version}-update.zip`);
rmSync(zipPath, { force: true });
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${join(staging, '*').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
  ],
  { stdio: 'inherit' }
);
rmSync(staging, { recursive: true, force: true });

console.log(JSON.stringify({ update: zipPath, version, includeRuntime }, null, 2));
