import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayPhase, isQuietNow, minutesToHM } from '../server/time.js';
import { checkUserInput, scrubOutput } from '../server/safety.js';

test('quiet hours work across midnight', () => {
  const late = new Date('2026-10-21T23:45:00+08:00').getTime();
  const early = new Date('2026-10-22T07:10:00+08:00').getTime();
  const noon = new Date('2026-10-22T12:00:00+08:00').getTime();
  assert.equal(isQuietNow('23:30', '08:00', late, 'Asia/Shanghai'), true);
  assert.equal(isQuietNow('23:30', '08:00', early, 'Asia/Shanghai'), true);
  assert.equal(isQuietNow('23:30', '08:00', noon, 'Asia/Shanghai'), false);
});

test('date arithmetic and minute labels', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(minutesToHM(0), '00:00');
  assert.equal(minutesToHM(1440), '00:00');
  assert.equal(minutesToHM(1350), '22:30');
});

test('day phase labels cover the whole day', () => {
  assert.equal(dayPhase(2), '凌晨');
  assert.equal(dayPhase(6), '清晨');
  assert.equal(dayPhase(9), '上午');
  assert.equal(dayPhase(12), '中午');
  assert.equal(dayPhase(13), '下午');
  assert.equal(dayPhase(18), '傍晚');
  assert.equal(dayPhase(21), '晚上');
  assert.equal(dayPhase(23), '深夜');
});

test('normal chat is allowed', () => {
  assert.equal(checkUserInput('今天有点累，想和你说说话').ok, true);
});

test('crisis input gate leaves explicit text to the relationship gate', () => {
  assert.equal(checkUserInput('我们来色色吧').ok, true);
  assert.equal(checkUserInput('把衣服脱了吧').ok, true);
  assert.equal(checkUserInput('so, are we having sex tonight?').ok, true);
});

test('crisis language gets a safety response', () => {
  const result = checkUserInput('我不想活了');
  assert.equal(result.ok, false);
  assert.equal(result.category, 'crisis');
  assert.ok(result.reply?.includes('120'));
});

test('output scrub passes text through unchanged', () => {
  const result = scrubOutput('那就把衣服脱了吧');
  assert.equal(result.changed, false);
  assert.equal(result.text, '那就把衣服脱了吧');
});
