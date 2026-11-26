import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-followup-'));

const followup = await import('../server/followup.js');
const memory = await import('../server/memory.js');

test('a future plan becomes an open loop', () => {
  const created = followup.maybeCreateFollowUp(
    '明天要去医院复查，有点紧张',
    '我陪你去，别一个人扛。'
  );
  assert.equal(created, true);
  const found = memory.listMemories({ kind: 'promise', status: 'active' });
  assert.equal(found.length, 1);
  assert.ok(found[0].content.includes('医院'));
});

test('the same follow-up is not created twice in a short window', () => {
  const created = followup.maybeCreateFollowUp(
    '周末想在家画画，不想出门',
    '那就画一天。'
  );
  assert.equal(created, false);
  assert.equal(memory.listMemories({ kind: 'promise', status: 'active' }).length, 1);
});

test('small talk is ignored', () => {
  assert.equal(followup.maybeCreateFollowUp('明天见', '明天见。'), false);
  assert.equal(followup.maybeCreateFollowUp('今天天气不错', '是啊。'), false);
  assert.equal(
    followup.maybeCreateFollowUp('嗯嗯，妈妈的怀里好温暖，晚安啦', '晚安，早点睡。'),
    false
  );
});

test('an assistant promise is captured even when the user only says okay', () => {
  const created = followup.maybeCreateFollowUp(
    '嗯，好的。',
    '那我明天下午帮你把资料整理好。'
  );
  assert.equal(created, true);
  const found = memory.listMemories({ kind: 'promise', status: 'active', limit: 50 });
  assert.ok(found.some((item) => item.content.includes('资料')));
});

test('a user self-promise is captured without an explicit future word', () => {
  assert.equal(
    followup.maybeCreateFollowUp('我会按时把药吃完', '嗯，我盯着你。'),
    true
  );
});
