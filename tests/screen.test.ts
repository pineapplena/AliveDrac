import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-screen-'));

const screen = await import('../server/screen.js');

test('sensitive windows are recognized before vision', () => {
  assert.equal(screen.isSensitiveWindow('1Password - 登录', '1Password'), true);
  assert.equal(screen.isSensitiveWindow('银行 - 账户详情', 'chrome'), true);
  assert.equal(screen.isSensitiveWindow('Visual Studio Code - alive.ts', 'Code'), false);
  assert.equal(screen.isSensitiveWindow('Bilibili - 视频', 'chrome'), false);
});

test('screen peek settings require consent and clamp values', () => {
  assert.throws(() => screen.updateScreenSettings({ enabled: true }), /同意|隐私/);
  const settings = screen.updateScreenSettings({
    enabled: true,
    consent: true,
    intervalMin: 999,
    probability: 5,
    dailyCap: 999
  });
  assert.ok(settings.consentAt);
  assert.equal(settings.enabled, true);
  assert.equal(settings.intervalMin, 120);
  assert.equal(settings.probability, 0.9);
  assert.equal(settings.dailyCap, 12);
});

test('screen view exposes capabilities without observations', () => {
  const view = screen.getScreenView();
  assert.equal(view.observations.length, 0);
  assert.equal(view.todayCount, 0);
  assert.equal(view.capabilities.capture, process.platform === 'win32');
  assert.equal(typeof view.capabilities.vision, 'boolean');
});

test('screen peeking willingness stays bounded', () => {
  const state = {
    mood: 0.4,
    energy: 0.7,
    social: 0.3
  } as any;
  const chance = screen.screenPeekChance(state, 0.35);
  assert.ok(chance >= 0.03 && chance <= 0.9);
});
