import type {
  LeisureCandidate,
  LeisureSession,
  LeisureView,
  Weather
} from '../shared/types.js';
import { db, newId } from './db.js';
import { getCharacter } from './character.js';
import { complete, parseJsonLoose } from './llm.js';
import { SAFETY_PROMPT, scrubOutput } from './safety.js';
import { getSettings } from './settings.js';
import {
  addEvent,
  ensureSchedule,
  findBlock,
  getBlocks,
  getEvents,
  getState,
  lifePromptContext,
  saveState,
  scheduleForPrompt
} from './life.js';
import { createMemory, getMessages } from './memory.js';
import { searchBilibiliVideos } from './bilibili.js';
import { createComputerRequest, getComputerSettings } from './computer.js';
import { getWeather } from './weather.js';
import { dateKey, minutesOfDay, nowMs, partsInZone } from './time.js';

type Row = Record<string, any>;

const LEISURE_BLOCKS = new Set(['leisure', 'rest']);

const EFFECTS: Record<
  string,
  { stress: number; mood: number; energy: number; hunger: number; sleep: number }
> = {
  overtime: { stress: 0.09, mood: -0.025, energy: -0.07, hunger: 0.02, sleep: 0 },
  video: { stress: -0.06, mood: 0.08, energy: -0.02, hunger: 0, sleep: 0 },
  music: { stress: -0.08, mood: 0.07, energy: 0, hunger: 0, sleep: 0 },
  game: { stress: -0.07, mood: 0.09, energy: -0.03, hunger: 0, sleep: 0 },
  walk: { stress: -0.08, mood: 0.05, energy: 0.04, hunger: 0.01, sleep: 0 },
  snack: { stress: -0.03, mood: 0.07, energy: 0.02, hunger: -0.28, sleep: 0 },
  nap: { stress: -0.06, mood: 0.03, energy: 0.12, hunger: 0, sleep: -0.04 },
  read: { stress: -0.06, mood: 0.04, energy: -0.01, hunger: 0, sleep: 0 },
  idle: { stress: -0.04, mood: 0.02, energy: 0.01, hunger: 0, sleep: 0 }
};

function mapSession(row: Row): LeisureSession {
  return {
    id: String(row.id),
    kind: row.kind,
    activity: String(row.activity),
    reason: String(row.reason ?? ''),
    reaction: String(row.reaction ?? ''),
    shareable: String(row.shareable ?? ''),
    sourceUrl: String(row.source_url ?? ''),
    sourceTitle: String(row.source_title ?? ''),
    enjoyment: Number(row.enjoyment ?? 0),
    createdAt: Number(row.created_at)
  };
}

function mapCandidate(row: Row): LeisureCandidate {
  return {
    id: String(row.id),
    kind: String(row.kind),
    activity: String(row.activity),
    reason: String(row.reason ?? ''),
    appeal: Number(row.appeal ?? 0.5),
    chosen: Boolean(row.chosen),
    createdAt: Number(row.created_at)
  };
}

