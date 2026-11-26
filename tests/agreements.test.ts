import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-agreements-'));

const agreements = await import('../server/agreements.js');
const memory = await import('../server/memory.js');

test('agreements are the same records as memory promises', () => {
  const result = agreements.createAgreement({
    title: '周末一起看电影',
    content: '周末一起看那部新电影，看完再讨论。',
    dueAt: Date.now() + 86_400_000
  });
  assert.equal(result.deduplicated, false);
  assert.equal(result.agreement.status, 'active');
  assert.equal(result.agreement.title, '周末一起看电影');

  const promises = memory.listMemories({ kind: 'promise', status: 'active', limit: 20 });
  assert.ok(promises.some((item) => item.id === result.agreement.id));

  const view = agreements.listAgreements();
  assert.equal(view.active.length, 1);
  assert.equal(view.active[0].dueAt, result.agreement.dueAt);

  const duplicate = agreements.createAgreement({
    title: '周末一起看电影',
    content: '周末一起看那部新电影，看完再讨论。'
  });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.agreement.id, result.agreement.id);
});

test('completing or reopening an agreement updates the memory promise', () => {
  const result = agreements.createAgreement({
    title: '把资料整理好',
    content: '明天把资料整理好，发给对方。'
  });
  const completed = agreements.completeAgreement(result.agreement.id);
  assert.equal(completed.status, 'done');
  assert.ok(agreements.listAgreements().done.some((item) => item.id === result.agreement.id));
  assert.ok(!agreements.listAgreements().active.some((item) => item.id === result.agreement.id));

  const reopened = agreements.reopenAgreement(result.agreement.id);
  assert.equal(reopened.status, 'active');
  assert.ok(agreements.listAgreements().active.some((item) => item.id === result.agreement.id));
});

test('paused agreements record a reminder deadline', () => {
  const result = agreements.createAgreement({
    title: '下周一起整理房间',
    content: '下周一起把房间整理一下。'
  });
  const paused = agreements.pauseAgreementReminders(result.agreement.id, 7);
  assert.ok(paused.remindersPausedUntil && paused.remindersPausedUntil > Date.now());
  assert.equal(agreements.listAgreements().stats.paused, 1);
});
