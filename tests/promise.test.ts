import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-promise-'));
process.env.DEEPSEEK_API_KEY = '';

const memory = await import('../server/memory.js');
const promise = await import('../server/promise.js');
const followup = await import('../server/followup.js');

test('a promise leaves open loops when the character marks it done', () => {
  const created = memory.createMemory({
    kind: 'promise',
    title: '提醒带伞',
    content: '明天提醒对方带伞。',
    importance: 0.7,
    tags: ['未完成', '约定']
  });
  assert.ok(memory.openLoops(10).some((item) => item.id === created.id));
  assert.ok(memory.memoryStats().promises >= 1);

  const done = memory.completePromise(created.id, {
    by: 'self',
    reason: '对方说已经带了伞',
    evidence: '我带伞了'
  });
  assert.ok(done);
  assert.equal(done.status, 'done');
  assert.equal(done.meta.completedBy, 'self');
  assert.equal(done.meta.completedReason, '对方说已经带了伞');
  assert.equal(done.meta.completedEvidence, '我带伞了');
  assert.ok(done.tags.includes('已完成'));
  assert.ok(!done.tags.includes('未完成'));

  assert.ok(!memory.openLoops(10).some((item) => item.id === created.id));
  assert.equal(memory.memoryStats().promises, 0);
  assert.ok(memory.memoryStats().completedPromises >= 1);
  assert.ok(memory.listMemories({ status: 'done', limit: 50 }).some((item) => item.id === created.id));
  assert.ok(!memory.listMemories({ status: 'active', limit: 50 }).some((item) => item.id === created.id));
});

test('a completed promise can be reopened', () => {
  const [completed] = memory.listMemories({ status: 'done', limit: 50 });
  const reopened = memory.reopenPromise(completed.id);
  assert.ok(reopened);
  assert.equal(reopened.status, 'active');
  assert.equal('completedAt' in reopened.meta, false);
  assert.equal('completedBy' in reopened.meta, false);
  assert.ok(reopened.tags.includes('未完成'));
  assert.ok(!reopened.tags.includes('已完成'));
  assert.ok(memory.openLoops(10).some((item) => item.id === completed.id));
  assert.equal(memory.memoryStats().promises, 1);
  assert.equal(memory.memoryStats().completedPromises, 0);
});

test('completing or reopening a non-promise is refused', () => {
  const fact = memory.createMemory({ kind: 'fact', content: '对方喜欢黑咖啡。' });
  assert.equal(memory.completePromise(fact.id), null);
  assert.equal(memory.reopenPromise(fact.id), null);
});

test('review proposals need verbatim evidence and are capped at three', () => {
  const promises = Array.from({ length: 4 }, (_, index) =>
    memory.createMemory({
      kind: 'promise',
      content: `约定 ${index}：一起做点事。`,
      importance: 0.6
    })
  );
  const transcript =
    '对方：第一件事我做完了，第二件也弄好了，第三件已经去过了，第四件也完成了。';
  const proposals = promises.map((item, index) => ({
    id: item.id,
    reason: `第 ${index + 1} 件完成`,
    evidence: ['第一件事我做完了', '第二件也弄好了', '第三件已经去过了', '第四件也完成了'][index]
  }));

  const completed = promise.applyPromiseReview(
    [...proposals, { ...proposals[0], reason: '重复提案' }],
    promises,
    transcript
  );
  assert.equal(completed.length, 3);
  assert.ok(completed.every((item) => item.status === 'done'));

  const another = memory.createMemory({ kind: 'promise', content: '约定：明天带伞。' });
  const none = promise.applyPromiseReview(
    [{ id: another.id, reason: '猜的', evidence: '他一定带了' }],
    [another],
    transcript
  );
  assert.equal(none.length, 0);
});

test('an obvious completion sentence can close a matching promise', () => {
  const item = memory.createMemory({
    kind: 'promise',
    title: '十二点那一格',
    content: '约好十二点那一格见面，我提前把时间空出来。',
    importance: 0.7
  });
  assert.equal(
    promise.obviousCompletionEvidence(item, ['十二点我去了，没等到你']),
    '十二点我去了，没等到你'
  );
  assert.equal(promise.obviousCompletionEvidence(item, ['我吃完饭了']), null);

  const notes = memory.createMemory({
    kind: 'promise',
    title: '整理量子笔记',
    content: '答应明天提醒对方把量子笔记整理好。',
    importance: 0.7
  });
  assert.equal(
    promise.obviousCompletionEvidence(notes, ['我已经把量子笔记整理好了']),
    '我已经把量子笔记整理好了'
  );
});

test('the same promise is not recorded again when it is mentioned repeatedly', () => {
  const original = memory.createMemory({
    kind: 'promise',
    title: '周末看电影',
    content: '约定周末一起去看那部新电影。',
    importance: 0.7
  });
  const similar = memory.findSimilarPromise('约定周末一起去看电影。');
  assert.equal(similar?.id, original.id);
  assert.equal(memory.findSimilarPromise('约定周末一起去爬山。'), null);
  assert.equal(
    memory.findSimilarPromise('换了一种完全不同的说法。', undefined, '周末看电影约定')
      ?.id,
    original.id
  );

  memory.createMemory({
    kind: 'promise',
    title: '周末看电影约定',
    content: '这次换了一种完全不同的表达，但仍然是同一件事。'
  });
  const filmLoops = memory
    .openLoops(20)
    .filter((item) => item.title.includes('周末看电影'));
  assert.equal(filmLoops.length, 1);

  const noted = memory.notePromiseMention(original.id, '今天又提起了一次');
  assert.equal(noted?.meta.mentionCount, 1);
  assert.equal(noted?.meta.lastMentionExcerpt, '今天又提起了一次');

  assert.equal(
    followup.maybeCreateFollowUp('周末一起去看那部新电影吧', '好'),
    false
  );
  const activePromises = memory.listMemories({
    kind: 'promise',
    status: 'active',
    limit: 50
  });
  assert.equal(
    activePromises.filter((item) => item.content.includes('新电影')).length,
    1
  );
});

test('completing one copy closes its duplicate open loops', () => {
  const first = memory.createMemory({
    kind: 'promise',
    title: '周末三杯同泡之约',
    content: '周末要泡三杯茶，同泡同饮。',
    importance: 0.8
  });
  const second = memory.createMemory({
    kind: 'promise',
    title: '周末三杯同泡的约定',
    content: '之前说好的，那个周末三杯同泡。',
    importance: 0.7
  });
  const done = memory.completePromise(first.id, { reason: '已经一起喝过了' });
  assert.equal(done?.status, 'done');
  const sibling = memory.listMemories({ status: 'done', limit: 100 }).find(
    (item) => item.id === second.id
  );
  assert.equal(sibling?.status, 'done');
  assert.equal(sibling?.meta.mergedInto, first.id);
});

test('promise review skips when no provider is configured', async () => {
  const result = await promise.reviewPromises({ force: true });
  assert.equal(result.checked, false);
  assert.equal(result.reason, 'no-provider');
  assert.deepEqual(result.completed, []);
});
