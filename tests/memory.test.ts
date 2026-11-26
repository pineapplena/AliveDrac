import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-memory-'));
process.env.DEEPSEEK_API_KEY = '';

const memory = await import('../server/memory.js');

test('manual memory is searchable and injectable', async () => {
  memory.createMemory({
    kind: 'preference',
    title: '画画时会忘记时间',
    content: '对方喜欢在晚上画画，进入状态之后会忘记时间，也不太记得吃饭。',
    importance: 0.8,
    pinned: true
  });
  const found = await memory.searchMemories('画画');
  assert.ok(found.length >= 1);
  assert.equal(found[0].kind, 'preference');
  const context = await memory.buildMemoryContext('你还记得我画画的事吗');
  assert.ok(context.text.includes('画画'));
  assert.ok(context.text.includes('长期记忆'));
});

test('core memories are always included', async () => {
  memory.createMemory({
    kind: 'fact',
    content: '对方对花生过敏，这一点不能忘。',
    importance: 0.9,
    pinned: true
  });
  const context = await memory.buildMemoryContext('在干嘛');
  assert.ok(context.text.includes('花生'));
});

test('timeline can be summarized into memories with the offline engine', async () => {
  const user = memory.createMessage({
    role: 'user',
    content: '今天画了一晚上，手都酸了'
  });
  assert.ok(user.id);
  memory.createMessage({
    role: 'assistant',
    content: '手酸就先停一停。画完的能给我看看吗？'
  });
  const result = await memory.summarize('conv-main', true);
  assert.ok(result);
  assert.ok(result.created >= 1);
  const stats = memory.memoryStats();
  assert.ok(stats.total >= 3);
  assert.equal(stats.timeline, 0);
});

test('deleted memories leave retrieval', async () => {
  const created = memory.createMemory({
    kind: 'event',
    content: '临时记忆：今天试了一条新路线。',
    importance: 0.6
  });
  memory.deleteMemory(created.id);
  const found = await memory.searchMemories('新路线');
  assert.equal(found.some((item) => item.id === created.id), false);
});