export function listLeisureSessions(limit = 30): LeisureSession[] {
  return (
    db
      .prepare(
        'SELECT * FROM leisure_sessions WHERE character_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(getCharacter().id, Math.min(100, Math.max(1, limit))) as Row[]
  ).map(mapSession);
}

export function listLeisureCandidates(limit = 30): LeisureCandidate[] {
  return (
    db
      .prepare(
        'SELECT * FROM leisure_candidates WHERE character_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(getCharacter().id, Math.min(100, Math.max(1, limit))) as Row[]
  ).map(mapCandidate);
}

function sessionsToday(): number {
  const tz = getSettings().user.timezone;
  const today = dateKey(nowMs(), tz);
  return (
    db
      .prepare('SELECT created_at FROM leisure_sessions WHERE character_id = ? AND created_at >= ?')
      .all(getCharacter().id, nowMs() - 2 * 86_400_000) as Row[]
  ).filter((row) => dateKey(Number(row.created_at), tz) === today).length;
}

function lastSessionAt(): number | null {
  const row = db
    .prepare('SELECT MAX(created_at) AS at FROM leisure_sessions WHERE character_id = ?')
    .get(getCharacter().id) as Row | undefined;
  return row?.at == null ? null : Number(row.at);
}

export function boredomScore(): number {
  const settings = getSettings();
  const state = getState();
  const tz = settings.user.timezone;
  const today = dateKey(nowMs(), tz);
  ensureSchedule(today);
  const block = findBlock(getBlocks(today), minutesOfDay(nowMs(), tz));
  let score = 0.16;
  if (block && LEISURE_BLOCKS.has(block.category)) score += 0.2;
  if (state.currentActivity.includes('发呆') || state.currentActivity.includes('休息')) {
    score += 0.12;
  }
  if (state.mood < 0.15) score += 0.14;
  if (state.stress > 0.55) score += 0.12;
  if (state.social < 0.38) score += 0.1;
  if (state.energy > 0.45) score += 0.08;
  const last = lastSessionAt();
  if (!last || nowMs() - last > 6 * 3_600_000) score += 0.18;
  return Math.max(0, Math.min(1, score));
}

export function canChooseLeisure(force = false): { allowed: boolean; reason: string } {
  const settings = getSettings();
  if (!settings.leisure.enabled) return { allowed: false, reason: '娱乐模块已关闭' };
  const state = getState();
  if (state.currentActivity.includes('睡')) return { allowed: false, reason: '她正在睡觉' };
  if (state.energy < 0.15) return { allowed: false, reason: '太累了，先休息' };
  const tz = settings.user.timezone;
  const today = dateKey(nowMs(), tz);
  ensureSchedule(today);
  const block = findBlock(getBlocks(today), minutesOfDay(nowMs(), tz));
  if (!force) {
    if (!block || !LEISURE_BLOCKS.has(block.category)) {
      return { allowed: false, reason: '现在不在她自己的空闲时间' };
    }
    if (sessionsToday() >= settings.leisure.dailyChoices) {
      return { allowed: false, reason: '今天的空闲已经安排过了' };
    }
    const last = lastSessionAt();
    if (last && nowMs() - last < settings.leisure.minGapMin * 60_000) {
      return { allowed: false, reason: '刚放松过，还没那么无聊' };
    }
    const hour = partsInZone(nowMs(), tz).hour;
    if (hour < 8 || hour >= 23) return { allowed: false, reason: '这个时间该休息了' };
    if (boredomScore() < 0.35) return { allowed: false, reason: '她现在并不无聊' };
  }
  return { allowed: true, reason: '她有一点自己的空闲' };
}

interface LeisureOption {
  kind: string;
  activity: string;
  reason: string;
  appeal: number;
  searchQuery: string;
}

function normalizeOption(raw: any): LeisureOption | null {
  const kind = String(raw?.kind ?? '');
  const allowed = [
    'overtime',
    'video',
    'music',
    'game',
    'walk',
    'snack',
    'nap',
    'read',
    'idle'
  ];
  if (!allowed.includes(kind)) return null;
  const activity = scrubOutput(String(raw?.activity ?? '').trim()).text.slice(0, 100);
  const reason = scrubOutput(String(raw?.reason ?? '').trim()).text.slice(0, 160);
  if (activity.length < 2) return null;
  return {
    kind,
    activity,
    reason,
    appeal: Math.min(1, Math.max(0, Number(raw?.appeal ?? 0.5) || 0)),
    searchQuery: scrubOutput(String(raw?.search_query ?? '').trim()).text.slice(0, 80)
  };
}

function optionsPrompt(): string {
  const settings = getSettings();
  const character = getCharacter();
  const state = getState();
  const tz = settings.user.timezone;
  const today = dateKey(nowMs(), tz);
  const recent = listLeisureSessions(3);
  const messages = getMessages('conv-main', 6)
    .filter((message) => message.kind === 'chat' && message.content.trim())
    .slice(-3);
  const online = settings.leisure.onlineEnabled;
  return `你是「${character.name}」。现在是你的空闲时间，没有人要求你做什么。

你是谁：${character.description}
你的性格：${character.personality}
${lifePromptContext(getWeatherSync())}

今天的日程：
${scheduleForPrompt(today)}

最近的生活：
${getEvents(6).map((event) => `- ${event.title}${event.detail ? `：${event.detail}` : ''}`).join('\n')}

你最近怎么放松的：
${recent.length ? recent.map((item) => `- ${item.activity}：${item.reaction}`).join('\n') : '（最近没怎么放松）'}

最近对话：
${messages.length ? messages.map((message) => `- ${message.role === 'user' ? '对方' : '我'}：${message.content.replace(/\s+/g, ' ').slice(0, 80)}`).join('\n') : '（没什么）'}

你现在有一点无聊。请提出 3~4 个你此刻真的可能做的选项，让它像一个人自己的选择，而不是待办清单。
可以继续加班工作，可以刷视频、听歌、打游戏、散步、吃点东西、小睡、看书，也可以什么都不做。
不要总是选“有用”或“应该做”的；也要考虑你此刻的精力、压力和心情。选你真正想做的那个，而不是最合理的那个。
${online ? '如果选刷视频，可以给出一个具体的 search_query，之后会去 B 站搜。' : '这次没有联网，不要选刷视频。'}
${settings.leisure.allowOvertime ? '' : '这次不要选加班。'}

只输出 JSON：
{"options":[{"kind":"overtime|video|music|game|walk|snack|nap|read|idle","activity":"具体做什么，30字内","reason":"为什么此刻想这样，40字内","appeal":0.0,"search_query":"仅视频时填"}],"chosen":0}`;
}

let weatherCache: Weather | null = null;
function getWeatherSync(): Weather {
  return (
    weatherCache ?? {
      city: getSettings().life.city,
      temperature: 20,
      apparent: 20,
      code: 2,
      label: '多云',
      wind: 0,
      humidity: 60,
      isDay: true,
      updatedAt: nowMs(),
      source: 'fallback' as const
    }
  );
}

function reactionPrompt(
  option: LeisureOption,
  source?: { title: string; description: string; url: string }
): string {
  return `你刚刚在自己的空闲时间里选择了：${option.activity}
原因：${option.reason || '想换换脑子'}
${source ? `你刷到一个视频：\n标题：${source.title}\n简介/字幕：${source.description.slice(0, 1200)}\n链接：${source.url}` : '这件事没有联网内容，只是你自己的生活。'}

用第一人称写一两句真实的反应，像随手记下的一小段，不要总结、不要汇报、不要写“我学到了”。
可以觉得一般、后悔、无聊，也可以真的放松了一点。
只输出 JSON：
{"reaction":"一两句反应","enjoyment":-1.0,"shareable":"一句之后可以随口提起的话，没有就留空"}`;
}

export interface LeisureRunResult {
  started: boolean;
  reason: string;
  session?: LeisureSession;
  candidates?: LeisureCandidate[];
  view?: LeisureView;
}

let running = false;

export async function runLeisure(options: { force?: boolean } = {}): Promise<LeisureRunResult> {
  if (running) return { started: false, reason: '她已经在发呆了' };
  const settings = getSettings();
  const eligibility = canChooseLeisure(Boolean(options.force));
  if (!eligibility.allowed) {
    return { started: false, reason: eligibility.reason, view: buildLeisureView() };
  }
  running = true;
  try {
    weatherCache = await getWeather();
    const character = getCharacter();
    const result = await complete({
      task: 'leisure-options',
      system: `你在为「${character.name}」生成她自己的空闲选择。只输出 JSON。${SAFETY_PROMPT}`,
      messages: [{ role: 'user', content: optionsPrompt() }],
      json: true,
      temperature: 0.95,
      maxTokens: 1800,
      mockPayload: {
        onlineEnabled: settings.leisure.onlineEnabled,
        allowOvertime: settings.leisure.allowOvertime
      }
    });
    const parsed = parseJsonLoose<{ options?: unknown[]; chosen?: number }>(result.text);
    let candidates = (parsed.options ?? [])
      .map(normalizeOption)
      .filter((item): item is LeisureOption => Boolean(item))
      .filter(
        (item) =>
          (item.kind !== 'video' || settings.leisure.onlineEnabled) &&
          (item.kind !== 'overtime' || settings.leisure.allowOvertime)
      )
      .slice(0, 4);
    if (!candidates.length) {
      return { started: false, reason: '她这次没想好要做什么', view: buildLeisureView() };
    }
    let chosenIndex = Number(parsed.chosen ?? 0);
    if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= candidates.length) {
      chosenIndex = 0;
    }
    let chosen = candidates[chosenIndex];
    let source: { title: string; description: string; url: string } | undefined;
    if (chosen.kind === 'video') {
      const query = chosen.searchQuery || `${chosen.activity} 轻松`;
      const videos = await searchBilibiliVideos(query, 2).catch(() => []);
      if (videos.length) {
        source = {
          title: videos[0].title,
          description: videos[0].excerpt,
          url: videos[0].url
        };
      } else {
        const fallback = candidates.find((item, index) => index !== chosenIndex && item.kind !== 'video');
        if (fallback) {
          chosen = fallback;
          chosenIndex = candidates.indexOf(fallback);
        } else {
          chosen = { ...chosen, kind: 'idle', activity: '靠在椅背上发一会儿呆' };
        }
      }
    }

    const candidateRows: LeisureCandidate[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const id = newId('lcand');
      db.prepare(
        `INSERT INTO leisure_candidates
          (id, character_id, kind, activity, reason, appeal, chosen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        character.id,
        candidate.kind,
        candidate.activity,
        candidate.reason,
        candidate.appeal,
        index === chosenIndex ? 1 : 0,
        nowMs()
      );
      candidateRows.push({
        id,
        kind: candidate.kind,
        activity: candidate.activity,
        reason: candidate.reason,
        appeal: candidate.appeal,
        chosen: index === chosenIndex,
        createdAt: nowMs()
      });
    }

    const reactionResult = await complete({
      task: 'leisure-reaction',
      system: `你在以自己的身份记录一段放松。只输出 JSON。${SAFETY_PROMPT}`,
      messages: [{ role: 'user', content: reactionPrompt(chosen, source) }],
      json: true,
      temperature: 0.9,
      maxTokens: 1200,
      mockPayload: { activity: chosen.activity, kind: chosen.kind }
    });
    const reactionParsed = parseJsonLoose<{
      reaction?: string;
      enjoyment?: number;
      shareable?: string;
    }>(reactionResult.text);
    const reaction = scrubOutput(String(reactionParsed.reaction ?? '').trim()).text.slice(0, 500);
    const shareable = scrubOutput(String(reactionParsed.shareable ?? '').trim()).text.slice(0, 200);
    const enjoyment = Math.min(1, Math.max(-1, Number(reactionParsed.enjoyment ?? 0) || 0));
    const now = nowMs();
    const state = getState();
    const effect = EFFECTS[chosen.kind] ?? EFFECTS.idle;
    state.stress = Math.max(0, Math.min(1, state.stress + effect.stress - enjoyment * 0.03));
    state.mood = Math.max(-1, Math.min(1, state.mood + effect.mood + enjoyment * 0.04));
    state.energy = Math.max(0, Math.min(1, state.energy + effect.energy));
    state.hunger = Math.max(0, Math.min(1, state.hunger + effect.hunger));
    state.sleepDebt = Math.max(0, Math.min(1, state.sleepDebt + effect.sleep));
    state.updatedAt = now;
    saveState(state);

    const sessionId = newId('leisure');
    db.prepare(
      `INSERT INTO leisure_sessions
        (id, character_id, kind, activity, reason, reaction, shareable, source_url,
         source_title, enjoyment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      character.id,
      chosen.kind,
      chosen.activity,
      chosen.reason,
      reaction || '就这样待了一会儿。',
      shareable,
      source?.url ?? '',
      source?.title ?? '',
      enjoyment,
      now
    );

    addEvent({
      type: 'leisure',
      title: chosen.activity,
      detail: reaction || chosen.reason,
      importance: 0.42,
      shareable: Boolean(shareable),
      at: now,
      meta: { sessionId, kind: chosen.kind, sourceUrl: source?.url ?? '' }
    });

    if (shareable) {
      createMemory({
        kind: 'self',
        title: `放松：${chosen.activity}`,
        content: reaction || shareable,
        importance: 0.35,
        confidence: 0.65,
        valence: enjoyment * 0.35,
        source: 'leisure',
        happenedAt: now,
        tags: ['娱乐', chosen.kind],
        meta: { sessionId }
      });
    }

    if (source && getComputerSettings().enabled) {
      try {
        createComputerRequest(
          {
            kind: 'open_url',
            target: source.url,
            reason: `想看看这个视频：${source.title}`
          },
          { allowedUrls: [source.url] }
        );
      } catch {
        // Computer use may be off; entertainment still happened in text.
      }
    }

    const session = mapSession(
      db.prepare('SELECT * FROM leisure_sessions WHERE id = ?').get(sessionId) as Row
    );
    return {
      started: true,
      reason: session.reaction || session.activity,
      session,
      candidates: candidateRows,
      view: buildLeisureView()
    };
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : '她走神了',
      view: buildLeisureView()
    };
  } finally {
    running = false;
  }
}

export function buildLeisureView(): LeisureView {
  const sessions = listLeisureSessions(30);
  const candidates = listLeisureCandidates(30);
  const eligibility = canChooseLeisure(false);
  const averageEnjoyment = sessions.length
    ? sessions.reduce((sum, session) => sum + session.enjoyment, 0) / sessions.length
    : null;
  return {
    boredom: boredomScore(),
    canChoose: eligibility.allowed,
    reason: eligibility.reason,
    sessions,
    candidates,
    stats: {
      today: sessionsToday(),
      averageEnjoyment,
      overtime: sessions.filter((session) => session.kind === 'overtime').length
    }
  };
}

export function getLeisurePrompt(): string {
  const latest = listLeisureSessions(1)[0];
  if (!latest) return '';
  return `最近一次放松：${latest.activity}。${latest.reaction || ''}`;
}
