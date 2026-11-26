import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSchedule } from '../server/schedule-template.js';
import { normalizeBlocks } from '../server/schedule-validation.js';

test('fallback schedule covers the full day without gaps', () => {
  for (const weekday of [0, 3, 6]) {
    const blocks = fallbackSchedule(weekday);
    assert.ok(blocks.length >= 10);
    assert.equal(blocks[0].startMin, 0);
    assert.equal(blocks.at(-1)?.endMin, 1440);
    for (let index = 1; index < blocks.length; index++) {
      assert.equal(blocks[index].startMin, blocks[index - 1].endMin);
    }
  }
});

test('daily schedule varies with the date but keeps human anchors', () => {
  const dates = [
    '2026-10-19',
    '2026-10-20',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
    '2026-10-25'
  ];
  const schedules = dates.map((date) =>
    fallbackSchedule(new Date(`${date}T12:00:00Z`).getUTCDay(), { date })
  );
  const signatures = new Set(
    schedules.map((blocks) =>
      blocks.map((block) => `${block.startMin}-${block.endMin}-${block.activity}`).join('|')
    )
  );
  assert.ok(signatures.size >= 5, 'each day should look different');

  assert.deepEqual(
    fallbackSchedule(1, { date: '2026-10-19' }),
    fallbackSchedule(1, { date: '2026-10-19' })
  );

  for (const blocks of schedules) {
    assert.ok(blocks.length >= 10);
    assert.equal(blocks[0].category, 'sleep');
    assert.equal(blocks.at(-1)?.endMin, 1440);
    for (let index = 1; index < blocks.length; index++) {
      assert.equal(blocks[index].startMin, blocks[index - 1].endMin);
    }
    const wake = blocks.find((block) => block.category === 'sleep' && block.startMin === 0);
    assert.ok(wake && wake.endMin >= 390 && wake.endMin <= 600);
    const meals = blocks.filter((block) => block.category === 'meal');
    assert.ok(meals.length >= 2);
    assert.ok(meals.every((block) => block.startMin >= 300 && block.endMin <= 1260));
  }

  const wakeOf = (blocks: typeof schedules[number]) =>
    blocks.find((block) => block.category === 'sleep' && block.startMin === 0)!.endMin;
  const weekday = fallbackSchedule(1, { date: '2026-10-19' });
  const weekend = fallbackSchedule(6, { date: '2026-10-24' });
  assert.ok(wakeOf(weekend) > wakeOf(weekday));
});

test('normalizeBlocks fills the edges of the day', () => {
  const result = normalizeBlocks({
    blocks: [
      { start: 480, end: 540, activity: '早饭', category: 'meal', shareable: true },
      { start: 540, end: 720, activity: '工作', category: 'work' },
      { start: 720, end: 780, activity: '午饭', category: 'meal' },
      { start: 780, end: 1200, activity: '看书', category: 'leisure' }
    ]
  });
  assert.equal(result.length, 6);
  assert.equal(result[0].startMin, 0);
  assert.equal(result[0].category, 'sleep');
  assert.equal(result.at(-1)?.endMin, 1440);
});

test('overlapping blocks are repaired or dropped', () => {
  const result = normalizeBlocks({
    blocks: [
      { start: 0, end: 600, activity: '工作', category: 'work' },
      { start: 540, end: 720, activity: '午饭', category: 'meal' },
      { start: 600, end: 900, activity: '重复', category: 'other' },
      { start: 900, end: 1200, activity: '看书', category: 'leisure' },
      { start: 1200, end: 1440, activity: '睡觉', category: 'sleep' }
    ]
  });
  for (let index = 1; index < result.length; index++) {
    assert.ok(result[index].startMin >= result[index - 1].endMin);
  }
});

test('too few blocks are rejected', () => {
  assert.deepEqual(
    normalizeBlocks({
      blocks: [
        { start: 0, end: 600, activity: '工作' },
        { start: 600, end: 1200, activity: '看书' },
        { start: 1200, end: 1440, activity: '睡觉' }
      ]
    }),
    []
  );
});
