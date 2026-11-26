import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(root, 'release');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const target = resolve(releaseRoot, `Alive-v${version}-win-x64`);
if (!target.startsWith(releaseRoot + '\\')) throw new Error('invalid package target');
rmSync(target, { recursive: true, force: true });

const appDir = join(target, 'app');
mkdirSync(join(appDir, 'dist'), { recursive: true });
mkdirSync(join(appDir, 'seed'), { recursive: true });
mkdirSync(join(appDir, 'scripts'), { recursive: true });
mkdirSync(join(appDir, 'data'), { recursive: true });
mkdirSync(join(appDir, 'logs'), { recursive: true });
mkdirSync(join(target, 'runtime'), { recursive: true });
mkdirSync(join(target, 'docs'), { recursive: true });

cpSync(resolve(root, 'dist'), join(appDir, 'dist'), { recursive: true });
cpSync(resolve(root, 'docs', 'VOICE_IMAGE_SETUP.md'), join(target, 'docs', '语音与生图配置教程.md'));
cpSync(resolve(root, 'seed', 'character.json'), join(appDir, 'seed', 'character.json'));
if (existsSync(resolve(root, 'seed', 'avatar.jpg'))) {
  cpSync(resolve(root, 'seed', 'avatar.jpg'), join(appDir, 'seed', 'avatar.jpg'));
} else {
  cpSync(resolve(root, 'seed', 'avatar.png'), join(appDir, 'seed', 'avatar.png'));
}
cpSync(resolve(root, 'scripts', 'launch.cjs'), join(appDir, 'scripts', 'launch.cjs'));

writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify(
    { name: 'alive', version, private: true, type: 'module', description: 'Alive local companion' },
    null,
    2
  ) + '\n',
  'utf8'
);

cpSync(process.execPath, join(target, 'runtime', 'node.exe'));
const nodeLicense = resolve(dirname(process.execPath), '..', 'LICENSE');
if (existsSync(nodeLicense)) {
  cpSync(nodeLicense, join(target, 'runtime', 'LICENSE'));
}

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];
const csc = cscCandidates.find((path) => existsSync(path));
if (!csc) throw new Error('C# compiler not found');
execFileSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/codepage:65001',
    `/out:${join(target, 'Alive.exe')}`,
    '/r:System.Windows.Forms.dll',
    resolve(root, 'packaging', 'AliveLauncher.cs')
  ],
  { stdio: 'inherit' }
);

writeFileSync(
  join(target, '启动 Alive.cmd'),
  `@echo off
setlocal
cd /d "%~dp0app"
set "ALIVE_ROOT=%CD%"
set "ALIVE_DATA_DIR="
set "ALIVE_HOST="
set "DEEPSEEK_API_KEY="
set "ALIVE_LLM_BASE_URL="
set "ALIVE_LLM_MODEL="
set "ALIVE_PORT=8790"
"..\\runtime\\node.exe" "scripts\\launch.cjs"
`,
  'utf8'
);

writeFileSync(
  join(target, '停止 Alive.cmd'),
  `@echo off
setlocal
set "PIDFILE=%~dp0app\\logs\\server.pid"
if not exist "%PIDFILE%" exit /b 0
set /p PID=<"%PIDFILE%"
taskkill /PID %PID% /F >nul 2>nul
del "%PIDFILE%" >nul 2>nul
`,
  'utf8'
);

writeFileSync(
  join(target, '使用说明.txt'),
  `Alive v${version} 便携版

1. 解压整个文件夹到有写入权限的位置，不要只复制 Alive.exe。
2. 双击 Alive.exe 启动；默认地址是 http://127.0.0.1:8790
3. 第一次启动会自动创建 app\\data\\alive.db。
   数据库只包含当前角色卡（人物设定、世界书、头像、开场白）；
   聊天、记忆、约定、日程、兴趣、关系数值、API Key 和其他设置全部重新初始化。
4. 角色卡来自制作这台电脑上正在使用的角色设置，不包含聊天和记忆。
5. 你的数据都在 app\\data 目录；迁移或备份时复制整个 data 目录。
6. 如果 Alive.exe 被安全软件拦住，可以运行“启动 Alive.cmd”作为备用启动方式。
7. 这个便携版默认使用 8790 端口，不会改动或覆盖这台电脑上原来的 8788 版本。
8. 第一次使用请在“设置”里重新填写模型服务、API Key 和其他偏好。

以后更新：
1. 运行安装目录里的“停止 Alive.cmd”。
2. 备份整个 app\\data 文件夹。
3. 把 Alive-vX.Y.Z-update.zip 解压到当前安装根目录，覆盖程序文件。
4. 双击 Alive.exe。
更新包不包含 app\\data，不会覆盖聊天、记忆、约定、角色、API Key 和设置。
`,
  'utf8'
);

const zipPath = resolve(releaseRoot, `Alive-v${version}-win-x64.zip`);
rmSync(zipPath, { force: true });
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${target.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
  ],
  { stdio: 'inherit' }
);

console.log(JSON.stringify({ target, zip: zipPath, version }, null, 2));
