import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-computer-'));

const settings = await import('../server/settings.js');
const computer = await import('../server/computer.js');

const NOTEPAD = 'C:\\Windows\\System32\\notepad.exe';

test('computer use is off and cannot create a request before consent', () => {
  assert.throws(() =>
    computer.createComputerRequest({
      kind: 'open_url',
      target: 'https://example.com',
      reason: '看看'
    })
  );
});

test('enabling requires the explicit risk agreement', () => {
  assert.throws(() =>
    computer.updateComputerSettings({
      enabled: true,
      agreed: false,
      allowOpenUrls: true,
      dailyLimit: 3,
      allowedApps: []
    })
  );
  const next = computer.updateComputerSettings({
    enabled: true,
    agreed: true,
    allowOpenUrls: true,
    dailyLimit: 3,
    allowedApps: []
  });
  assert.equal(next.enabled, true);
  assert.ok(next.consentAt);
});

test('a public URL can be proposed only from the current sources', () => {
  const pending = computer.createComputerRequest(
    {
      kind: 'open_url',
      target: 'https://example.com/watch',
      reason: '想看看这个视频'
    },
    { allowedUrls: ['https://example.com/watch'] }
  );
  assert.equal(pending.status, 'pending');
  assert.match(pending.risk, /浏览器/);
  assert.throws(() =>
    computer.createComputerRequest(
      {
        kind: 'open_url',
        target: 'https://evil.example/steal',
        reason: '随便看看'
      },
      { allowedUrls: ['https://example.com/watch'] }
    )
  );
  const denied = computer.decideComputerRequest(pending.id, false);
  assert.equal(denied.status, 'denied');
});

test('private and malformed URLs are rejected', () => {
  assert.throws(() =>
    computer.createComputerRequest(
      {
        kind: 'open_url',
        target: 'http://127.0.0.1:8788/api/settings',
        reason: '看看'
      },
      { allowedUrls: ['http://127.0.0.1:8788/api/settings'] }
    )
  );
  assert.throws(() =>
    computer.createComputerRequest({
      kind: 'open_url',
      target: 'file:///C:/Windows/win.ini',
      reason: '看看'
    })
  );
});

test('an app must be explicitly allowlisted and system shells are blocked', () => {
  computer.updateComputerSettings({
    enabled: true,
    agreed: false,
    allowOpenUrls: true,
    dailyLimit: 3,
    allowedApps: [{ label: '记事本', path: NOTEPAD }]
  });
  assert.throws(() =>
    computer.createComputerRequest({
      kind: 'launch_app',
      target: 'C:\\Windows\\System32\\calc.exe',
      reason: '玩'
    })
  );
  assert.throws(() =>
    computer.updateComputerSettings({
      enabled: true,
      agreed: false,
      allowOpenUrls: true,
      dailyLimit: 3,
      allowedApps: [{ label: 'cmd', path: 'C:\\Windows\\System32\\cmd.exe' }]
    })
  );
  const view = computer.getComputerView();
  assert.equal(view.settings.enabled, true);
  assert.equal(view.settings.allowedApps.length, 1);
});

test('turning it off leaves a clear audit trail', () => {
  settings.saveSettings({ computer: { enabled: false } });
  const view = computer.getComputerView();
  assert.equal(view.settings.enabled, false);
  assert.ok(view.history.some((item) => item.status === 'denied'));
});
