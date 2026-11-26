import type { ImportantDate, Note } from '../shared/types.js';
import { db, mapImportantDate, mapNote, newId } from './db.js';
import { getCharacter } from './character.js';
import { nowMs, partsInZone } from './time.js';
import { getSettings } from './settings.js';

type Row = Record<string, any>;

export function listImportantDates(): ImportantDate[] {
  const rows = db
    .prepare('SELECT * FROM important_dates WHERE character_id = ? ORDER BY month ASC, day ASC')
    .all(getCharacter().id) as Row[];
  return rows.map(mapImportantDate);
}

export function createImportantDate(input: {
  title: string;
  month: number;
  day: number;
  year?: number | null;
  recurring?: boolean;
  note?: string;
}): ImportantDate {
  const month = Math.min(12, Math.max(1, Math.round(input.month)));
  const day = Math.min(31, Math.max(1, Math.round(input.day)));
  const id = newId('date');
  const currentYear = partsInZone(nowMs(), getSettings().user.timezone).year;
  const year = input.year ?? (input.recurring === false ? currentYear : null);
  db.prepare(
    `INSERT INTO important_dates (id, character_id, title, month, day, year, recurring, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    getCharacter().id,
    input.title.slice(0, 80),
    month,
    day,
    year,
    input.recurring === false ? 0 : 1,
    (input.note ?? '').slice(0, 500),
    nowMs()
  );
  const row = db.prepare('SELECT * FROM important_dates WHERE id = ?').get(id) as Row;
  return mapImportantDate(row);
}

export function deleteImportantDate(id: string): void {
  db.prepare('DELETE FROM important_dates WHERE id = ? AND character_id = ?').run(
    id,
    getCharacter().id
  );
}

export function listNotes(): Note[] {
  const rows = db
    .prepare('SELECT * FROM notes WHERE character_id = ? ORDER BY done ASC, created_at DESC LIMIT 100')
    .all(getCharacter().id) as Row[];
  return rows.map(mapNote);
}

export function createNote(input: {
  title: string;
  content?: string;
  dueAt?: number | null;
}): Note {
  const id = newId('note');
  db.prepare(
    `INSERT INTO notes (id, character_id, title, content, due_at, done, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    getCharacter().id,
    input.title.slice(0, 120),
    (input.content ?? '').slice(0, 1000),
    input.dueAt ?? null,
    nowMs()
  );
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row;
  return mapNote(row);
}

export function updateNote(
  id: string,
  patch: { title?: string; content?: string; dueAt?: number | null; done?: boolean }
): Note {
  const row = db.prepare('SELECT * FROM notes WHERE id = ? AND character_id = ?').get(
    id,
    getCharacter().id
  ) as Row | undefined;
  if (!row) throw new Error('便签不存在');
  const current = mapNote(row);
  db.prepare('UPDATE notes SET title = ?, content = ?, due_at = ?, done = ? WHERE id = ?').run(
    patch.title == null ? current.title : patch.title.slice(0, 120),
    patch.content == null ? current.content : patch.content.slice(0, 1000),
    patch.dueAt === undefined ? current.dueAt : patch.dueAt,
    patch.done === undefined ? (current.done ? 1 : 0) : patch.done ? 1 : 0,
    id
  );
  return mapNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row);
}

export function deleteNote(id: string): void {
  db.prepare('DELETE FROM notes WHERE id = ? AND character_id = ?').run(id, getCharacter().id);
}

export function dueNotes(): Note[] {
  const rows = db
    .prepare(
      `SELECT * FROM notes WHERE character_id = ? AND done = 0 AND due_at IS NOT NULL
       AND due_at <= ? ORDER BY due_at ASC LIMIT 5`
    )
    .all(getCharacter().id, nowMs() + 12 * 3_600_000) as Row[];
  return rows.map(mapNote);
}
