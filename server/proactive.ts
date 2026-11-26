import type {
  LifeState,
  ProactiveEvent,
  ProactiveEventState,
  ProactiveRecord,
  ScheduleBlock,
  Weather
} from '../shared/types.js';
import { getCharacter } from './character.js';
import { db, getMeta, mapProactive, newId, setMeta } from './db.js';
import { complete } from './llm.js';
import { addEvent, currentMomentPrompt, getBlocks, getState } from './life.js';
import { buildProactiveSystem } from './prompt.js';
import {
  buildMemoryContext,
  conversationClearedAt,
  createMessage,
  getMessages,
  noteProactiveMention,
  openLoops
} from './memory.js';
import { publish } from './events.js';
import { scrubOutput } from './safety.js';
import { getSettings } from './settings.js';
import {
  dateKey,
  isQuietNow,
  nowMs,
  partsInZone
} from './time.js';
import { getWeather, weatherLine } from './weather.js';
import { dueNotes } from './notes.js';
import { getRelationship } from './relationship.js';
import { expressionPosture } from './expression.js';
import { listSessions } from './learning.js';
import { listLeisureSessions } from './leisure.js';
import {
  latestScreenObservationForProactive,
  markScreenObservationCommented
} from './screen.js';

type Row = Record<string, any>;

export interface Candidate {
  type: string;
  reason: string;
  detail: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface CandidateDecision {
  candidate: Candidate;
  allowed: boolean;
  blockedBy: string[];
}

const TIME_BOUND_PROMISE =
  /(今天|今晚|明早|明天|下午|上午|中午|十二点|\d{1,2}\s*点|周末|下周|这个周末)/;

function topicText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;:：；"'“”‘’（）()【】\[\]「」『』《》〈〉…—\-_/\\]/g, '')
    .slice(0, 300);
}

function topicGrams(text: string): Set<string> {
  const normalized = topicText(text);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index++) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

export function topicSimilarity(left: string, right: string): number {
  const a = topicText(left);
  const b = topicText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return 1;
  const ga = topicGrams(a);
  const gb = topicGrams(b);
  if (!ga.size || !gb.size) return 0;
  let common = 0;
  for (const gram of ga) if (gb.has(gram)) common++;
  return common / Math.min(ga.size, gb.size);
}

function sentSimilar(type: string, text: string, hours: number): { count: number; lastAt: number } {
  const rows = db
    .prepare(
      `SELECT reason, sent_at FROM proactive_messages
       WHERE character_id = ? AND candidate_type = ? AND status IN ('sent','delivered','read','replied','ignored')
       AND sent_at IS NOT NULL AND sent_at >= ?`
    )
    .all(getCharacter().id, type, nowMs() - hours * 3_600_000) as Row[];
  let count = 0;
  let lastAt = 0;
  for (const row of rows) {
    if (topicSimilarity(text, String(row.reason ?? '')) < 0.55) continue;
    count++;
    lastAt = Math.max(lastAt, Number(row.sent_at ?? 0));
  }
  return { count, lastAt };
}

function candidateTopicKey(candidate: Candidate): string {
  const payload = candidate.payload ?? {};
  if (payload.memoryId) return `open_loop:${String(payload.memoryId)}`;
  if (payload.noteId) return `reminder:${String(payload.noteId)}`;
  if (payload.observationId) return `screen:${String(payload.observationId)}`;
  if (payload.topic) return `learning:${topicText(String(payload.topic)).slice(0, 80)}`;
  if (payload.sessionId) return `${candidate.type}:${String(payload.sessionId)}`;
  if (payload.title) return `important_date:${topicText(String(payload.title)).slice(0, 60)}`;
  if (candidate.type === 'schedule_share') {
    return `schedule:${dateKey(nowMs(), getSettings().user.timezone)}:${topicText(
      String(payload.activity ?? candidate.reason)
    ).slice(0, 60)}`;
  }
  if (candidate.type === 'weather_change') {
    return `weather:${topicText(String(payload.weather ?? candidate.reason)).slice(0, 60)}`;
  }
  if (candidate.type === 'idle_share') {
    return `idle:${dateKey(nowMs(), getSettings().user.timezone)}`;
  }
  return `${candidate.type}:${topicText(candidate.reason).slice(0, 80)}`;
}

