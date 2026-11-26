import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-notes-'));

const notes = await import('../server/notes.js');

test('important dates can be stored and listed', () => {
  const date = notes.createImportantDate({
    title: '复查',
    month: 10,
    day: 22,
    note: '陪他一起去',
    recurring: false
  });
  assert.equal(date.title, '复查');
  assert.equal(notes.listImportantDates().length, 1);
});

test('notes appear when due', () => {
  const note = notes.createNote({
    title: '带伞',
    content: '傍晚有雨',
    dueAt: Date.now() + 60_000
  });
  assert.equal(note.done, false);
  assert.ok(notes.dueNotes().some((item) => item.id === note.id));
  const done = notes.updateNote(note.id, { done: true });
  assert.equal(done.done, true);
  assert.equal(notes.dueNotes().some((item) => item.id === note.id), false);
});
