import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'alive-chat-clear-'));
process.env.ALIVE_DATA_DIR = dataDir;
process.env.DEEPSEEK_API_KEY = '';

const memory = await import('../server/memory.js');
const uploads = await import('../server/uploads.js');

test('clearing chat history drops messages and raw timeline but keeps memories', () => {
  const kept = memory.createMemory({
    kind: 'preference',
    title: '她记得的口味',
    content: '对方喜欢刚出炉的可颂，配一杯黑咖啡。',
    importance: 0.8
  });
  memory.createMessage({ role: 'user', content: '今天路过面包店，买了可颂。' });
  memory.createMessage({ role: 'assistant', content: '可颂要趁热吃。' });

  const before = memory.getMessages('conv-main', 200);
  assert.ok(before.length >= 3, 'seeded greeting plus the two new messages');
  assert.ok(memory.memoryStats().timeline >= 2);
  assert.ok(memory.unreadCount() >= 1);

  const epochBefore = memory.conversationEpoch();
  const result = memory.clearConversation('conv-main');

  assert.equal(result.conversationId, 'conv-main');
  assert.equal(result.messages, before.length);
  assert.ok(result.timeline >= 2);
  assert.ok(result.clearedAt > 0);

  assert.equal(memory.getMessages('conv-main', 200).length, 0);
  assert.equal(memory.memoryStats().timeline, 0);
  assert.equal(memory.unreadCount(), 0);
  assert.equal(memory.conversationEpoch(), epochBefore + 1);
  assert.ok((memory.conversationClearedAt() ?? 0) > 0);
  assert.ok(memory.getConversation().lastReadAt > 0);

  const memories = memory.listMemories({ status: 'active', limit: 50 });
  assert.ok(memories.some((item) => item.id === kept.id));
});

test('clearing an already empty conversation changes nothing', () => {
  const result = memory.clearConversation('conv-main');
  assert.equal(result.messages, 0);
  assert.equal(result.timeline, 0);
  assert.equal(result.uploads, 0);
  assert.equal(memory.getMessages('conv-main', 200).length, 0);
});

test('clearing chat history removes images sent in the conversation', () => {
  const dataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const attachment = uploads.saveUpload({ dataUrl, name: 'pixel.png' });
  const filePath = join(dataDir, 'assets', 'uploads', attachment.name);
  assert.ok(existsSync(filePath));

  memory.createMessage({
    role: 'user',
    content: '（发来一张图片）',
    segments: ['（发来一张图片）'],
    meta: { attachments: [attachment] }
  });

  const result = memory.clearConversation('conv-main');
  assert.equal(result.messages, 1);
  assert.equal(result.uploads, 1);
  assert.equal(uploads.getUpload(attachment.id), null);
  assert.equal(existsSync(filePath), false);
  assert.equal(memory.getMessages('conv-main', 200).length, 0);
});
