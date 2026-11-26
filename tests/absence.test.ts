import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-absence-'));

const { buildAbsenceSummary } = await import('../server/absence.js');
const { zonedDateTimeToMs } = await import('../server/time.js');

function event(at: number, title: string, detail = '') {
  return {
    id: `evt_${at}`,
    at,
    type: 'offline',
    title,
    detail,
    importance: 0.4,
    shareable: true,
    meta: {}
  };
}

test('absence summary lists concrete moments and dedupes titles', () => {
  const start = new Date('2026-10-21T23:00:00+08:00').getTime();
  const end = new Date('2026-10-22T08:00:00+08:00').getTime();
  const summary = buildAbsenceSummary(start, end, [
    event(start + 60_000, '睡着'),
    event(start + 8 * 3_600_000, '吃早饭', '一碗热粥。'),
    event(start + 8.2 * 3_600_000, '吃早饭', '重复的标题'),
    event(start + 9 * 3_600_000, '处理总务文件', '签完了一叠文件。')
  ]);
  assert.ok(summary.includes('9小时'));
  assert.ok(summary.includes('吃早饭'));
  assert.ok(summary.includes('处理总务文件'));
  assert.equal((summary.match(/吃早饭/g) || []).length, 1);
});

test('local wall time maps to the right epoch', () => {
  const value = zonedDateTimeToMs('2026-10-22', 8 * 60, 'Asia/Shanghai');
  assert.equal(new Date(value).toISOString(), '2026-10-22T00:00:00.000Z');
});