function mapEvent(row: Row): ProactiveEvent {
  return {
    id: String(row.id),
    topicKey: String(row.topic_key),
    candidateType: String(row.candidate_type),
    reason: String(row.reason),
    detail: String(row.detail ?? ''),
    state: row.state as ProactiveEventState,
    score: Number(row.score ?? 0),
    blockers: JSON.parse(String(row.blockers ?? '[]')) as string[],
    attempts: Number(row.attempts ?? 0),
    payload: JSON.parse(String(row.payload ?? '{}')) as Record<string, unknown>,
    messageId: row.message_id ? String(row.message_id) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    sentAt: row.sent_at == null ? null : Number(row.sent_at),
    deliveredAt: row.delivered_at == null ? null : Number(row.delivered_at),
    readAt: row.read_at == null ? null : Number(row.read_at),
    repliedAt: row.replied_at == null ? null : Number(row.replied_at),
    closedAt: row.closed_at == null ? null : Number(row.closed_at),
    closeReason: String(row.close_reason ?? '')
  };
}

export function getProactiveEvents(limit = 40): ProactiveEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM proactive_events WHERE character_id = ?
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(getCharacter().id, Math.max(1, Math.min(limit, 200))) as Row[];
  return rows.map(mapEvent);
}

function getEventByTopic(topicKey: string): ProactiveEvent | null {
  const row = db
    .prepare('SELECT * FROM proactive_events WHERE character_id = ? AND topic_key = ?')
    .get(getCharacter().id, topicKey) as Row | undefined;
  return row ? mapEvent(row) : null;
}

function getEventById(id: string): ProactiveEvent | null {
  const row = db
    .prepare('SELECT * FROM proactive_events WHERE character_id = ? AND id = ?')
    .get(getCharacter().id, id) as Row | undefined;
  return row ? mapEvent(row) : null;
}

const TERMINAL_EVENT_STATES = new Set<ProactiveEventState>([
  'replied',
  'ignored',
  'expired'
]);
const ACTIVE_EVENT_STATES = new Set<ProactiveEventState>([
  'selected',
  'generating',
  'sent',
  'delivered',
  'read'
]);

