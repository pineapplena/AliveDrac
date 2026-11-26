import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-fragment-'));

const life = await import('../server/life.js');

const state = {
  mood: 0.1,
  energy: 0.5,
  stress: 0.2,
  hunger: 0.3,
  social: 0.5
} as any;

const weather = {
  label: '小雨',
  temperature: 12
} as any;

const mealBlock = {
  id: 'block-meal',
  startMin: 720,
  endMin: 780,
  activity: '吃午饭',
  location: '中枢局 · 食堂',
  category: 'meal',
  detail: '今天食堂有新的液态电池面包。',
  shareable: true
} as any;

test('fallback life fragment is concrete instead of a schedule label', () => {
  const fragment = life.fallbackLifeFragment(mealBlock, state, weather);
  assert.ok(fragment.title.length > 0);
  assert.ok(fragment.detail.length > 0);
  assert.doesNotMatch(fragment.title, /^开始/);
  assert.match(fragment.detail, /食堂|外卖|自己煮|小馆/);
  assert.match(fragment.detail, /我/);
  assert.doesNotMatch(fragment.detail, /她/);
  assert.equal(fragment.source, 'fallback');
});

test('life fragment generation falls back without a model provider', async () => {
  const fragment = await life.generateLifeFragment({
    block: mealBlock,
    state,
    weather,
    date: '2026-10-24'
  });
  assert.equal(fragment.source, 'fallback');
  assert.ok(fragment.detail.length > 10);
  assert.match(fragment.detail, /我/);
});
