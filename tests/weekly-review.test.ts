import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-weekly-'));
const { startOfWeek, weekRange } = await import('../server/weekly-review.js');

test('weekly review ranges start on Monday and end on Sunday', () => {
  assert.equal(startOfWeek('2026-11-23'), '2026-11-23');
  assert.deepEqual(weekRange('2026-11-23'), {
    start: '2026-11-23',
    end: '2026-11-29'
  });
  assert.equal(startOfWeek('2026-11-29'), '2026-11-23');
});

test('week ranges cross month boundaries', () => {
  assert.deepEqual(weekRange('2026-12-01'), {
    start: '2026-11-30',
    end: '2026-12-06'
  });
});
