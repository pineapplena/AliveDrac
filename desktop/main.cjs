'use strict';

const { app, BrowserWindow, dialog, Menu, Notification, Tray, nativeImage, screen, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (error) {
  // The portable manual build does not include electron-updater; the
  // installer build does.
  console.warn('electron-updater unavailable:', error?.message || error);
}

const APP_NAME = 'Alive';
const DEFAULT_PORT = Number(process.env.ALIVE_DESKTOP_PORT || 8790);
const HOST = '127.0.0.1';
const LOCAL_ORIGIN = `http://${HOST}:${DEFAULT_PORT}`;
const packagedApp =
  process.env.ALIVE_DESKTOP_PACKAGED === '1' ||
  app.isPackaged ||
  fs.existsSync(path.join(process.resourcesPath, 'app', 'dist', 'server', 'index.js'));
const isDev = !packagedApp;
const workspaceRoot = isDev
  ? path.resolve(process.env.ALIVE_DESKTOP_ROOT || path.join(__dirname, '..'))
  : path.join(process.resourcesPath, 'app');
const portableMode =
  process.env.ALIVE_DESKTOP_PORTABLE === '1' || Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
const exeDataDir = packagedApp ? path.join(path.dirname(app.getPath('exe')), 'data') : '';
const useExeData = Boolean(packagedApp) && portableMode;

// Portable builds keep data next to Alive.exe. Installed builds always use the
// per-user data directory so an installer update cannot delete user data.
if (packagedApp && useExeData && !process.env.ALIVE_DATA_DIR) {
  try {
    app.setPath('userData', exeDataDir);
  } catch {
    // Fall back to Electron's default userData if the portable folder is read-only.
  }
}

const dataDir =
  process.env.ALIVE_DATA_DIR ||
  (packagedApp
    ? useExeData
      ? exeDataDir
      : path.join(app.getPath('userData'), 'data')
    : path.join(workspaceRoot, 'data'));
const logDir = path.join(dataDir, '..', 'logs');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let ownsServer = false;
let isQuitting = false;
let serverLogFd = null;
let trayHintShown = false;

function log(message) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'desktop.log'),
      `[${new Date().toISOString()}] ${message}\n`,
      'utf8'
    );
  } catch {
    // Logging must never prevent startup.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const desktopConfigPath = path.join(dataDir, 'desktop.json');
const githubDefaultsPath = path.join(workspaceRoot, 'desktop', 'github-release.json');

function readGithubDefaults() {
  try {
    const parsed = JSON.parse(fs.readFileSync(githubDefaultsPath, 'utf8'));
    return {
      owner: String(parsed.owner ?? ''),
      repo: String(parsed.repo ?? ''),
      updateProvider: String(parsed.updateProvider ?? ''),
      updateUrl: String(parsed.updateUrl ?? '')
    };
  } catch {
    return { owner: '', repo: '', updateProvider: '', updateUrl: '' };
  }
}

function readDesktopConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(desktopConfigPath, 'utf8'));
    const github = readGithubDefaults();
    const owner = String(parsed.githubOwner ?? github.owner ?? '');
    const repo = String(parsed.githubRepo ?? github.repo ?? '');
    const hasGithub = Boolean(owner && repo);
    let provider = String(parsed.updateProvider ?? (hasGithub ? 'github' : 'generic'));
    let updateUrl = String(parsed.updateUrl ?? '');

    // Prefer the built-in mirror for builds that ship one. This migrates older
    // GitHub-provider configs to the mirror without touching user data.
    if (!updateUrl && github.updateUrl) {
      updateUrl = github.updateUrl;
      provider = 'generic';
    }

    return {
      provider,
      githubOwner: owner,
      githubRepo: repo,
      updateUrl,
      autoCheck: parsed.autoCheck !== false
    };
  } catch {
    const github = readGithubDefaults();
    const hasGithub = Boolean(github.owner && github.repo);
    return {
      provider: github.updateUrl ? 'generic' : hasGithub ? 'github' : 'generic',
      githubOwner: github.owner,
      githubRepo: github.repo,
      updateUrl: github.updateUrl,
      autoCheck: true
    };
  }
}

