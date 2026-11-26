import test from 'node:test';
import assert from 'node:assert/strict';
import type { LifeState, Relationship } from '../shared/types.js';
import { expressionPosture } from '../server/expression.js';

function state(overrides: Partial<LifeState> = {}): LifeState {
  return {
    characterId: 'char-main',
    mood: 0.1,
    energy: 0.7,
    hunger: 0.3,
    stress: 0.3,
    health: 0.9,
    social: 0.6,
    sleepDebt: 0.1,
    currentActivity: '工作',
    currentLocation: '办公室',
    outfit: '制服',
    lastTick: 0,
    updatedAt: 0,
    ...overrides
  };
}

function relationship(overrides: Partial<Relationship> = {}): Relationship {
  return {
    id: 'rel',
    characterId: 'char-main',
    peerId: 'local-user',
    peerName: '你',
    affinity: 50,
    trust: 50,
    tension: 0,
    stage: '熟悉',
    notes: '',
    boundaries: '',
    lastInteractionAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

test('low energy makes the posture shorter', () => {
  const posture = expressionPosture(state({ energy: 0.12 }), relationship());
  assert.equal(posture.label, '电量很低');
  assert.ok(posture.maxTokens < 600);
  assert.ok(posture.prompt.includes('短'));
});

test('a bright mood opens the posture up', () => {
  const posture = expressionPosture(
    state({ mood: 0.6, energy: 0.8, stress: 0.2 }),
    relationship({ stage: '亲近' })
  );
  assert.equal(posture.label, '松快');
  assert.ok(posture.maxTokens > 900);
  assert.ok(posture.prompt.includes('小细节'));
});

test('tension is acknowledged without forcing a resolution', () => {
  const posture = expressionPosture(
    state({ stress: 0.2 }),
    relationship({ tension: 70 })
  );
  assert.ok(posture.prompt.includes('紧张'));
});
