import type {
  DiaryEntry,
  LifeEvent,
  Memory,
  Message,
  WeeklyReview,
  WeeklyReviewView
} from '../shared/types.js';
import { getCharacter } from './character.js';
import { db, mapEvent, mapMemory, newId } from './db.js';
import { publish } from './events.js';
import { getGeneratedImages } from './imagegen.js';
import { getDiary } from './life.js';
import { complete, parseJsonLoose } from './llm.js';
import { getMessages } from './memory.js';
import { getRelationship } from './relationship.js';
import { SAFETY_PROMPT } from './safety.js';
import { getSettings, llmConfigured } from './settings.js';
import { addDays, dateKey, nowMs, partsInZone, zonedDateTimeToMs } from './time.js';

type Row = Record<string, any>;

function startOfWeek(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  const weekday = at.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addDays(date, delta);
}

function weekRange(date: string): { start: string; end: string } {
  const start = startOfWeek(date);
  return { start, end: addDays(start, 6) };
}

function mapReview(row: Row): WeeklyReview {
  return {
    id: String(row.id),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    title: String(row.title),
    content: String(row.content),
    highlights: JSON.parse(String(row.highlights ?? '[]')) as string[],
    photoUrl: row.photo_url ? String(row.photo_url) : null,
    createdAt: Number(row.created_at)
  };
}

export function getWeeklyReview(weekStart: string): WeeklyReview | null {
  const row = db
    .prepare('SELECT * FROM weekly_reviews WHERE character_id = ? AND week_start = ?')
    .get(getCharacter().id, weekStart) as Row | undefined;
  return row ? mapReview(row) : null;
}

export function listWeeklyReviews(limit = 16): WeeklyReview[] {
  const rows = db
    .prepare(
      'SELECT * FROM weekly_reviews WHERE character_id = ? ORDER BY week_start DESC LIMIT ?'
    )
    .all(getCharacter().id, Math.max(1, Math.min(limit, 52))) as Row[];
  return rows.map(mapReview);
}

function fallbackReview(input: {
  weekStart: string;
  weekEnd: string;
  events: LifeEvent[];
  diaries: DiaryEntry[];
  completed: Memory[];
  messages: Message[];
  highlights: string[];
  photoUrl: string | null;
}): WeeklyReview {
  const eventLines = input.events
    .slice(-5)
    .map((event) => event.title)
    .filter(Boolean);
  const completedLines = input.completed.map((item) => item.title || item.content.slice(0, 30));
  const content = [
    `这一周是 ${input.weekStart} 到 ${input.weekEnd}。`,
    eventLines.length ? `她记得比较清楚的是：${eventLines.join('、')}。` : '这一周过得很安静，很多时间都花在平常的小事上。',
    completedLines.length ? `你们一起了结了：${completedLines.join('、')}。` : '',
    input.messages.length
      ? `聊天不算多，也不算少。她大概留下了 ${input.messages.filter((item) => item.role === 'assistant').length} 条回复。`
      : '',
    '下周也不用急着规划什么，先把眼前这一天过好。'
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    id: newId('week'),
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    title: '她的一周',
    content,
    highlights: input.highlights,
    photoUrl: input.photoUrl,
    createdAt: nowMs()
  };
}

async function collectWeek(weekStart: string): Promise<{
  weekEnd: string;
  events: LifeEvent[];
  diaries: DiaryEntry[];
  completed: Memory[];
  messages: Message[];
  photoUrl: string | null;
}> {
  const character = getCharacter();
  const weekEnd = addDays(weekStart, 6);
  const tz = getSettings().user.timezone;
  const from = zonedDateTimeToMs(weekStart, 0, tz);
  const to = zonedDateTimeToMs(addDays(weekEnd, 1), 0, tz);
  const eventRows = db
    .prepare(
      `SELECT * FROM life_events WHERE character_id = ? AND at >= ? AND at < ?
       ORDER BY at ASC`
    )
    .all(character.id, from, to) as Row[];
  const events = eventRows.map(mapEvent);

  const diaries: DiaryEntry[] = [];
  for (let index = 0; index < 7; index++) {
    const diary = getDiary(addDays(weekStart, index));
    if (diary) diaries.push(diary);
  }

  const completedRows = db
    .prepare(
      `SELECT * FROM memories WHERE character_id = ? AND kind = 'promise' AND status = 'done'
       ORDER BY updated_at DESC LIMIT 100`
    )
    .all(character.id) as Row[];
  const completed = completedRows
    .map(mapMemory)
    .filter((memory) => {
      const at = Number(memory.meta.completedAt ?? 0);
      return at >= from && at < to;
    });

  const messages = getMessages('conv-main', 200).filter(
    (message) => message.createdAt >= from && message.createdAt < to
  );

  const photos = getGeneratedImages(character.id, 60).filter(
    (image) => image.createdAt >= from && image.createdAt < to
  );
  return {
    weekEnd,
    events,
    diaries,
    completed,
    messages,
    photoUrl: photos[0]?.url ?? null
  };
}

