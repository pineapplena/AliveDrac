import type { MemoryIndexStats } from '../shared/types.js';
import { db, getMeta, setMeta } from './db.js';
import { getCharacter } from './character.js';
import { embeddingConfigured, embeddingModel, embedTexts } from './embedding.js';
import { bufferToVector, vectorToBuffer } from './vector.js';
import { getSettings } from './settings.js';
import { nowMs } from './time.js';

type Row = Record<string, any>;

function memoryText(row: Row): string {
  const title = String(row.title ?? '').trim();
  const content = String(row.content ?? '').trim();
  const tags = String(row.tags ?? '[]');
  return [title, content, tags].filter(Boolean).join('\n').slice(0, 2000);
}

function vectorRow(memoryId: string): Row | undefined {
  return db.prepare('SELECT * FROM memory_vectors WHERE memory_id = ?').get(memoryId) as
    | Row
    | undefined;
}

export function deleteMemoryVector(memoryId: string): void {
  db.prepare('DELETE FROM memory_vectors WHERE memory_id = ?').run(memoryId);
}

export async function indexMemory(memoryId: string, force = false): Promise<boolean> {
  if (!embeddingConfigured()) return false;
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as Row | undefined;
  if (!row || row.status !== 'active') {
    deleteMemoryVector(memoryId);
    return false;
  }
  const existing = vectorRow(memoryId);
  if (!force && existing && existing.model === embeddingModel()) return false;
  if (force) deleteMemoryVector(memoryId);
  try {
    const [vector] = await embedTexts([memoryText(row)]);
    if (!vector) return false;
    db.prepare(
      `INSERT INTO memory_vectors (memory_id, model, dim, vector, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(memory_id) DO UPDATE SET model=excluded.model, dim=excluded.dim,
         vector=excluded.vector, created_at=excluded.created_at`
    ).run(memoryId, embeddingModel(), vector.length, vectorToBuffer(vector), nowMs());
    return true;
  } catch (error) {
    setMeta(
      'embedding_last_error',
      error instanceof Error ? `${error.message}${(error as any).detail ? ` ${(error as any).detail}` : ''}` : String(error)
    );
    return false;
  }
}

export function getMemoryIndexStats(): MemoryIndexStats {
  const settings = getSettings();
  const model = settings.memory.embedding.model;
  const id = getCharacter().id;
  const totalRow = db
    .prepare("SELECT COUNT(*) AS n FROM memories WHERE character_id = ? AND status = 'active'")
    .get(id) as Row;
  const indexedRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM memory_vectors v
       JOIN memories m ON m.id = v.memory_id
       WHERE m.character_id = ? AND m.status = 'active' AND v.model = ?`
    )
    .get(id, model) as Row;
  const dimRow = db
    .prepare('SELECT dim FROM memory_vectors WHERE model = ? ORDER BY created_at DESC LIMIT 1')
    .get(model) as Row | undefined;
  const total = Number(totalRow?.n ?? 0);
  const indexed = Number(indexedRow?.n ?? 0);
  return {
    enabled: settings.memory.embedding.enabled,
    configured: embeddingConfigured(),
    model,
    total,
    indexed,
    pending: Math.max(0, total - indexed),
    dimensions: Number(dimRow?.dim ?? 0),
    lastError: getMeta('embedding_last_error') || null
  };
}

export async function indexPending(limit = 32): Promise<MemoryIndexStats> {
  const settings = getSettings();
  if (!embeddingConfigured()) return getMemoryIndexStats();
  const model = settings.memory.embedding.model;
  if (getMeta('embedding_model') && getMeta('embedding_model') !== model) {
    db.prepare('DELETE FROM memory_vectors').run();
    setMeta('embedding_model', model);
  }
  const rows = db
    .prepare(
      `SELECT m.* FROM memories m
       LEFT JOIN memory_vectors v ON v.memory_id = m.id AND v.model = ?
       WHERE m.character_id = ? AND m.status = 'active' AND v.memory_id IS NULL
       ORDER BY m.pinned DESC, m.importance DESC, m.updated_at DESC LIMIT ?`
    )
    .all(model, getCharacter().id, Math.min(64, Math.max(1, limit))) as Row[];
  if (!rows.length) return getMemoryIndexStats();
  try {
    const insert = db.prepare(
      `INSERT INTO memory_vectors (memory_id, model, dim, vector, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(memory_id) DO UPDATE SET model=excluded.model, dim=excluded.dim,
         vector=excluded.vector, created_at=excluded.created_at`
    );
    const batchSize = Math.max(1, settings.memory.embedding.batchSize);
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const chunk = rows.slice(offset, offset + batchSize);
      const vectors = await embedTexts(chunk.map(memoryText));
      db.exec('BEGIN');
      try {
        chunk.forEach((row, index) => {
          const vector = vectors[index];
          if (!vector) return;
          insert.run(String(row.id), model, vector.length, vectorToBuffer(vector), nowMs());
        });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    setMeta('embedding_model', model);
  } catch (error) {
    setMeta(
      'embedding_last_error',
      error instanceof Error ? `${error.message}${(error as any).detail ? ` ${(error as any).detail}` : ''}` : String(error)
    );
  }
  return getMemoryIndexStats();
}

export async function reindexAll(): Promise<MemoryIndexStats> {
  if (!embeddingConfigured()) return getMemoryIndexStats();
  db.prepare('DELETE FROM memory_vectors').run();
  setMeta('embedding_model', embeddingModel());
  for (let round = 0; round < 20; round++) {
    const stats = await indexPending(32);
    if (stats.pending === 0 || stats.lastError) return stats;
  }
  return getMemoryIndexStats();
}

export function loadMemoryVectors(memoryIds: string[]): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  if (!memoryIds.length) return out;
  const model = embeddingModel();
  const unique = [...new Set(memoryIds)].slice(0, 500);
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT memory_id, vector FROM memory_vectors
       WHERE model = ? AND memory_id IN (${placeholders})`
    )
    .all(model, ...unique) as Row[];
  for (const row of rows) {
    try {
      out.set(String(row.memory_id), bufferToVector(row.vector as Uint8Array));
    } catch {
      // Skip corrupt vectors; they will be re-indexed later.
    }
  }
  return out;
}
