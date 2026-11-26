import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-relationship-'));

const relationship = await import('../server/relationship.js');
const expression = await import('../server/expression.js');

test('relationship stages follow affinity thresholds', () => {
  assert.equal(relationship.stageFor(0), '陌生');
  assert.equal(relationship.stageFor(25), '认识');
  assert.equal(relationship.stageFor(45), '熟悉');
  assert.equal(relationship.stageFor(65), '信任');
  assert.equal(relationship.stageFor(80), '亲近');
  assert.equal(relationship.stageFor(95), '牵挂');
});

test('a warm message moves affinity and stage', () => {
  const before = relationship.getRelationship();
  const after = relationship.applyInteraction({
    delta: 20,
    trustDelta: 10,
    reason: '测试'
  });
  assert.equal(after.affinity, before.affinity + 20);
  assert.equal(after.stage, relationship.stageFor(after.affinity));
  const events = relationship.getRelationshipEvents(5);
  assert.equal(events[0].reason, '测试');
});

test('explicit content uses hard, soft, and allow zones', () => {
  relationship.updateRelationship({ affinity: 50 });
  assert.equal(relationship.relationshipAllowsExplicit(), false);
  const hard = relationship.checkIntimacyGate('我们做爱吧');
  assert.equal(hard.mode, 'hard');
  assert.equal(hard.blocked, true);
  assert.ok(hard.reply);
  assert.equal(hard.directive, undefined);
  assert.equal(relationship.checkIntimacyGate('做 爱').blocked, true);
  assert.equal(relationship.checkIntimacyGate('晚上你想吃什么').blocked, false);
  assert.equal(relationship.checkIntimacyGate('我在操作终端').blocked, false);

  const hardGuard = relationship.guardIntimateOutput('她的手指沿着锁骨往下，插入身体。');
  assert.equal(hardGuard.changed, true);
  assert.equal(hardGuard.mode, 'hard');
  assert.match(hardGuard.text, /不想聊|不接|停一下/);
  assert.equal(relationship.guardIntimateOutput('我在操作终端，顺手把数据插入表格。').changed, false);

  const low = relationship.relationshipPrompt();
  assert.match(low, /成人内容：绝对不允许/);
  assert.match(low, /低于自然拒绝阈值/);
  assert.match(low, /称呼：/);

  // Clear the rolling request window through the allow zone.
  relationship.updateRelationship({ affinity: 80 });
  assert.equal(relationship.checkIntimacyGate('我们做爱吧').mode, 'allow');
  relationship.updateRelationship({ affinity: 65 });

  const soft1 = relationship.checkIntimacyGate('我们做爱吧');
  assert.equal(soft1.mode, 'soft');
  assert.equal(soft1.blocked, false);
  assert.equal(soft1.requestCount, 1);
  assert.ok(soft1.directive);
  assert.equal(soft1.reply, undefined);

  const softGuard = relationship.guardIntimateOutput('做 爱');
  assert.equal(softGuard.changed, true);
  assert.equal(softGuard.mode, 'soft');
  assert.match(softGuard.text, /还没准备好|今天先不聊/);

  const soft2 = relationship.checkIntimacyGate('做 爱');
  assert.equal(soft2.mode, 'soft');
  assert.equal(soft2.requestCount, 2);

  const soft3 = relationship.checkIntimacyGate('我们做爱吧');
  assert.equal(soft3.mode, 'hard');
  assert.equal(soft3.blocked, true);
  assert.equal(soft3.requestCount, 3);
  assert.match(soft3.reply ?? '', /我已经说过了/);

  const softPrompt = relationship.relationshipPrompt();
  assert.match(softPrompt, /自然拒绝区间/);

  relationship.updateRelationship({ affinity: 80 });
  relationship.checkIntimacyGate('我们做爱吧');
  relationship.updateRelationship({ affinity: 79 });
  const almost = relationship.relationshipPrompt();
  assert.match(almost, /亲爱的/);
  assert.match(almost, /自然拒绝区间/);
  assert.match(almost, /成人内容：绝对不允许/);
  assert.equal(relationship.checkIntimacyGate('我们做爱吧').mode, 'soft');

  relationship.updateRelationship({ affinity: 80 });
  assert.equal(relationship.relationshipAllowsExplicit(), true);
  assert.equal(relationship.checkIntimacyGate('我们做爱吧').mode, 'allow');
  const explicit = '我靠近你，和你做爱。';
  const allowGuard = relationship.guardIntimateOutput(explicit);
  assert.equal(allowGuard.changed, false);
  assert.equal(allowGuard.mode, 'allow');

  const high = relationship.relationshipPrompt();
  assert.match(high, /成人内容：允许/);
  assert.match(high, /亲昵称呼/);
});

test('tension rises on friction, falls on repair, and changes posture', () => {
  relationship.updateRelationship({ affinity: 70 });
  relationship.applyInteraction({ delta: 0, tensionDelta: -100, reason: '重置张力' });

  const before = relationship.getRelationship();
  const angry = relationship.reactToUserMessage('滚开');
  assert.ok(angry.tension > before.tension);
  assert.ok(angry.tension >= 6);

  const sorry = relationship.reactToUserMessage('对不起');
  assert.ok(sorry.tension < angry.tension);

  const tense = relationship.applyInteraction({
    delta: 0,
    tensionDelta: 80,
    reason: '测试张力'
  });
  assert.ok(tense.tension >= 55);
  assert.match(relationship.relationshipPrompt(), /还有张力/);

  const state = {
    mood: 0.1,
    energy: 0.6,
    hunger: 0.2,
    stress: 0.2,
    social: 0.8
  } as any;
  const posture = expression.expressionPosture(state, tense);
  assert.match(posture.prompt, /紧张/);

  const repaired = relationship.applyInteraction({
    delta: 0,
    tensionDelta: -100,
    reason: '测试修复'
  });
  assert.equal(repaired.tension, 0);
  assert.doesNotMatch(relationship.relationshipPrompt(), /还有张力/);
});
