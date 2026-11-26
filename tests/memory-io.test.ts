import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-memory-io-'));
const memory = await import('../server/memory.js');

test('export contains all visible memories and a stable format', () => {
  const kept = memory.createMemory({
    kind: 'fact',
    title: '一件事实',
    content: '她记得窗台上有一盆薄荷。',
    importance: 0.8,
    tags: ['植物']
  });
  const archived = memory.createMemory({
    kind: 'event',
    title: '旧事',
    content: '一条已经淡忘的旧事。'
  });
  memory.updateMemory(archived.id, { status: 'archived' });

  const file = memory.exportMemories();
  assert.equal(file.format, 'alive-memory-v1');
  assert.equal(file.version, 1);
  assert.equal(file.count, 2);
  assert.equal(file.memories.length, 2);
  assert.ok(file.memories.some((item) => item.id === kept.id));
  assert.ok(file.memories.some((item) => item.id === archived.id && item.status === 'archived'));
});

test('import skips duplicates, preserves archive state, and keeps explicit content', () => {
  const result = memory.importMemories({
    memories: [
      {
        kind: 'fact',
        title: '导入的事实',
        content: '她记得窗台上有一盆薄荷。',
        importance: 0.9,
        tags: ['植物', '导入']
      },
      {
        kind: 'event',
        title: '导入的旧事',
        content: '一条从别的备份里带回来的旧事。',
        status: 'archived'
      },
      {
        kind: 'fact',
        content: '做爱'
      }
    ]
  });
  assert.equal(result.total, 3);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.invalid, 0);
  assert.equal(result.errors.length, 0);

  const imported = memory.listMemories({ status: 'all', limit: 20 });
  assert.ok(imported.some((item) => item.content.includes('别的备份') && item.status === 'archived'));
  assert.ok(imported.some((item) => item.content === '做爱'));
  assert.ok(imported.some((item) => item.source === 'import'));
});

test('bulk delete removes selected memories and reports the count', () => {
  const all = memory.listMemories({ status: 'all', limit: 20 });
  const ids = all.slice(0, 2).map((item) => item.id);
  const deleted = memory.deleteMemories(ids);
  assert.equal(deleted, 2);
  assert.equal(memory.listMemories({ status: 'all', limit: 20 }).length, all.length - 2);
});
