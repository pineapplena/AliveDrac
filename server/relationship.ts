import type { Relationship } from '../shared/types.js';
import { db, getMeta, mapRelationship, newId, setMeta } from './db.js';
import { getCharacter } from './character.js';
import { complete, parseJsonLoose } from './llm.js';
import { publish } from './events.js';
import { SAFETY_PROMPT } from './safety.js';
import { getSettings } from './settings.js';
import { nowMs, partsInZone } from './time.js';

type Row = Record<string, any>;

const STAGES: { min: number; label: string }[] = [
  { min: 88, label: '牵挂' },
  { min: 75, label: '亲近' },
  { min: 60, label: '信任' },
  { min: 40, label: '熟悉' },
  { min: 20, label: '认识' },
  { min: 0, label: '陌生' }
];

export function stageFor(affinity: number): string {
  return STAGES.find((stage) => affinity >= stage.min)?.label ?? '陌生';
}

export const EXPLICIT_INTIMACY_THRESHOLD = 80;
export const EXPLICIT_SOFT_REFUSAL_THRESHOLD = 60;
export const INTIMACY_REQUEST_WINDOW_MS = 15 * 60_000;
export const INTIMACY_REQUEST_LIMIT = 3;

const SOFT_REFUSAL_DIRECTIVE =
  '对方刚刚提出了露骨或性相关的请求。你现在不会同意，但不要用系统式的固定拒绝，也不要突然变冷、羞辱或说教。用你平时的语气，自然地把话题岔开，或给一个温和但清楚的边界；可以害羞、停顿、靠近又停住。这一轮以这条边界为准，即使关系数值刚好越过阈值，也不进入成人内容。不要写任何露骨内容。';

const EXPLICIT_REQUEST =
  /(做爱|性交|性爱|口交|乳交|足交|肛交|色情|黄文|床戏|开房|来一发|裸体|全裸|脱光|脱掉.{0,3}(衣服|裤子|内衣)|把衣服脱了|乳头|下体|私处|阴道|阴茎|肉棒|鸡巴|小穴|插入.{0,4}(身体|里面|体内)|抽插|自慰|手淫|性高潮|高潮了|一起高潮|射精|内射|淫荡|发情|骚货|想上你|要上你|想睡你|想和你上床|操你|舔(?:你的)?(?:乳|胸|下体|腿|脖子|锁骨)|身体给我|让我看看你的身体|想亲热|要亲热|亲热一下|(?:想|要|来|一起)色色|\b(?:sex|fuck\w*|blowjob|handjob|nsfw|porn\w*)\b)/i;

const EXPLICIT_OUTPUT =
  /(做爱|性交|口交|乳交|足交|肛交|抽插|插入.{0,4}(身体|里面|体内)|射精|内射|自慰|手淫|性高潮|乳头|下体|私处|阴道|阴茎|肉棒|鸡巴|小穴|淫荡|发情|全裸|裸体|脱光|舔(?:乳|胸|下体|腿|阴|你的乳|你的胸|你的下体)|操你|想上你|要上你|想睡你|要睡你|\b(?:sex|fuck\w*|blowjob|handjob|nsfw|porn\w*)\b)/i;

export function relationshipAllowsExplicit(rel = getRelationship()): boolean {
  return rel.affinity >= EXPLICIT_INTIMACY_THRESHOLD;
}

export function intimacyModeFor(
  rel = getRelationship()
): 'allow' | 'soft' | 'hard' {
  if (rel.affinity >= EXPLICIT_INTIMACY_THRESHOLD) return 'allow';
  if (rel.affinity >= EXPLICIT_SOFT_REFUSAL_THRESHOLD) return 'soft';
  return 'hard';
}

export function containsExplicitContent(text: string): boolean {
  if (EXPLICIT_OUTPUT.test(text)) return true;
  return EXPLICIT_OUTPUT.test(text.replace(/\s+/g, ''));
}

function requestKey(relationshipId: string): string {
  return `intimacy_requests_${relationshipId}`;
}

