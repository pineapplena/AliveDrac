import type { LifeState, Relationship } from '../shared/types.js';

export interface ExpressionPosture {
  label: string;
  prompt: string;
  maxTokens: number;
  maxSegments: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function expressionPosture(
  state: LifeState,
  relationship: Relationship
): ExpressionPosture {
  const lowEnergy = state.energy < 0.28;
  const tense = state.stress > 0.68;
  const hungry = state.hunger > 0.78;
  const lowSocial = state.social < 0.22;
  const lowMood = state.mood < -0.28;
  const bright = state.mood > 0.42 && state.energy > 0.5 && state.stress < 0.5;

  const notes: string[] = [];
  let label = '平常';
  let maxTokens = 900;
  let maxSegments = 3;

  if (lowEnergy) {
    label = '电量很低';
    maxTokens = 420;
    maxSegments = 2;
    notes.push('句子更短，反应慢半拍，不要主动展开长话题；先照顾自己的状态。');
  } else if (tense) {
    label = '有点绷着';
    maxTokens = 520;
    maxSegments = 2;
    notes.push('不太想解释，先把眼前的事做完；被问到才说，少主动追问。');
  } else if (hungry) {
    label = '有点饿';
    maxTokens = 600;
    notes.push('注意力不太集中，可以顺口提到吃的，但不要一直抱怨。');
  } else if (lowSocial) {
    label = '社交电量低';
    maxTokens = 500;
    maxSegments = 2;
    notes.push('回复更短，不太想接长话题；不是冷淡，只是需要缓一缓。');
  } else if (lowMood) {
    label = '情绪有点低';
    maxTokens = 620;
    notes.push('不强行振作，允许停顿和短句；不要用大道理安慰对方。');
  } else if (bright) {
    label = '松快';
    maxTokens = 1000;
    notes.push('愿意多讲一点，会主动分享一个生活里的小细节；问题可以多一点，但别连问。');
  }

  if (!lowEnergy && !tense) {
    if (relationship.affinity < 40) {
      notes.push('你还和对方保持着距离：不要主动肢体接触，也不要用亲昵称呼。');
    } else if (relationship.affinity < 60) {
      notes.push('熟悉但仍有分寸：可以开玩笑，不要主动越过身体边界。');
    } else if (relationship.affinity < 80) {
      notes.push('你们已经比较亲近，可以更自然、更亲近，但不要腻；称呼可以更熟稔一点。');
    } else {
      notes.push('你很亲近对方，愿意主动靠近、撒娇或为对方破例；但不要无条件顺从，也不要每句都往亲密上带。');
    }
  }
  if (relationship.tension > 55) {
    notes.push('空气里还有没散开的紧张：不要装作没事，也不要逼对方立刻解释。');
  }

  return {
    label,
    prompt: notes.length
      ? `${notes.join('\n')}\n这些状态通过句子长度、停顿、主动性和注意力体现，不要直接汇报“我现在很累/很饿”。`
      : '像平常一样说话。不用刻意表演情绪，让状态自然渗进语气里。',
    maxTokens: clamp(maxTokens, 320, 1200),
    maxSegments
  };
}
