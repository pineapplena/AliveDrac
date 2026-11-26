import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-leisure-'));

const settings = await import('../server/settings.js');
settings.saveSettings({
  life: { weatherEnabled: false },
  leisure: { enabled: true, onlineEnabled: false, allowOvertime: true }
});
const leisure = await import('../server/leisure.js');
const life = await import('../server/life.js');

test('boredom is a state, not a hardcoded mood label', () => {
  const value = leisure.boredomScore();
  assert.ok(value >= 0 && value <= 1);
  const view = leisure.buildLeisureView();
  assert.equal(typeof view.canChoose, 'boolean');
  assert.equal(typeof view.reason, 'string');
});

test('she considers overtime and entertainment, then chooses for herself', async () => {
  const before = life.getState();
  const result = await leisure.runLeisure({ force: true });
  assert.equal(result.started, true);
  assert.ok(result.candidates?.length && result.candidates.length >= 3);
  assert.ok(result.candidates.some((item) => item.kind === 'overtime'));
  assert.equal(result.candidates.filter((item) => item.chosen).length, 1);
  assert.ok(result.session?.activity);
  assert.ok(result.session?.reaction);
  assert.equal(result.view?.stats.today, 1);

  const after = life.getState();
  assert.ok(after.updatedAt >= before.updatedAt);
  const view = leisure.buildLeisureView();
  assert.equal(view.sessions.length, 1);
  assert.ok(view.candidates.length >= 3);
  assert.ok(leisure.getLeisurePrompt().includes(result.session!.activity));
});

test('turning leisure off stops it even when forced', async () => {
  settings.saveSettings({ leisure: { enabled: false } });
  const result = await leisure.runLeisure({ force: true });
  assert.equal(result.started, false);
  assert.match(result.reason, /关闭/);
  settings.saveSettings({ leisure: { enabled: true } });
});
