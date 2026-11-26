import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const electronDist = join(root, 'node_modules', 'electron', 'dist');
const destination = join(root, 'release', `Alive-Desktop-v${version}-win-x64`);
const zipPath = join(root, 'release', `Alive-Desktop-v${version}-win-x64.zip`);
const appDir = join(destination, 'resources', 'app');
const runtimeDir = join(destination, 'resources', 'runtime');

if (!existsSync(join(electronDist, 'electron.exe'))) {
  console.error('Electron 运行时不存在，先运行：pnpm add -D electron');
  process.exit(1);
}
if (!existsSync(join(root, 'dist', 'server', 'index.js'))) {
  console.error('缺少 dist/server/index.js，先运行：pnpm build');
  process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(destination, { recursive: true });

// Electron runtime and Chromium files. Keep electron.exe intact: Electron
// resolves its own resources relative to this executable.
cpSync(electronDist, destination, { recursive: true });

// A tiny Windows launcher keeps the friendly Alive.exe name while leaving
// Electron's binary untouched.
const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];
const csc = cscCandidates.find((candidate) => existsSync(candidate));
if (!csc) throw new Error('找不到 C# 编译器 csc.exe');
execFileSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/codepage:65001',
    '/win32icon:' + join(root, 'build', 'icon.ico'),
    `/out:${join(destination, 'Alive.exe')}`,
    '/r:System.Windows.Forms.dll',
    join(root, 'packaging', 'DesktopLauncher.cs')
  ],
  { stdio: 'inherit' }
);

// App server + UI + assets.
mkdirSync(appDir, { recursive: true });
cpSync(join(root, 'desktop'), join(appDir, 'desktop'), { recursive: true });
cpSync(join(root, 'dist'), join(appDir, 'dist'), { recursive: true });
cpSync(join(root, 'seed'), join(appDir, 'seed'), { recursive: true });
writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'alive-desktop',
      productName: 'Alive',
      version,
      main: 'desktop/main.cjs',
      private: true
    },
    null,
    2
  ),
  'utf8'
);

// Keep the exact Node version used by this project instead of Electron's
// embedded Node; the backend uses node:sqlite.
mkdirSync(runtimeDir, { recursive: true });
const nodeExe = process.execPath;
if (!existsSync(nodeExe)) {
  console.error(`找不到 Node 运行时：${nodeExe}`);
  process.exit(1);
}
cpSync(nodeExe, join(runtimeDir, 'node.exe'));

writeFileSync(
  join(destination, '使用说明.txt'),
  [
    `Alive Desktop v${version}`,
    '',
    '1. 双击 Alive.exe 启动；不需要打开浏览器。',
    '2. 关闭窗口默认隐藏到系统托盘；在托盘菜单里选择“退出”才会停止服务。',
    '3. 数据保存在本目录的 data 文件夹；迁移或备份时复制整个 data 目录。',
    '4. 首次启动会自动创建数据库和角色资源。',
    '5. 如果端口 8790 已被占用，桌面版会自动尝试相邻端口。',
    '6. 该版本是便携桌面版；删除整个文件夹即可卸载。',
    '7. 如果系统阻止 Electron 启动，运行“启动 Alive（兼容模式）.cmd”。',
    '',
    'Electron 外壳只负责窗口、托盘和启动本地服务；聊天与数据仍在本地。'
  ].join('\r\n'),
  'utf8'
);

writeFileSync(
  join(destination, '启动 Alive（兼容模式）.cmd'),
  '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "ALIVE_DESKTOP_NO_SANDBOX=1"\r\nstart "" "Alive.exe"\r\n',
  'utf8'
);

execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${destination.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
  ],
  { stdio: 'inherit' }
);

console.log(JSON.stringify({ destination, zip: zipPath, version }, null, 2));