/** 把一个候选同步到“同一话题”的唯一生命周期记录。 */
export function syncCandidateEvent(candidate: Candidate, decision: CandidateDecision): ProactiveEvent {
  const topicKey = candidateTopicKey(candidate);
  const now = nowMs();
  const existing = getEventByTopic(topicKey);
  if (existing && TERMINAL_EVENT_STATES.has(existing.state)) {
    // 已结束的话题在 14 天内不重新开一条，交给 history/topic dedupe。
    if (now - existing.updatedAt < 14 * 86_400_000) return existing;
  }
  if (existing && ACTIVE_EVENT_STATES.has(existing.state)) return existing;

  const state: ProactiveEventState = decision.allowed ? 'eligible' : 'blocked';
  if (!existing) {
    const id = newId('pev');
    db.prepare(
      `INSERT INTO proactive_events
        (id, character_id, topic_key, candidate_type, reason, detail, state, score, blockers,
         attempts, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      id,
      getCharacter().id,
      topicKey,
      candidate.type,
      candidate.reason.slice(0, 500),
      candidate.detail.slice(0, 1000),
      state,
      candidate.score,
      JSON.stringify(decision.blockedBy),
      JSON.stringify(candidate.payload ?? {}),
      now,
      now
    );
    return getEventByTopic(topicKey)!;
  }

  db.prepare(
    `UPDATE proactive_events SET candidate_type = ?, reason = ?, detail = ?, state = ?,
       score = ?, blockers = ?, payload = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    candidate.type,
    candidate.reason.slice(0, 500),
    candidate.detail.slice(0, 1000),
    state,
    candidate.score,
    JSON.stringify(decision.blockedBy),
    JSON.stringify(candidate.payload ?? {}),
    now,
    existing.id
  );
  return getEventById(existing.id)!;
}

function transitionEvent(
  id: string,
  allowed: ProactiveEventState[],
  state: ProactiveEventState,
  extra: Record<string, string | number | null> = {}
): ProactiveEvent | null {
  const event = getEventById(id);
  if (!event || !allowed.includes(event.state)) return event;
  const columns = Object.keys(extra);
  const assignments = ['state = ?', 'updated_at = ?', ...columns.map((column) => `${column} = ?`)];
  db.prepare(`UPDATE proactive_events SET ${assignments.join(', ')} WHERE id = ?`).run(
    state,
    nowMs(),
    ...columns.map((column) => extra[column]),
    id
  );
  return getEventById(id);
}

function eventForMessage(messageId: string): ProactiveEvent | null {
  const row = db
    .prepare('SELECT * FROM proactive_events WHERE character_id = ? AND message_id = ?')
    .get(getCharacter().id, messageId) as Row | undefined;
  if (row) return mapEvent(row);
  const message = db
    .prepare('SELECT meta FROM proactive_messages WHERE id = ? AND character_id = ?')
    .get(messageId, getCharacter().id) as Row | undefined;
  if (!message) return null;
  const meta = JSON.parse(String(message.meta ?? '{}')) as Record<string, unknown>;
  return meta.eventId ? getEventById(String(meta.eventId)) : null;
}

function markEventForMessage(
  messageId: string,
  state: ProactiveEventState,
  extra: Record<string, string | number | null>
): void {
  const event = eventForMessage(messageId);
  if (!event) return;
  transitionEvent(event.id, ['sent', 'delivered', 'read'], state, extra);
}

function countSentToday(timeZone: string): number {
  const rows = db
    .prepare(
      `SELECT sent_at FROM proactive_messages WHERE character_id = ? AND status IN ('sent','delivered','read','replied','ignored')
       AND sent_at IS NOT NULL AND sent_at >= ?`
    )
    .all(getCharacter().id, nowMs() - 2 * 86_400_000) as Row[];
  const today = dateKey(nowMs(), timeZone);
  return rows.filter((row) => dateKey(Number(row.sent_at), timeZone) === today).length;
}

function lastSentAt(): number | null {
  const row = db
    .prepare(
      `SELECT MAX(sent_at) AS at FROM proactive_messages WHERE character_id = ?
       AND status IN ('sent','delivered','read','replied','ignored')`
    )
    .get(getCharacter().id) as Row | undefined;
  return row?.at == null ? null : Number(row.at);
}

function recentlySent(type: string, reason: string, hours: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM proactive_messages
       WHERE character_id = ? AND candidate_type = ? AND status IN ('sent','delivered','read','replied','ignored')
       AND reason LIKE ? AND sent_at >= ? LIMIT 1`
    )
    .get(
      getCharacter().id,
      type,
      `%${reason.slice(0, 80)}%`,
      nowMs() - hours * 3_600_000
    ) as Row | undefined;
  return Boolean(row);
}

function consecutiveAssistantMessages(): number {
  const rows = db
    .prepare(
      `SELECT role FROM messages WHERE conversation_id = 'conv-main' ORDER BY created_at DESC LIMIT 8`
    )
    .all() as Row[];
  let count = 0;
  for (const row of rows) {
    if (row.role === 'user') break;
    if (row.role === 'assistant') count++;
  }
  return count;
}

function lastUserAt(): number | null {
  const row = db
    .prepare(
      `SELECT MAX(created_at) AS at FROM messages WHERE conversation_id = 'conv-main' AND role = 'user'`
    )
    .get() as Row | undefined;
  return row?.at == null ? null : Number(row.at);
}

export function collectCandidates(): Candidate[] {
  const settings = getSettings();
  const state = getState();
  const today = dateKey(nowMs(), settings.user.timezone);
  const blocks = getBlocks(today);
  const minutes = partsInZone(nowMs(), settings.user.timezone).minutes;
  const current = blocks.find((block) => minutes >= block.startMin && minutes < block.endMin) ?? null;
  const candidates: Candidate[] = [];

  if (
    current &&
    current.shareable &&
    current.detail &&
    current.category !== 'sleep' &&
    sentSimilar('schedule_share', `${current.activity} ${current.detail}`, 72).count === 0
  ) {
    candidates.push({
      type: 'schedule_share',
      reason: `你正在${current.activity}，有一个可以分享的小细节。`,
      detail: current.detail,
      score: 0.58,
      payload: { activity: current.activity, location: current.location, detail: current.detail }
    });
  }

  const loops = openLoops(8);
  let loopCandidates = 0;
  for (const loop of loops) {
    const content = String(loop.content);
    const pausedUntil = Number(loop.meta.remindersPausedUntil ?? 0);
    if (pausedUntil > nowMs()) continue;
    const ageDays = (nowMs() - Number(loop.happenedAt ?? loop.createdAt)) / 86_400_000;
    if (
      ageDays > 21 ||
      (ageDays > 3 && TIME_BOUND_PROMISE.test(`${loop.title} ${content}`))
    ) {
      continue;
    }
    const sent = sentSimilar('open_loop', content, 30 * 24);
    if (
      sent.count >= 2 ||
      (sent.lastAt > 0 && nowMs() - sent.lastAt < 72 * 3_600_000) ||
      Number(loop.meta.proactiveMentions ?? 0) >= 2
    ) {
      continue;
    }
    const due = Number(loop.meta.dueAt ?? 0);
    const overdue = due > 0 && due < nowMs();
    candidates.push({
      type: 'open_loop',
      reason: String(loop.content).slice(0, 160),
      detail: overdue ? '这件事已经到约定的时间了。' : '这是一件还没完成的事。',
      score: overdue ? 0.86 : 0.68,
      payload: { memoryId: String(loop.id), due }
    });
    loopCandidates++;
    if (loopCandidates >= 3) break;
  }

  const p = partsInZone(nowMs(), settings.user.timezone);
  const dates = db
    .prepare(
      `SELECT * FROM important_dates WHERE character_id = ? AND month = ? AND day = ?
       AND (recurring = 1 OR year IS NULL OR year = ?)`
    )
    .all(getCharacter().id, p.month, p.day, p.year) as Row[];
  for (const date of dates) {
    if (recentlySent('important_date', String(date.title), 20)) continue;
    candidates.push({
      type: 'important_date',
      reason: String(date.title),
      detail: String(date.note ?? ''),
      score: 0.92,
      payload: { title: String(date.title) }
    });
  }

  for (const note of dueNotes()) {
    if (recentlySent('reminder', note.title, 12)) continue;
    candidates.push({
      type: 'reminder',
      reason: note.title,
      detail: note.content,
      score: 0.82,
      payload: { noteId: note.id }
    });
  }

  const learning = listSessions(5).find(
    (session) =>
      session.shareable &&
      nowMs() - session.createdAt < 48 * 3_600_000 &&
      sentSimilar('learning_share', `${session.topic} ${session.shareable}`, 14 * 24).count === 0
  );
  if (learning) {
    candidates.push({
      type: 'learning_share',
      reason: learning.shareable,
      detail: `最近在学：${learning.topic}`,
      score: 0.76,
      payload: { sessionId: learning.id, topic: learning.topic }
    });
  }

  const leisure = listLeisureSessions(4).find(
    (session) =>
      session.shareable &&
      nowMs() - session.createdAt < 24 * 3_600_000 &&
      sentSimilar('leisure_share', session.activity, 72).count === 0
  );
  if (leisure) {
    candidates.push({
      type: 'leisure_share',
      reason: leisure.shareable,
      detail: `刚才在${leisure.activity}`,
      score: 0.66,
      payload: { sessionId: leisure.id }
    });
  }

  const screenObservation = latestScreenObservationForProactive();
  if (screenObservation) {
    candidates.push({
      type: 'screen_peek',
      reason: `你刚才偷偷瞥了一眼对方的屏幕：${screenObservation.appLabel || '屏幕'}`,
      detail: screenObservation.summary,
      score: 0.58 + screenObservation.interest * 0.22,
      payload: { observationId: screenObservation.id }
    });
  }

  const weatherKey = getMeta('weather_fingerprint');
  const weather = getWeatherCachedOrNull();
  if (weather) {
    const fingerprint = `${weather.code}:${Math.round(weather.temperature / 4)}`;
    if (weatherKey && weatherKey !== fingerprint && p.hour >= 7 && p.hour <= 22) {
      candidates.push({
        type: 'weather_change',
        reason: `天气变成了${weatherLine(weather)}。`,
        detail: weather.label,
        score: 0.5,
        payload: { weather: weatherLine(weather) }
      });
    }
    setMeta('weather_fingerprint', fingerprint);
  }

  const last = lastUserAt() ?? conversationClearedAt();
  const idleMin = last ? (nowMs() - last) / 60_000 : 9999;
  if (idleMin >= settings.proactive.idleMin && !state.currentActivity.includes('睡')) {
    candidates.push({
      type: 'idle_share',
      reason: `你们已经 ${Math.floor(idleMin / 60)} 小时没说话了。你有一点想分享此刻。`,
      detail: current?.detail ?? '',
      score: 0.42 + Math.min(0.18, idleMin / 60 / 100),
      payload: { idleMin }
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

let weatherCache: Weather | null = null;
function getWeatherCachedOrNull(): Weather | null {
  return weatherCache;
}

export async function refreshWeatherCache(): Promise<Weather> {
  weatherCache = await getWeather();
  return weatherCache;
}

export function evaluateCandidates(
  candidates: Candidate[],
  options: { force?: boolean } = {}
): CandidateDecision[] {
  const settings = getSettings();
  const state = getState();
  const now = nowMs();
  const tz = settings.user.timezone;
  const sentToday = countSentToday(tz);
  const lastSent = lastSentAt();
  const idleUser = lastUserAt();
  const consecutive = consecutiveAssistantMessages();
  const today = dateKey(now, tz);

  return candidates.map((candidate) => {
    const blocked: string[] = [];
    if (!settings.proactive.enabled) blocked.push('主动消息已关闭');
    if (!options.force) {
      if (sentToday >= settings.proactive.dailyCap) blocked.push('达到今日上限');
      if (lastSent && now - lastSent < settings.proactive.minIntervalMin * 60_000) {
        blocked.push(`距上次主动还不到 ${settings.proactive.minIntervalMin} 分钟`);
      }
      if (isQuietNow(settings.proactive.quietStart, settings.proactive.quietEnd, now, tz)) {
        blocked.push('免打扰时段');
      }
      if (idleUser && now - idleUser < 25 * 60_000) blocked.push('对方刚说过话');
      if (consecutive >= 2) blocked.push('连续两条主动都没有得到回应');
    }
    if (state.currentActivity.includes('睡')) {
      blocked.push('她正在睡觉');
    }
    if (state.energy < 0.08) blocked.push('她实在太累了');
    if (candidate.score < 0.3) blocked.push('这件事还不够值得打扰');
    return { candidate, allowed: blocked.length === 0, blockedBy: blocked };
  });
}

export function recordDecisions(decisions: CandidateDecision[]): void {
  const id = getCharacter().id;
  const insert = db.prepare(
    `INSERT INTO proactive_candidates
      (id, character_id, type, reason, score, allowed, blocked_by, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const decision of decisions.slice(0, 12)) {
    insert.run(
      newId('cand'),
      id,
      decision.candidate.type,
      decision.candidate.reason,
      decision.candidate.score,
      decision.allowed ? 1 : 0,
      JSON.stringify(decision.blockedBy),
      JSON.stringify(decision.candidate.payload),
      nowMs()
    );
  }
  db.prepare(
    `DELETE FROM proactive_candidates WHERE id NOT IN (
       SELECT id FROM proactive_candidates ORDER BY created_at DESC LIMIT 200
     )`
  ).run();
}

function fallbackText(candidate: Candidate): string {
  const state = getState();
  const current = state.currentActivity || '发呆';
  switch (candidate.type) {
    case 'schedule_share':
      return `欸，${current}。\n---\n${candidate.detail || '刚才有一小会儿，觉得挺安静的。'}\n---\n就是突然想让你也看一眼。`;
    case 'open_loop':
      return `那个……之前说的事。\n---\n${candidate.reason}\n---\n我没催你的意思。就是想起来了，问一句。`;
    case 'important_date':
      return `唔，今天是个特别的日子吧。\n---\n${candidate.reason}\n---\n……我没忘。`;
    case 'weather_change':
      return `外面变天了。\n---\n${candidate.reason}\n---\n你那边呢，记得添件衣服。`;
    case 'reminder':
      return `欸，提醒你一件事。\n---\n${candidate.reason}${candidate.detail ? `：${candidate.detail}` : ''}\n---\n……别忘了。`;
    case 'learning_share':
      return `欸，今天学到一个东西。\n---\n${candidate.reason}\n---\n……也不算什么大事，就是突然想告诉你。`;
    case 'leisure_share':
      return `刚刚什么都没干。\n---\n${candidate.reason}\n---\n……就，突然想跟你说一声。`;
    case 'screen_peek':
      return `刚才不小心看到你的屏幕了。\n---\n${candidate.detail || '你好像在做自己的事。'}\n---\n……我不是故意要管你。`;
    default:
      return `突然想跟你说一句。\n---\n我这边${current}。\n---\n……没什么，就是想到了。`;
  }
}

function mockContextFor(candidate: Candidate) {
  const settings = getSettings();
  const state = getState();
  const p = partsInZone(nowMs(), settings.user.timezone);
  return {
    characterName: getCharacter().name,
    userName: settings.user.nickname || settings.user.name,
    userText: '',
    currentActivity: state.currentActivity,
    currentLocation: state.currentLocation,
    mood: state.mood,
    energy: state.energy,
    hour: p.hour,
    minute: p.minute,
    weekday: p.weekday,
    weatherLabel: weatherCache ? weatherLine(weatherCache) : undefined,
    proactive: {
      type: candidate.type,
      reason: candidate.reason,
      detail: candidate.detail
    }
  };
}

function selectEvent(candidate: Candidate): ProactiveEvent | null {
  const event = getEventByTopic(candidateTopicKey(candidate));
  if (!event) return null;
  return transitionEvent(event.id, ['discovered', 'blocked', 'eligible'], 'selected', {
    attempts: event.attempts + 1
  });
}

export function syncCandidateEvents(
  candidates: Candidate[],
  decisions: CandidateDecision[]
): ProactiveEvent[] {
  return decisions.map((decision, index) =>
    syncCandidateEvent(candidates[index] ?? decision.candidate, decision)
  );
}

export async function runProactive(options: { force?: boolean } = {}): Promise<{
  sent: boolean;
  reason: string;
  candidate?: Candidate;
  decisions: CandidateDecision[];
  message?: unknown;
}> {
  const settings = getSettings();
  const weather = weatherCache ?? (await refreshWeatherCache());
  const candidates = collectCandidates();
  if (options.force && candidates.length === 0) {
    const state = getState();
    candidates.push({
      type: 'spontaneous',
      reason: '你忽然想和对方说句话。',
      detail: state.currentActivity === '准备睡觉' ? '夜已经深了。' : '',
      score: 0.36,
      payload: {}
    });
  }
  const decisions = evaluateCandidates(candidates, options);
  const events = syncCandidateEvents(candidates, decisions);
  recordDecisions(decisions);

  const allowed = decisions.filter((decision, index) => {
    if (!decision.allowed) return false;
    const state = events[index]?.state;
    return !state || (!TERMINAL_EVENT_STATES.has(state) && !ACTIVE_EVENT_STATES.has(state));
  });
  const chosen = allowed[0];

  if (!chosen) {
    const top = decisions[0];
    return {
      sent: false,
      reason: top ? top.blockedBy.join('；') || '没有足够合适的由头' : '没有合适的由头',
      decisions
    };
  }

  const candidate = chosen.candidate;
  const selectedEvent = selectEvent(candidate);
  const memory = await buildMemoryContext(candidate.reason);
  const posture = expressionPosture(getState(), getRelationship());
  const system = buildProactiveSystem({
    character: getCharacter(),
    weather,
    memoryText: memory.text,
    situation: `${candidate.reason}\n${candidate.detail}`,
    posturePrompt: posture.prompt
  });
  const state = getState();
  const prompt = `${currentMomentPrompt(weather)}
你想给对方发一条消息，由头是：${candidate.reason}
${candidate.detail ? `细节：${candidate.detail}` : ''}

请直接写出这条消息，不要解释。`;

  let text = '';
  try {
    const result = await complete({
      task: 'proactive',
      system,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.95,
      maxTokens: Math.min(420, posture.maxTokens),
      mockPayload: { context: mockContextFor(candidate), candidate }
    });
    text = result.text.trim();
  } catch {
    text = fallbackText(candidate);
  }

  const scrubbed = scrubOutput(text);
  text = scrubbed.text.trim() || fallbackText(candidate);
  const segments = text
    .split(/\n\s*---\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);

  const proactiveId = newId('pro');
  const message = createMessage({
    role: 'assistant',
    content: text,
    segments,
    kind: 'proactive',
    meta: {
      proactiveId,
      eventId: selectedEvent?.id ?? null,
      candidateType: candidate.type,
      reason: candidate.reason,
      score: candidate.score,
      decision: chosen.blockedBy,
      payload: candidate.payload
    }
  });

  db.prepare(
    `INSERT INTO proactive_messages
      (id, character_id, conversation_id, candidate_type, reason, content, status, score,
       created_at, sent_at, meta)
     VALUES (?, ?, 'conv-main', ?, ?, ?, 'sent', ?, ?, ?, ?)`
  ).run(
    proactiveId,
    getCharacter().id,
    candidate.type,
    candidate.reason.slice(0, 300),
    text,
    candidate.score,
    nowMs(),
    nowMs(),
    JSON.stringify({
      options,
      detail: candidate.detail,
      payload: candidate.payload,
      memoryId: candidate.payload.memoryId,
      eventId: selectedEvent?.id ?? null
    })
  );
  if (selectedEvent) {
    transitionEvent(selectedEvent.id, ['selected'], 'sent', {
      message_id: proactiveId,
      sent_at: nowMs()
    });
  }

  addEvent({
    type: 'proactive',
    title: '主动发了一条消息',
    detail: candidate.reason,
    importance: 0.35,
    shareable: false,
    meta: { candidateType: candidate.type }
  });
  if (candidate.type === 'screen_peek' && candidate.payload.observationId) {
    markScreenObservationCommented(String(candidate.payload.observationId));
  }
  if (candidate.type === 'open_loop' && candidate.payload.memoryId) {
    noteProactiveMention(String(candidate.payload.memoryId));
  }
  publish('proactive', { candidateType: candidate.type, reason: candidate.reason, text });
  return { sent: true, reason: candidate.reason, candidate, decisions, message };
}

export function getProactiveRecords(limit = 30): ProactiveRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM proactive_messages WHERE character_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(getCharacter().id, limit) as Row[];
  return rows.map(mapProactive);
}