export async function generateWeeklyReview(options: {
  weekStart?: string;
  force?: boolean;
} = {}): Promise<WeeklyReview> {
  const settings = getSettings();
  const tz = settings.user.timezone;
  const target = options.weekStart || startOfWeek(dateKey(nowMs(), tz));
  const range = weekRange(target);
  const existing = getWeeklyReview(range.start);
  if (existing) return existing;

  const data = await collectWeek(range.start);
  const character = getCharacter();
  const relationship = getRelationship();
  const highlights = data.events
    .filter((event) => event.importance >= 0.4)
    .slice(-4)
    .map((event) => event.title)
    .filter(Boolean);

  let review: WeeklyReview;
  if (llmConfigured()) {
    try {
      const eventText = data.events
        .slice(-18)
        .map((event) => `- ${event.title}${event.detail ? `：${event.detail.slice(0, 100)}` : ''}`)
        .join('\n');
      const diaryText = data.diaries
        .map((diary) => `- ${diary.date}：${diary.content.slice(0, 180)}`)
        .join('\n');
      const completedText = data.completed
        .map((item) => `- ${item.title || item.content.slice(0, 40)}`)
        .join('\n');
      const result = await complete({
        task: 'weekly-review',
        system: `你在替「${character.name}」写一周回顾。用第一人称，像她自己写给熟悉的人看，不是报告。只输出 JSON，不要解释。${SAFETY_PROMPT}`,
        messages: [
          {
            role: 'user',
            content: `这一周：${range.start} 到 ${range.end}
你和对方的关系：${relationship.stage}，好感 ${relationship.affinity.toFixed(0)}，信任 ${relationship.trust.toFixed(0)}。
这周的生活事件：
${eventText || '（没有特别记录）'}
这周的日记：
${diaryText || '（没有写日记）'}
这周完成的约定：
${completedText || '（没有完成的约定）'}
聊天条数：${data.messages.length}

请写：
- title：不超过 20 字的标题；
- content：300-600 字的第一人称周记，写具体的小事、心情和关系变化，不要写“总结/报告/本周计划”，不要编造素材里没有的大事；
- highlights：2-4 条短句，每条 20 字内，写这周值得留下的一件小事。
只输出 JSON：{"title":"...","content":"...","highlights":["..."]}`
          }
        ],
        json: true,
        temperature: 0.7,
        maxTokens: 1200
      });
      const parsed = parseJsonLoose<{
        title?: string;
        content?: string;
        highlights?: string[];
      }>(result.text);
      const content = String(parsed.content ?? '').trim();
      if (content.length >= 40) {
        review = {
          id: newId('week'),
          weekStart: range.start,
          weekEnd: range.end,
          title: String(parsed.title ?? '她的一周').slice(0, 40) || '她的一周',
          content: content.slice(0, 1600),
          highlights: (Array.isArray(parsed.highlights) ? parsed.highlights : highlights)
            .map((item) => String(item).slice(0, 40))
            .filter(Boolean)
            .slice(0, 4),
          photoUrl: data.photoUrl,
          createdAt: nowMs()
        };
      } else {
        review = fallbackReview({ ...data, weekStart: range.start, highlights });
      }
    } catch {
      review = fallbackReview({ ...data, weekStart: range.start, highlights });
    }
  } else {
    review = fallbackReview({ ...data, weekStart: range.start, highlights });
  }

  db.prepare(
    `INSERT OR IGNORE INTO weekly_reviews
      (id, character_id, week_start, week_end, title, content, highlights, photo_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    review.id,
    character.id,
    review.weekStart,
    review.weekEnd,
    review.title,
    review.content,
    JSON.stringify(review.highlights),
    review.photoUrl,
    review.createdAt
  );
  const saved = getWeeklyReview(review.weekStart) ?? review;
  publish('weekly_review', saved);
  return saved;
}

export function buildWeeklyReviewView(): WeeklyReviewView {
  const settings = getSettings();
  const start = startOfWeek(dateKey(nowMs(), settings.user.timezone));
  const range = weekRange(start);
  return {
    reviews: listWeeklyReviews(16),
    currentWeek: range,
    canGenerate: !getWeeklyReview(range.start)
  };
}

export async function weeklyReviewTick(): Promise<void> {
  const settings = getSettings();
  if (!settings.weeklyReview.enabled) return;
  const now = nowMs();
  const tz = settings.user.timezone;
  const p = partsInZone(now, tz);
  const today = dateKey(now, tz);
  const current = weekRange(today);
  const [hour, minute] = settings.weeklyReview.time.split(':').map(Number);
  const due = p.weekday === settings.weeklyReview.weekday && p.minutes >= hour * 60 + minute;

  // Sunday evening: write the week that is just ending.
  if (due && !getWeeklyReview(current.start)) {
    await generateWeeklyReview({ weekStart: current.start });
    return;
  }

  // If the app was off on the configured night, catch up the previous week
  // the next time the app is open (not only on Monday morning).
  if (p.weekday !== settings.weeklyReview.weekday) {
    const previous = weekRange(addDays(today, -7));
    if (!getWeeklyReview(previous.start)) {
      await generateWeeklyReview({ weekStart: previous.start });
    }
  }
}

export { startOfWeek, weekRange };