function ensureDesktopConfig() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(desktopConfigPath)) {
      const github = readGithubDefaults();
      const hasGithub = Boolean(github.owner && github.repo);
      fs.writeFileSync(
        desktopConfigPath,
        JSON.stringify(
          {
            updateProvider: github.updateUrl ? 'generic' : hasGithub ? 'github' : 'generic',
            githubOwner: github.owner,
            githubRepo: github.repo,
            updateUrl: github.updateUrl,
            autoCheck: true,
            note: github.updateUrl
              ? 'GitHub Releases through the built-in mirror.'
              : 'GitHub 更新：填写 githubOwner / githubRepo，或把 updateProvider 改成 generic 并填写 updateUrl。'
          },
          null,
          2
        ),
        'utf8'
      );
    }
  } catch (error) {
    log(`desktop config failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function updateSource() {
  if (process.env.ALIVE_UPDATE_URL) {
    return { provider: 'generic', url: process.env.ALIVE_UPDATE_URL };
  }
  const config = readDesktopConfig();
  if (config.provider === 'github' && config.githubOwner && config.githubRepo) {
    return {
      provider: 'github',
      owner: config.githubOwner,
      repo: config.githubRepo
    };
  }
  if (config.updateUrl) {
    return { provider: 'generic', url: config.updateUrl };
  }
  return null;
}

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(700);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function health(port) {
  try {
    const response = await fetch(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

async function choosePort() {
  if (!(await portOpen(DEFAULT_PORT))) return DEFAULT_PORT;
  if (await health(DEFAULT_PORT)) return DEFAULT_PORT;
  for (let port = DEFAULT_PORT + 1; port < DEFAULT_PORT + 20; port++) {
    if (!(await portOpen(port))) return port;
  }
  return DEFAULT_PORT;
}

function resolveServerEntry() {
  return path.join(workspaceRoot, 'dist', 'server', 'index.js');
}

function resolveNode() {
  if (!packagedApp) {
    return process.env.ALIVE_NODE || process.env.NODE_EXE || 'node';
  }
  return path.join(process.resourcesPath, 'runtime', 'node.exe');
}

async function startServer(port) {
  if (await health(port)) {
    log(`reusing existing server on ${port}`);
    return;
  }
  const entry = resolveServerEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`服务端文件不存在：${entry}\n请先运行 pnpm build。`);
  }
  const node = resolveNode();
  fs.mkdirSync(logDir, { recursive: true });
  serverLogFd = fs.openSync(path.join(logDir, 'server.log'), 'a');
  serverProcess = spawn(node, [entry], {
    cwd: workspaceRoot,
    windowsHide: true,
    stdio: ['ignore', serverLogFd, serverLogFd],
    env: {
      ...process.env,
      ALIVE_ROOT: workspaceRoot,
      ALIVE_DATA_DIR: dataDir,
      ALIVE_HOST: HOST,
      ALIVE_PORT: String(port),
      ALIVE_NO_BROWSER: '1'
    }
  });
  ownsServer = true;
  log(`started server pid=${serverProcess.pid} port=${port} node=${node}`);
  serverProcess.on('exit', (code) => {
    log(`server exited code=${code}`);
    serverProcess = null;
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('alive-server-exit', { code });
    }
  });

  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(500);
    if (await health(port)) {
      log(`health ok on ${port}`);
      return;
    }
    if (serverProcess && serverProcess.exitCode !== null) break;
  }
  throw new Error(`Alive 服务没有启动（端口 ${port}）。\n请查看 ${path.join(logDir, 'server.log')}`);
}

function stopServer() {
  if (serverProcess && ownsServer) {
    try {
      serverProcess.kill();
    } catch {
      // The process may already have exited.
    }
    serverProcess = null;
  }
  if (serverLogFd !== null) {
    try {
      fs.closeSync(serverLogFd);
    } catch {
      // Ignore.
    }
    serverLogFd = null;
  }
}

function configureAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', (error) => {
    log(`update error: ${error instanceof Error ? error.message : String(error)}`);
  });
  autoUpdater.on('update-available', (info) => {
    log(`update available: ${info?.version ?? 'unknown'}`);
  });
  autoUpdater.on('update-not-available', () => {
    log('update not available');
  });
  autoUpdater.on('update-downloaded', (info) => {
    log(`update downloaded: ${info?.version ?? 'unknown'}`);
    const choice = dialog.showMessageBoxSync(mainWindow || undefined, {
      type: 'info',
      title: 'Alive 有新版本',
      message: `新版本 ${info?.version ?? ''} 已经下载完成。`,
      detail: '重启后会安装更新，聊天和记忆数据不会丢失。',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice === 0) autoUpdater.quitAndInstall();
  });
}

async function checkForUpdates(manual = false) {
  if (!autoUpdater || !packagedApp) {
    if (manual) {
      dialog.showMessageBoxSync(mainWindow || undefined, {
        type: 'info',
        title: '检查更新',
        message: '当前版本不支持自动更新。',
        detail: '请使用安装版，或在 desktop.json 里配置更新地址。'
      });
    }
    return;
  }
  const source = updateSource();
  if (!source) {
    if (manual) {
      dialog.showMessageBoxSync(mainWindow || undefined, {
        type: 'info',
        title: '还没有配置更新源',
        message: '自动更新需要一个 GitHub 仓库或静态更新目录。',
        detail: `编辑 ${desktopConfigPath}：\n\nGitHub：填写 githubOwner 和 githubRepo。\n静态目录：把 updateProvider 改成 generic，再填写 updateUrl。`,
        buttons: ['知道了']
      });
    }
    return;
  }
  try {
    if (source.provider === 'github') {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: source.owner,
        repo: source.repo
      });
      log(`checking GitHub updates: ${source.owner}/${source.repo}`);
    } else {
      autoUpdater.setFeedURL({ provider: 'generic', url: source.url });
      log(`checking updates: ${source.url}`);
    }
    await autoUpdater.checkForUpdates();
    if (manual) {
      dialog.showMessageBoxSync(mainWindow || undefined, {
        type: 'info',
        title: '检查更新',
        message: '已经发起检查。',
        detail: '如果发现新版本，会自动下载，下载完成后提示重启安装。',
        buttons: ['知道了']
      });
    }
  } catch (error) {
    log(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
    if (manual) {
      dialog.showMessageBoxSync(mainWindow || undefined, {
        type: 'error',
        title: '检查更新失败',
        message: '连接更新源失败。',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['知道了']
      });
    }
  }
}

function setupAutoUpdates() {
  if (!autoUpdater || !packagedApp) return;
  const config = readDesktopConfig();
  if (!config.autoCheck || !updateSource()) return;
  setTimeout(() => void checkForUpdates(false), 15_000);
  setInterval(() => void checkForUpdates(false), 6 * 3_600_000);
}

function autoStartSpec() {
  if (portableMode) {
    return {
      path: path.join(path.dirname(process.execPath), 'Alive.exe'),
      args: []
    };
  }
  return {
    path: process.execPath,
    args: [app.getAppPath()]
  };
}

function autoStartEnabled() {
  try {
    const spec = autoStartSpec();
    return Boolean(app.getLoginItemSettings(spec).openAtLogin);
  } catch {
    return false;
  }
}

function setAutoStart(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      ...autoStartSpec()
    });
    log(`auto start ${enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    log(`auto start failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  refreshTrayMenu();
}

function iconPath() {
  const candidates = [
    path.join(workspaceRoot, 'desktop', 'icon.png'),
    path.join(workspaceRoot, 'seed', 'avatar.png')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[1];
}

function trayIcon() {
  const candidates = [
    path.join(workspaceRoot, 'desktop', 'icon.png'),
    path.join(workspaceRoot, 'seed', 'avatar.png'),
    path.join(workspaceRoot, 'seed', 'avatar.jpg')
  ];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image.resize({ width: 32, height: 32 });
  }
  return nativeImage.createEmpty();
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

function trayMenuTemplate() {
  return [
    { label: '打开 Alive', click: showWindow },
    { label: '隐藏窗口', click: hideWindow },
    { type: 'separator' },
    {
      label: '开机自启动（可选）',
      type: 'checkbox',
      checked: autoStartEnabled(),
      click: (item) => setAutoStart(Boolean(item.checked))
    },
    {
      label: '检查更新',
      click: () => {
        void checkForUpdates(true);
      }
    },
    {
      label: '更新设置…',
      click: () => {
        ensureDesktopConfig();
        void shell.openPath(desktopConfigPath);
      }
    },
    {
      label: '打开数据目录',
      click: () => {
        void shell.openPath(dataDir);
      }
    },
    { type: 'separator' },
    {
      label: '在浏览器中打开',
      click: () => {
        if (mainWindow) void shell.openExternal(mainWindow.webContents.getURL() || LOCAL_ORIGIN);
      }
    },
    { type: 'separator' },
    {
      label: '退出（停止服务）',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function createTray() {
  const image = trayIcon();
  if (image.isEmpty()) {
    log('tray icon is empty, tray will not be created');
    return;
  }
  try {
    tray = new Tray(image);
  } catch (error) {
    log(`tray creation failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  tray.setToolTip('Alive · 双击打开');
  refreshTrayMenu();
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  log('tray created');
}

function notifyTrayOnce() {
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  if (process.platform !== 'win32') return;
  try {
    tray.displayBalloon({
      title: 'Alive 还在运行',
      content: '关闭窗口只是隐藏到系统托盘。双击托盘头像打开，右键菜单可以退出。',
      iconType: 'info'
    });
  } catch (error) {
    log(`tray balloon failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createWindow(port) {
  const bounds = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1440, bounds.width - 80),
    height: Math.min(920, bounds.height - 80),
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    title: APP_NAME,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  const target = `http://${HOST}:${port}`;
  const allowed = new URL(target).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && new URL(url).origin !== allowed) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${allowed}/`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    log(`did-fail-load ${code} ${description}`);
  });

  const localPermission = (url) => {
    try {
      return new URL(url).origin === allowed;
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    const ok =
      localPermission(url) &&
      ['notifications', 'media', 'clipboard-sanitized-write', 'display-capture'].includes(permission);
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return (
      localPermission(requestingOrigin) &&
      ['notifications', 'media', 'clipboard-sanitized-write', 'display-capture'].includes(permission)
    );
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (!tray) {
      // If the tray could not be created, never leave the user with an
      // invisible process: keep the taskbar button instead.
      mainWindow?.minimize();
      return;
    }
    if (!trayHintShown) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: 'Alive 还在运行',
        message: '关闭窗口后 Alive 会继续在后台运行。',
        detail:
          '可以在系统托盘（任务栏右下角，可能被折叠在 ^ 里）找到头像。\r\n双击打开，右键菜单可以退出。',
        buttons: ['隐藏到托盘', '退出 Alive'],
        defaultId: 0,
        cancelId: 0
      });
      if (choice === 1) {
        isQuitting = true;
        app.quit();
        return;
      }
    }
    mainWindow?.hide();
    notifyTrayOnce();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(target);
}

async function bootstrap() {
  app.setAppUserModelId('com.alive.companion');
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => showWindow());

  try {
    ensureDesktopConfig();
    configureAutoUpdater();
    const port = await choosePort();
    await startServer(port);
    createTray();
    createWindow(port);
    setupAutoUpdates();
    if (Notification.isSupported()) log('native notifications supported');
  } catch (error) {
    log(`startup failed: ${error instanceof Error ? error.stack : String(error)}`);
    dialog.showErrorBox(
      'Alive 无法启动',
      error instanceof Error ? error.message : String(error)
    );
    isQuitting = true;
    app.quit();
  }
}

app.whenReady().then(bootstrap);

app.on('activate', () => {
  if (!mainWindow) return;
  showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  // The tray keeps the companion alive. Use the tray menu to quit.
});