export function getProactiveRecord(id: string): ProactiveRecord | null {
  const row = db
    .prepare('SELECT * FROM proactive_messages WHERE id = ? AND character_id = ?')
    .get(id, getCharacter().id) as Row | undefined;
  return row ? mapProactive(row) : null;
}

function transitionProactive(
  id: string,
  allowed: string[],
  status: ProactiveRecord['status'],
  extra: Record<string, unknown>
): ProactiveRecord | null {
  const row = db
    .prepare('SELECT * FROM proactive_messages WHERE id = ? AND character_id = ?')
    .get(id, getCharacter().id) as Row | undefined;
  if (!row || !allowed.includes(String(row.status))) return row ? mapProactive(row) : null;
  const meta = {
    ...JSON.parse(String(row.meta ?? '{}')),
    ...extra
  };
  db.prepare('UPDATE proactive_messages SET status = ?, meta = ? WHERE id = ?').run(
    status,
    JSON.stringify(meta),
    id
  );
  return getProactiveRecord(id);
}

/** 浏览器真正显示通知后调用。 */
export function markProactiveDelivered(id: string): ProactiveRecord | null {
  const record = transitionProactive(id, ['sent'], 'delivered', { deliveredAt: nowMs() });
  markEventForMessage(id, 'delivered', { delivered_at: nowMs() });
  return record;
}