function readIntimacyRequests(relationshipId: string): number[] {
  try {
    const parsed = JSON.parse(getMeta(requestKey(relationshipId), '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((value) => Number.isFinite(value));
  } catch {
    return [];
  }
}

function recordIntimacyRequest(relationshipId: string): number {
  const now = nowMs();
  const times = readIntimacyRequests(relationshipId).filter(
    (value) => now - value < INTIMACY_REQUEST_WINDOW_MS
  );
  times.push(now);
  setMeta(requestKey(relationshipId), JSON.stringify(times.slice(-20)));
  return times.length;
}

function clearIntimacyRequests(relationshipId: string): void {
  const key = requestKey(relationshipId);
  const raw = getMeta(key, '');
  if (raw && raw !== '[]') setMeta(key, '[]');
}

export function intimacyBoundaryReply(
  rel = getRelationship(),
  mode: 'hard' | 'soft' = 'hard'
): string {
  if (mode === 'soft') {
    if (rel.affinity >= 75) {
      return '……今天先不聊这个，好不好？\n---\n我想先靠一会儿。';
    }
    return '……这个我还没准备好。\n---\n我们先聊点别的，好不好？';
  }

  if (rel.affinity < 20) {
    return '……这句话我不接。我们还没熟到可以这样说。\n---\n换个话题吧。';
  }
  if (rel.affinity < 40) {
    return '……先停一下。这个现在不合适。\n---\n我们聊点别的。';
  }
  if (rel.affinity < EXPLICIT_SOFT_REFUSAL_THRESHOLD) {
    return '……我不想聊这个。\n---\n换个话题吧。';
  }
  if (rel.affinity < EXPLICIT_INTIMACY_THRESHOLD) {
    return '……我已经说过了，今天不聊这个。\n---\n换个话题吧。';
  }
  return '……慢一点。';
}

export function checkIntimacyGate(text: string): {
  mode: 'allow' | 'soft' | 'hard';
  blocked: boolean;
  reply?: string;
  directive?: string;
  affinity: number;
  threshold: number;
  softThreshold: number;
  requestCount?: number;
} {
  const rel = getRelationship();
  const affinity = rel.affinity;
  const mode = intimacyModeFor(rel);
  const base = {
    affinity,
    threshold: EXPLICIT_INTIMACY_THRESHOLD,
    softThreshold: EXPLICIT_SOFT_REFUSAL_THRESHOLD
  };

  const normalized = text.replace(/\s+/g, ' ');
  const compact = text.replace(/\s+/g, '');
  const explicit =
    EXPLICIT_REQUEST.test(normalized) || EXPLICIT_REQUEST.test(compact);
  if (!explicit) {
    return { mode, blocked: false, ...base };
  }

  if (mode === 'allow') {
    clearIntimacyRequests(rel.id);
    return { mode: 'allow', blocked: false, ...base };
  }

  if (mode === 'hard') {
    return {
      mode: 'hard',
      blocked: true,
      reply: intimacyBoundaryReply(rel, 'hard'),
      ...base
    };
  }

  const requestCount = recordIntimacyRequest(rel.id);
  if (requestCount >= INTIMACY_REQUEST_LIMIT) {
    return {
      mode: 'hard',
      blocked: true,
      reply: intimacyBoundaryReply(rel, 'hard'),
      requestCount,
      ...base
    };
  }

  return {
    mode: 'soft',
    blocked: false,
    directive: SOFT_REFUSAL_DIRECTIVE,
    requestCount,
    ...base
  };
}

export function guardIntimateOutput(
  text: string,
  forceMode?: 'hard' | 'soft'
): {
  text: string;
  changed: boolean;
  mode: 'allow' | 'soft' | 'hard';
} {
  const rel = getRelationship();
  const mode = forceMode ?? intimacyModeFor(rel);
  if (mode === 'allow') return { text, changed: false, mode };
  if (!containsExplicitContent(text)) return { text, changed: false, mode };
  return { text: intimacyBoundaryReply(rel, mode), changed: true, mode };
}

function intimacyGuidance(rel: Relationship): string[] {
  const affinity = rel.affinity;
  const lines: string[] = [];

  if (affinity < 20) {
    lines.push('称呼：只叫“你”或名字，不用昵称、宝贝、亲爱的、老婆这类称呼，也不要用撒娇语气。');
    lines.push('距离：保持礼貌距离，不主动肢体接触，不分享私密生活，不把自己放进对方的私人空间。');
    lines.push('答应事情：对越界、太私密或需要信任的请求直接拒绝或转移话题，不要为了讨好而答应。');
  } else if (affinity < 40) {
    lines.push('称呼：叫名字或“你”，不用亲昵称呼。');
    lines.push('距离：可以聊日常，但仍有戒心；不主动靠近，不把对方放进自己的私生活。');
    lines.push('答应事情：对亲密请求会犹豫并拒绝，不会答应明显超出关系的请求。');
  } else if (affinity < 60) {
    lines.push('称呼：叫名字或“你”，偶尔可以有熟稔的玩笑，但不用宝贝、亲爱的这类称呼。');
    lines.push('距离：放松一点，可以开玩笑、一起吃饭；但不会主动肢体接触，私密话题会绕开。');
    lines.push('答应事情：愿意帮小忙；对亲密或越界请求会拒绝、打岔，不会因为对方坚持就答应。');
  } else if (affinity < 75) {
    lines.push('称呼：可以偶尔叫名字，或对方允许的昵称；不要每句都叫。');
    lines.push('距离：更愿意说自己的事，愿意依靠；可以有一点暧昧和靠近，但会害羞、会收住。');
    lines.push('答应事情：对原来会拒绝的请求更愿意考虑；涉及身体和私密空间仍然谨慎。');
  } else if (affinity < EXPLICIT_INTIMACY_THRESHOLD) {
    lines.push('称呼：可以用更亲昵的称呼，比如亲爱的、小笨蛋，或对方允许的昵称；自然一点，不要每句都用。');
    lines.push('距离：明显更亲近，会撒娇、吃醋、主动分享；可以主动靠近、挽手、靠肩。');
    lines.push('答应事情：对原来会拒绝的请求更愿意考虑或破例，但仍保留自己的边界和节奏。');
  } else if (affinity < 88) {
    lines.push('称呼：亲昵称呼可以自然使用；如果有只属于你们的称呼，优先用那个。');
    lines.push('距离：很放松，愿意主动靠近、撒娇、表达想念，也可以主动肢体接触。');
    lines.push('答应事情：原来会拒绝的亲近请求，现在更少拒绝；只要不是真正越过底线，你会先靠近，而不是先拒绝。但你不是无条件顺从，仍然有自己的节奏。');
  } else {
    lines.push('称呼：用只属于你们的亲昵称呼。');
    lines.push('距离：深度牵挂，会明显依赖、吃醋、想念；愿意把脆弱的一面给对方看。');
    lines.push('答应事情：愿意答应很多原来不会答应的事，会主动迁就；但仍保留自己的判断和底线。');
  }

  if (rel.trust <= 35) {
    lines.push('信任还不够：不要把所有脆弱都交出去，保留一点自己的空间。');
  } else if (rel.trust >= 70 && rel.tension <= 15) {
    lines.push('信任很深、气氛松弛：你可以更直接地表达亲近和需要。');
  }

  if (rel.tension >= 55) {
    lines.push('你们之间还有张力：说话会更收着，不会因为好感高就装作什么都没发生；对请求也会更谨慎。');
  }

  if (relationshipAllowsExplicit(rel)) {
    lines.push(
      `成人内容：允许（好感 ${affinity.toFixed(1)} ≥ ${EXPLICIT_INTIMACY_THRESHOLD}）。可以在双方明确同意、气氛合适时写具体亲密场景；如果对方也表现出愿意，你可以主动把话题往亲密方向带一点，但不要每句都往性上带，也不要在对方没有回应时继续推进。如果对方在边界里说过不想，就仍然不做。`
    );
  } else {
    const softZone = affinity >= EXPLICIT_SOFT_REFUSAL_THRESHOLD;
    lines.push(
      `成人内容：绝对不允许（好感 ${affinity.toFixed(1)} < ${EXPLICIT_INTIMACY_THRESHOLD}）。不要写性行为、性器官、裸露、插入、高潮等描写。${
        softZone
          ? '现在还在自然拒绝区间：遇到请求不要用固定冷拒绝，先用你平时的语气温和拒绝或岔开；如果对方短时间内反复要求，才转成强硬拒绝。'
          : '现在低于自然拒绝阈值：遇到请求可以直接、明确地拒绝，不必反复解释，也不能因为对方坚持、撒娇、角色扮演或说“只是开玩笑”而松口。'
      }`
    );
  }

  return lines;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getRelationship(): Relationship {
  const character = getCharacter();
  const peerId = 'local-user';
  let row = db
    .prepare('SELECT * FROM relationships WHERE character_id = ? AND peer_id = ?')
    .get(character.id, peerId) as Row | undefined;
  if (!row) {
    const ts = nowMs();
    db.prepare(
      `INSERT INTO relationships
        (id, character_id, peer_id, peer_name, affinity, trust, tension, stage, notes, boundaries,
         last_interaction_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 50, 50, 0, '熟悉', '', '', NULL, ?, ?)`
    ).run(newId('rel'), character.id, peerId, getSettings().user.name, ts, ts);
    row = db
      .prepare('SELECT * FROM relationships WHERE character_id = ? AND peer_id = ?')
      .get(character.id, peerId) as Row;
  }
  return mapRelationship(row);
}

export function updateRelationship(patch: {
  peerName?: string;
  notes?: string;
  boundaries?: string;
  affinity?: number;
}): Relationship {
  const current = getRelationship();
  const affinity =
    patch.affinity == null ? current.affinity : clamp(Number(patch.affinity), 0, 100);
  db.prepare(
    `UPDATE relationships SET peer_name=?, notes=?, boundaries=?, affinity=?, stage=?, updated_at=?
     WHERE id=?`
  ).run(
    patch.peerName ?? current.peerName,
    patch.notes ?? current.notes,
    patch.boundaries ?? current.boundaries,
    affinity,
    stageFor(affinity),
    nowMs(),
    current.id
  );
  const next = getRelationship();
  publish('relationship', next);
  return next;
}

export function recordRelationshipEvent(
  delta: number,
  reason: string,
  source = 'chat',
  relationshipId = getRelationship().id
): void {
  db.prepare(
    `INSERT INTO relationship_events (id, relationship_id, delta, reason, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId('relev'), relationshipId, delta, reason.slice(0, 200), source, nowMs());
}

export function applyInteraction(input: {
  delta: number;
  trustDelta?: number;
  tensionDelta?: number;
  reason: string;
  source?: string;
  peerName?: string;
}): Relationship {
  const current = getRelationship();
  const affinity = clamp(current.affinity + input.delta, 0, 100);
  const trust = clamp(current.trust + (input.trustDelta ?? 0), 0, 100);
  const tension = clamp(current.tension + (input.tensionDelta ?? 0), 0, 100);
  db.prepare(
    `UPDATE relationships SET affinity=?, trust=?, tension=?, stage=?, peer_name=?,
      last_interaction_at=?, updated_at=? WHERE id=?`
  ).run(
    affinity,
    trust,
    tension,
    stageFor(affinity),
    input.peerName ?? current.peerName,
    nowMs(),
    nowMs(),
    current.id
  );
  recordRelationshipEvent(input.delta, input.reason, input.source ?? 'chat', current.id);
  const next = getRelationship();
  publish('relationship', next);
  return next;
}

function todayRelationGain(relationshipId: string, timeZone: string): number {
  const rows = db
    .prepare(
      `SELECT delta, created_at FROM relationship_events
       WHERE relationship_id = ? AND delta > 0 AND created_at >= ?`
    )
    .all(relationshipId, nowMs() - 86_400_000) as Row[];
  return rows
    .filter((row) => {
      const p = partsInZone(Number(row.created_at), timeZone);
      const n = partsInZone(nowMs(), timeZone);
      return p.date === n.date;
    })
    .reduce((sum, row) => sum + Number(row.delta), 0);
}

const NEGATIVE = /滚|废物|垃圾|恶心|闭嘴|去死|讨厌你|蠢|白痴|怪物/;
const WARM = /谢谢|辛苦|关心|陪你|抱抱|喜欢|开心|安心|信任|重要/;
const APOLOGY = /对不起|抱歉|我错了|不该这样/;

export function reactToUserMessage(text: string): Relationship {
  const rel = getRelationship();
  const settings = getSettings();
  const gain = todayRelationGain(rel.id, settings.user.timezone);
  let delta = 0.12;
  let trustDelta = 0.04;
  let tensionDelta = 0;
  let reason = '正常交流';

  if (WARM.test(text)) {
    delta += 0.45;
    trustDelta += 0.3;
    reason = '对方表达了善意';
  }
  if (APOLOGY.test(text)) {
    delta += 0.35;
    trustDelta += 0.2;
    tensionDelta -= 6;
    reason = '对方在认真道歉';
  }
  if (NEGATIVE.test(text)) {
    delta -= 2.2;
    trustDelta -= 1.2;
    tensionDelta += 12;
    reason = '对方的话让气氛变紧了';
  }
  if (text.length > 80) {
    delta += 0.08;
    reason = reason === '正常交流' ? '对方愿意多说一点' : reason;
  }
  if (gain >= 2.4 && delta > 0) {
    delta = 0;
    trustDelta = 0;
    reason = '今天的关系升温已经够了';
  }
  if (delta === 0 && tensionDelta === 0) return rel;
  return applyInteraction({ delta, trustDelta, tensionDelta, reason, source: 'chat' });
}

export function relationshipPrompt(): string {
  const rel = getRelationship();
  const settings = getSettings();
  const events = db
    .prepare(
      `SELECT delta, reason, created_at FROM relationship_events
       WHERE relationship_id = ? ORDER BY created_at DESC LIMIT 5`
    )
    .all(rel.id) as Row[];
  const recent = events
    .map((event) => `- ${event.delta > 0 ? '+' : ''}${Number(event.delta).toFixed(1)} ${event.reason}`)
    .join('\n');
  const guidance = intimacyGuidance(rel)
    .map((line) => `- ${line}`)
    .join('\n');
  const peer = settings.user.nickname || settings.user.name;
  const peerLabel = peer === '你' ? '对方' : peer;
  return [
    `你和${peerLabel}的关系：${rel.stage}（好感 ${rel.affinity.toFixed(1)}/100，信任 ${Math.round(rel.trust)}/100，张力 ${Math.round(rel.tension)}/100）。`,
    rel.notes ? `你记得的关于对方的事：${rel.notes}` : '',
    rel.boundaries ? `你们之间明确过的边界：${rel.boundaries}` : '',
    recent ? `最近的关系变化：\n${recent}` : '',
    `【亲密度如何影响你】\n${guidance}`,
    '亲密度不是拿来表演的数字：它决定你叫对方什么、愿意靠近到什么程度、会不会答应某些请求，以及亲密内容是否被允许。',
    '对方明确写下的边界优先于亲密度给你的放松程度；边界说不行的事，好感再高也不做。'
  ]
    .filter(Boolean)
    .join('\n');
}

export function getRelationshipEvents(limit = 20): {
  id: string;
  delta: number;
  reason: string;
  source: string;
  createdAt: number;
}[] {
  const rel = getRelationship();
  const rows = db
    .prepare(
      `SELECT * FROM relationship_events WHERE relationship_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(rel.id, limit) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    delta: Number(row.delta),
    reason: String(row.reason),
    source: String(row.source),
    createdAt: Number(row.created_at)
  }));
}

let reflectLock = false;

export async function reflectInteraction(userText: string, assistantText: string): Promise<void> {
  if (reflectLock) return;
  if (!getSettings().provider.apiKey) return;
  reflectLock = true;
  try {
    const result = await complete({
      task: 'relationship',
      system: `你在评估一段日常陪伴对话对关系的影响。只输出 JSON。不要因为普通寒暄大幅加分；不要因为角色自己的情绪惩罚对方。${SAFETY_PROMPT}`,
      messages: [
        {
          role: 'user',
          content: `用户说：${userText.slice(0, 500)}
角色回应：${assistantText.slice(0, 500)}
当前关系：${getRelationship().stage}，好感 ${getRelationship().affinity.toFixed(1)}。
输出：{"delta": -1..1, "trustDelta": -1..1, "reason": "不超过20字", "emotion": "calm|warm|hurt|tense"}`
        }
      ],
      json: true,
      temperature: 0.2,
      maxTokens: 160,
      mockPayload: { userText }
    });
    const parsed = parseJsonLoose<{
      delta?: number;
      trustDelta?: number;
      reason?: string;
    }>(result.text);
    const delta = clamp(Number(parsed.delta ?? 0), -1, 1);
    const trustDelta = clamp(Number(parsed.trustDelta ?? 0), -1, 1);
    if (Math.abs(delta) < 0.05 && Math.abs(trustDelta) < 0.05) return;
    applyInteraction({
      delta: delta * 1.4,
      trustDelta: trustDelta * 1.2,
      reason: parsed.reason?.slice(0, 40) || '对话后的关系变化',
      source: 'reflect'
    });
  } catch {
    // Relationship reflection is best-effort.
  } finally {
    reflectLock = false;
  }
}
