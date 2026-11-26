import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-proactive-state-'));

const proactive = await import('../server/proactive.js');

const candidate = {
  type: 'open_loop',
  reason: '周末一起看电影的约定还没完成。',
  detail: '这是一件还没完成的事。',
  score: 0.7,
  payload: { memoryId: 'mem_test_topic' }
};

test('the same topic keeps one lifecycle record across evaluations', () => {
  const blocked = proactive.syncCandidateEvent(candidate, {
    candidate,
    allowed: false,
    blockedBy: ['免打扰时段']
  });
  assert.equal(blocked.state, 'blocked');
  assert.deepEqual(blocked.blockers, ['免打扰时段']);

  const eligible = proactive.syncCandidateEvent(candidate, {
    candidate,
    allowed: true,
    blockedBy: []
  });
  assert.equal(eligible.id, blocked.id);
  assert.equal(eligible.state, 'eligible');
  assert.equal(proactive.getProactiveEvents(10).length, 1);
});