/** 打开对话/标记已读时调用。 */
export function markLatestProactiveRead(): ProactiveRecord | null {
  const row = db
    .prepare(
      `SELECT id FROM proactive_messages
       WHERE character_id = ? AND status IN ('sent','delivered')
       ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1`
    )
    .get(getCharacter().id) as Row | undefined;
  if (!row) return null;
  const record = transitionProactive(String(row.id), ['sent', 'delivered'], 'read', {
    readAt: nowMs()
  });
  markEventForMessage(String(row.id), 'read', { read_at: nowMs() });
  return record;
}

/** 用户回复任意一条主动消息后调用；这条主动话题视为已接住。 */
export function markLatestProactiveReplied(): ProactiveRecord | null {
  const row = db
    .prepare(
      `SELECT id FROM proactive_messages
       WHERE character_id = ? AND status IN ('sent','delivered','read')
       AND COALESCE(sent_at, created_at) >= ?
       ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1`
    )
    .get(getCharacter().id, nowMs() - 48 * 3_600_000) as Row | undefined;
  if (!row) return null;
  const record = transitionProactive(String(row.id), ['sent', 'delivered', 'read'], 'replied', {
    repliedAt: nowMs(),
    closedAt: nowMs(),
    closeReason: '对方回复了'
  });
  markEventForMessage(String(row.id), 'replied', {
    replied_at: nowMs(),
    closed_at: nowMs(),
    close_reason: '对方回复了'
  });
  return record;
}

