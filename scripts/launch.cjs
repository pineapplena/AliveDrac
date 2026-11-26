#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.ALIVE_PORT || 8788);
const url = `http://127.0.0.1:${port}`;
const logs = path.join(root, 'logs');
const pidFile = path.join(logs, 'server.pid');
const outLog = path.join(logs, 'server.log');
const errLog = path.join(logs, 'server-error.log');
const launcherLog = path.join(logs, 'launcher.log');

fs.mkdirSync(logs, { recursive: true });

function log(message) {
  fs.appendFileSync(launcherLog, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

async function alive() {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data && data.ok);
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.ALIVE_NO_BROWSER === '1') return;
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
}

function showError(message) {
  log(message);
  if (process.platform === 'win32') {
    try {
      const child = spawn('notepad.exe', [errLog], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
    } catch {
      // The launcher log still contains the error.
    }
  }
}

(async () => {
  if (await alive()) {
    openBrowser();
    return;
  }

  const entry = path.join(root, 'dist', 'server', 'index.js');
  if (!fs.existsSync(entry)) {
    showError(`Built server missing: ${entry}\nRun "pnpm build" first.`);
    process.exitCode = 1;
    return;
  }

  const outFd = fs.openSync(outLog, 'a');
  const errFd = fs.openSync(errLog, 'a');
  let child;
  try {
    child = spawn(process.execPath, [entry], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
      env: { ...process.env, ALIVE_PORT: String(port) }
    });
    child.unref();
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  fs.writeFileSync(pidFile, String(child.pid), 'ascii');
  log(`started pid=${child.pid} node=${process.execPath}`);

  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await alive()) {
      log('health ok');
      openBrowser();
      return;
    }
    if (child.exitCode !== null) break;
  }

  const tail = fs.existsSync(errLog)
    ? fs.readFileSync(errLog, 'utf8').split(/\r?\n/).slice(-12).join('\n')
    : '';
  showError(`Alive did not start.\nLogs: ${errLog}\n\n${tail}`);
  process.exitCode = 1;
})();
