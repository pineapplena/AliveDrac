import type { Agreement, AgreementStatus, AgreementsView, Memory } from '../shared/types.js';
import { getCharacter } from './character.js';
import { db, mapMemory } from './db.js';
import {
  completePromise,
  createMemory,
  findSimilarPromise,
  getMemory,
  updateMemory
} from './memory.js';
import { nowMs } from './time.js';

type Row = Record<string, any>;

function agreementFrom(memory: Memory): Agreement {
  const meta = memory.meta ?? {};
  const status: AgreementStatus =
    memory.status === 'done' ? 'done' : memory.status === 'archived' ? 'archived' : 'active';
  const number = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    id: memory.id,
    title: memory.title || memory.content.slice(0, 24),
    content: memory.content,
    status,
    source: memory.source,
    dueAt: number(meta.dueAt),
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    proactiveMentions: Number(meta.proactiveMentions ?? 0) || 0,
    mentionCount: Number(meta.mentionCount ?? 0) || 0,
    lastProactiveAt: number(meta.lastProactiveAt),
    remindersPausedUntil: number(meta.remindersPausedUntil),
    completedAt: number(meta.completedAt),
    completedBy: String(meta.completedBy ?? ''),
    completedReason: String(meta.completedReason ?? ''),
    completedEvidence: String(meta.completedEvidence ?? '')
  };
}

function rowsOf(status?: AgreementStatus): Memory[] {
  const wanted = status
    ? [status === 'done' ? 'done' : status === 'archived' ? 'archived' : 'active']
    : ['active', 'done', 'archived'];
  const placeholders = wanted.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM memories
       WHERE character_id = ? AND kind = 'promise' AND status IN (${placeholders})
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
         COALESCE(happened_at, created_at) DESC
       LIMIT 200`
    )
    .all(getCharacter().id, ...wanted) as Row[];
  return rows.map(mapMemory);
}

export function listAgreements(): AgreementsView {
  const all = rowsOf();
  const active = all.filter((item) => item.status === 'active').map(agreementFrom);
  const done = all.filter((item) => item.status === 'done').map(agreementFrom);
  const archived = all.filter((item) => item.status === 'archived').map(agreementFrom);
  const paused = active.filter(
    (item) => item.remindersPausedUntil && item.remindersPausedUntil > nowMs()
  ).length;
  return {
    active,
    done,
    archived,
    stats: { active: active.length, done: done.length, archived: archived.length, paused }
  };
}

export function getAgreement(id: string): Agreement | null {
  const memory = getMemory(id);
  if (!memory || memory.kind !== 'promise') return null;
  return agreementFrom(memory);
}

export interface AgreementInput {
  title?: string;
  content: string;
  dueAt?: number | null;
}

export function createAgreement(input: AgreementInput): { agreement: Agreement; deduplicated: boolean } {
  const character = getCharacter();
  const content = String(input.content ?? '').trim();
  if (content.length < 2) throw new Error('约定内容太短');
  const title = String(input.title ?? '').trim().slice(0, 80) || content.slice(0, 24);
  const dueAt =
    input.dueAt == null || !Number.isFinite(Number(input.dueAt)) ? null : Number(input.dueAt);
  const existing = findSimilarPromise(content, undefined, title);
  if (existing && existing.status === 'active') {
    return { agreement: agreementFrom(existing), deduplicated: true };
  }
  const memory = createMemory({
    kind: 'promise',
    title,
    content,
    importance: 0.75,
    confidence: 0.9,
    valence: 0.1,
    source: 'agreement-board',
    happenedAt: nowMs(),
    tags: ['未完成', '约定', '约定板'],
    meta: {
      board: true,
      manual: true,
      dueAt,
      dueHint: dueAt ? 'at' : 'none'
    }
  });
  if (!memory) throw new Error('约定保存失败');
  return { agreement: agreementFrom(memory), deduplicated: false };
}

export function updateAgreement(id: string, input: AgreementInput): Agreement {
  const memory = getMemory(id);
  if (!memory || memory.kind !== 'promise' || memory.status === 'deleted') {
    throw new Error('约定不存在');
  }
  const content = String(input.content ?? '').trim();
  if (content.length < 2) throw new Error('约定内容太短');
  const title = String(input.title ?? '').trim().slice(0, 80) || content.slice(0, 24);
  const dueAt =
    input.dueAt == null || !Number.isFinite(Number(input.dueAt)) ? null : Number(input.dueAt);
  const updated = updateMemory(id, {
    title,
    content,
    meta: {
      ...memory.meta,
      dueAt,
      dueHint: dueAt ? 'at' : 'none',
      editedByUserAt: nowMs()
    }
  });
  return agreementFrom(updated);
}

export function completeAgreement(id: string, reason = '用户在约定板标记完成'): Agreement {
  const memory = completePromise(id, {
    by: 'user',
    reason,
    evidence: '约定板'
  });
  if (!memory) throw new Error('约定不存在或已经完成');
  return agreementFrom(memory);
}

export function reopenAgreement(id: string): Agreement {
  const memory = getMemory(id);
  if (!memory || memory.kind !== 'promise') throw new Error('约定不存在');
  if (memory.status === 'archived') {
    const restored = updateMemory(id, {
      status: 'active',
      tags: ['未完成', ...memory.tags.filter((tag) => tag !== '已完成' && tag !== '已归档')].slice(0, 12)
    });
    return agreementFrom(restored);
  }
  const reopened = updateMemory(id, {
    status: 'active',
    tags: ['未完成', ...memory.tags.filter((tag) => tag !== '已完成' && tag !== '已归档')].slice(0, 12),
    meta: {
      ...memory.meta,
      completedAt: undefined,
      completedBy: undefined,
      completedReason: undefined,
      completedEvidence: undefined
    }
  });
  return agreementFrom(reopened);
}

export function archiveAgreement(id: string): Agreement {
  const memory = getMemory(id);
  if (!memory || memory.kind !== 'promise') throw new Error('约定不存在');
  const updated = updateMemory(id, {
    status: 'archived',
    tags: ['已归档', ...memory.tags.filter((tag) => tag !== '未完成' && tag !== '已归档')].slice(0, 12)
  });
  return agreementFrom(updated);
}

export function pauseAgreementReminders(id: string, days = 7): Agreement {
  const memory = getMemory(id);
  if (!memory || memory.kind !== 'promise') throw new Error('约定不存在');
  const until = nowMs() + Math.max(1, Math.min(30, Math.round(days))) * 86_400_000;
  const updated = updateMemory(id, {
    meta: { ...memory.meta, remindersPausedUntil: until }
  });
  return agreementFrom(updated);
}

export function resumeAgreementReminders(id: string): Agreement {
  const memory = getMemory(id);
  if (!memory || memory.kind !== 'promise') throw new Error('约定不存在');
  const meta = { ...memory.meta };
  delete meta.remindersPausedUntil;
  return agreementFrom(updateMemory(id, { meta }));
}