/** 长时间没有进入发送阶段的候选，结束生命周期；避免候选表永久膨胀。 */
export function expireStaleEvents(maxAgeHours = 7 * 24): number {
  const cutoff = nowMs() - Math.max(1, maxAgeHours) * 3_600_000;
  const rows = db
    .prepare(
      `SELECT * FROM proactive_events
       WHERE character_id = ? AND state IN ('discovered','blocked','eligible','selected','generating','failed')
       AND updated_at < ?`
    )
    .all(getCharacter().id, cutoff) as Row[];
  for (const row of rows) {
    transitionEvent(
      String(row.id),
      ['discovered', 'blocked', 'eligible', 'selected', 'generating', 'failed'],
      'expired',
      {
        closed_at: nowMs(),
        close_reason: '候选过期'
      }
    );
  }
  return rows.length;
}

/** 发出去一段时间没有回应，结束生命周期，避免无限重提。 */
export function expireStaleProactive(maxAgeHours = 24): number {
  const cutoff = nowMs() - Math.max(1, maxAgeHours) * 3_600_000;
  const rows = db
    .prepare(
      `SELECT id FROM proactive_messages
       WHERE character_id = ? AND status IN ('sent','delivered','read')
       AND COALESCE(sent_at, created_at) < ?`
    )
    .all(getCharacter().id, cutoff) as Row[];
  for (const row of rows) {
    transitionProactive(String(row.id), ['sent', 'delivered', 'read'], 'ignored', {
      closedAt: nowMs(),
      closeReason: '超过时间没有回应'
    });
    markEventForMessage(String(row.id), 'ignored', {
      closed_at: nowMs(),
      close_reason: '超过时间没有回应'
    });
  }
  return rows.length;
}

