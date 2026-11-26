import type { AbsencePeriod, LifeEvent } from '../shared/types.js';
import { db, newId } from './db.js';
import { getCharacter } from './character.js';
import { getSettings } from './settings.js';
import { formatClock, nowMs } from './time.js';

type Row = Record<string, any>;

function mapAbsence(row: Row): AbsencePeriod {
  let eventCount = 0;
  try {
    const events = JSON.parse(String(row.events ?? '[]'));
    eventCount = Array.isArray(events) ? events.length : 0;
  } catch {
    eventCount = 0;
  }
  return {
    id: String(row.id),
    startAt: Number(row.start_at),
    endAt: Number(row.end_at),
    summary: String(row.summary),
    eventCount,
    createdAt: Number(row.created_at)
  };
}

export function getAbsences(limit = 5): AbsencePeriod[] {
  const rows = db
    .prepare(
      'SELECT * FROM absence_periods WHERE character_id = ? ORDER BY end_at DESC LIMIT ?'
    )
    .all(getCharacter().id, Math.min(20, Math.max(1, limit))) as Row[];
  return rows.map(mapAbsence);
}

export function getLatestAbsence(): AbsencePeriod | null {
  return getAbsences(1)[0] ?? null;
}

export function createAbsence(
  startAt: number,
  endAt: number,
  summary: string,
  events: LifeEvent[]
): AbsencePeriod {
  const id = newId('absence');
  const payload = events.slice(0, 40).map((event) => ({
    id: event.id,
    at: event.at,
    type: event.type,
    title: event.title,
    detail: event.detail,
    shareable: event.shareable
  }));
  db.prepare(
    `INSERT INTO absence_periods (id, character_id, start_at, end_at, summary, events, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    getCharacter().id,
    startAt,
    endAt,
    summary.slice(0, 1200),
    JSON.stringify(payload),
    nowMs()
  );
  return {
    id,
    startAt,
    endAt,
    summary,
    eventCount: payload.length,
    createdAt: nowMs()
  };
}

function durationLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 30) return `${hours}小时`;
  const days = Math.round(hours / 24);
  return `${days}天`;
}

export function buildAbsenceSummary(
  startAt: number,
  endAt: number,
  events: LifeEvent[]
): string {
  const settings = getSettings();
  const tz = settings.user.timezone;
  const duration = durationLabel(endAt - startAt);
  const cleaned = events
    .filter((event) => event.title && !event.title.startsWith('新的一天'))
    .filter((event, index, list) => list.findIndex((item) => item.title === event.title) === index);
  const initial = cleaned.find((event) => event.title.startsWith('你离开时'));
  const rest = cleaned
    .filter((event) => event !== initial)
    .slice(0, initial ? 5 : 6);
  const meaningful = initial ? [initial, ...rest] : rest;
  if (!meaningful.length) {
    return `你不在的这${duration}里，我照常吃饭、工作、睡觉。没什么特别的，只是时间自己往前走了一段。`;
  }
  const initialText = initial ? `${initial.title}。` : '';
  const items = rest
    .map((event) => `${formatClock(event.at, tz)} ${event.title.replace(/^开始/, '')}`)
    .join('、');
  const detail = meaningful.find((event) => event.detail && event.shareable)?.detail;
  const body = items ? `${initial ? '后来，' : ''}${items}。` : '';
  return `你不在的这${duration}里，${initialText}${body}${detail ? `其中有一会儿，${detail.replace(/。$/, '')}。` : ''}`;
}
