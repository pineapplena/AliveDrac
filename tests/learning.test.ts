import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-learning-'));

const settings = await import('../server/settings.js');
settings.saveSettings({ life: { weatherEnabled: false } });
const learning = await import('../server/learning.js');
const memory = await import('../server/memory.js');
const db = await import('../server/db.js');

test('candidate selection and level are her own ranking, not a fixed list', () => {
  assert.deepEqual(
    learning
      .chooseCandidate([
        { topic: 'a', desire: 0.4 },
        { topic: 'b', desire: 0.8 },
        { topic: 'c', desire: 0.6 }
      ])
      ?.topic,
    'b'
  );
  assert.equal(
    learning.chooseCandidate(
      [
        { topic: '旧问题', desire: 0.75, kind: 'continue' },
        { topic: '新方向', desire: 0.8, kind: 'new' }
      ],
      1
    )?.topic,
    '旧问题'
  );
  assert.ok(learning.interestLevel(1, 0.2) > 0);
  assert.ok(learning.interestLevel(6, 0.9) <= 5);
});

test('interest state continues, completes, pauses or drops from real signals', () => {
  const growing = learning.nextInterestState({
    previousCuriosity: 0.5,
    previousCompetence: 0.2,
    studyCount: 1,
    enjoyment: 0.8,
    difficulty: 0.4,
    wantMore: true,
    nextQuestion: '还想知道下一步'
  });
  assert.equal(growing.status, 'active');
  assert.ok(growing.curiosity > 0.5);
  assert.ok(growing.competence > 0.2);

  const completed = learning.nextInterestState({
    previousCuriosity: 0.6,
    previousCompetence: 0.6,
    studyCount: 3,
    enjoyment: 0.5,
    difficulty: 0.3,
    wantMore: false,
    nextQuestion: ''
  });
  assert.equal(completed.status, 'completed');

  const paused = learning.nextInterestState({
    previousCuriosity: 0.5,
    previousCompetence: 0.15,
    studyCount: 1,
    enjoyment: 0,
    difficulty: 0.5,
    wantMore: false,
    nextQuestion: ''
  });
  assert.equal(paused.status, 'paused');

  const dropped = learning.nextInterestState({
    previousCuriosity: 0.6,
    previousCompetence: 0.2,
    studyCount: 1,
    enjoyment: -0.8,
    difficulty: 0.6,
    wantMore: false,
    nextQuestion: ''
  });
  assert.equal(dropped.status, 'dropped');
  assert.ok(dropped.curiosity < 0.6);
});

test('a full autonomous session creates an interest, a note and a memory', async () => {
  const result = await learning.runLearningSession({ force: true });
  assert.equal(result.started, true);
  assert.ok(result.session?.notes.includes('「'));
  assert.ok((result.session?.notes.length ?? 0) > 30);
  assert.ok((result.session?.enjoyment ?? 0) > 0);
  assert.ok(result.interest);
  assert.equal(result.interest?.studyCount, 1);
  assert.ok(result.interest?.curiosity > 0.4);
  assert.ok(result.candidates?.length === 3);
  assert.equal(result.candidates?.filter((candidate) => candidate.chosen).length, 1);

  const view = learning.buildLearningView();
  assert.equal(view.stats.sessions, 1);
  assert.equal(view.interests.length, 1);
  assert.ok(view.sessions[0].insight);
  assert.ok(learning.getLearningPrompt().includes(result.session!.topic));

  const memories = memory.listMemories({ kind: 'self', status: 'active' });
  assert.ok(memories.some((item) => item.source === 'learning'));
});

test('the same curiosity grows instead of creating duplicate interests', async () => {
  const result = await learning.runLearningSession({ force: true });
  assert.equal(result.started, true);
  const view = learning.buildLearningView();
  assert.equal(view.interests.length, 1);
  assert.equal(view.interests[0].studyCount, 2);
  assert.equal(view.stats.sessions, 2);
});

test('idle interests lose curiosity and eventually stop', () => {
  const now = Date.now();
  const day = 86_400_000;
  db.db
    .prepare(
      `INSERT INTO interests
        (id, character_id, topic, domain, question, summary, level, curiosity, competence,
         study_count, status, origin, last_studied_at, created_at, updated_at)
       VALUES (?, 'char-main', ?, '测试', ?, ?, 1, ?, 0.2, 1, 'active', 'self', ?, ?, ?)`
    )
    .run(
      'interest-idle-test',
      '长期没学的测试',
      '还会不会想起它？',
      '很久没有继续。',
      0.6,
      now - 20 * day,
      now - 20 * day,
      now - 20 * day
    );

  learning.decayIdleInterests();
  const row = db.db
    .prepare('SELECT curiosity, status FROM interests WHERE id = ?')
    .get('interest-idle-test') as { curiosity: number; status: string };
  assert.ok(row.curiosity < 0.6);
  assert.equal(row.status, 'paused');
});

test('turning autonomous learning off stops even a forced session', async () => {
  settings.saveSettings({ learning: { enabled: false } });
  const result = await learning.runLearningSession({ force: true });
  assert.equal(result.started, false);
  assert.match(result.reason, /关闭/);
  settings.saveSettings({ learning: { enabled: true } });
});