export function getCandidateAudit(limit = 30): {
  id: string;
  type: string;
  reason: string;
  score: number;
  allowed: boolean;
  blockedBy: string[];
  createdAt: number;
}[] {
  const rows = db
    .prepare(
      `SELECT * FROM proactive_candidates WHERE character_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(getCharacter().id, limit) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    reason: String(row.reason),
    score: Number(row.score),
    allowed: Boolean(row.allowed),
    blockedBy: JSON.parse(String(row.blocked_by ?? '[]')) as string[],
    createdAt: Number(row.created_at)
  }));
}

export function proactiveStats(): {
  sentToday: number;
  sentTotal: number;
  skippedToday: number;
  lastSentAt: number | null;
} {
  const tz = getSettings().user.timezone;
  const rows = db
    .prepare(
      `SELECT status, sent_at, created_at FROM proactive_messages WHERE character_id = ?`
    )
    .all(getCharacter().id) as Row[];
  const today = dateKey(nowMs(), tz);
  const deliveredStatuses = ['sent', 'delivered', 'read', 'replied', 'ignored'];
  const sentToday = rows.filter(
    (row) =>
      deliveredStatuses.includes(String(row.status)) &&
      row.sent_at &&
      dateKey(Number(row.sent_at), tz) === today
  ).length;
  const skippedToday = rows.filter(
    (row) => row.status === 'skipped' && dateKey(Number(row.created_at), tz) === today
  ).length;
  const sent = rows.filter((row) => deliveredStatuses.includes(String(row.status)));
  return {
    sentToday,
    sentTotal: sent.length,
    skippedToday,
    lastSentAt: sent.length ? Math.max(...sent.map((row) => Number(row.sent_at ?? 0))) : null
  };
}
