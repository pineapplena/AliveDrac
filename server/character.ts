import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { Character, CharacterReference, LorebookEntry } from '../shared/types.js';
import { ASSETS_DIR } from './config.js';
import { db, getMeta, mapCharacter, newId, setMeta } from './db.js';
import { nowMs } from './time.js';

type Row = Record<string, any>;

const REFERENCE_DIR = resolve(ASSETS_DIR, 'references');
if (!existsSync(REFERENCE_DIR)) mkdirSync(REFERENCE_DIR, { recursive: true });

function mapReference(row: Row): CharacterReference {
  return {
    id: String(row.id),
    url: String(row.url),
    mime: String(row.mime),
    caption: String(row.caption ?? ''),
    createdAt: Number(row.created_at)
  };
}

function listReferences(characterId: string): CharacterReference[] {
  const rows = db
    .prepare('SELECT * FROM character_references WHERE character_id = ? ORDER BY created_at ASC')
    .all(characterId) as Row[];
  return rows.map(mapReference);
}

function mimeOf(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function ensureAvatarReference(characterId: string, avatarUrl: string | null): void {
  const flag = `reference_init_${characterId}`;
  if (getMeta(flag)) return;
  setMeta(flag, '1');
  if (!avatarUrl || !avatarUrl.startsWith('/assets/')) return;
  const sourceName = basename(avatarUrl);
  const sourcePath = resolve(ASSETS_DIR, sourceName);
  if (!existsSync(sourcePath)) return;
  const fileName = `ref-${characterId}-${Date.now()}-${sourceName}`;
  writeFileSync(resolve(REFERENCE_DIR, fileName), readFileSync(sourcePath));
  db.prepare(
    `INSERT INTO character_references (id, character_id, file_name, url, mime, caption, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId('ref'),
    characterId,
    fileName,
    `/assets/references/${fileName}`,
    mimeOf(fileName),
    '默认参考图（当前头像）',
    nowMs()
  );
}

export function getCharacter(id = 'char-main'): Character {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined;
  if (!row) {
    const first = db.prepare('SELECT * FROM characters ORDER BY created_at LIMIT 1').get() as
      | Row
      | undefined;
    if (!first) throw new Error('还没有角色卡');
    return getCharacter(String(first.id));
  }
  ensureAvatarReference(String(row.id), row.avatar_url ? String(row.avatar_url) : null);
  const lore = db
    .prepare('SELECT * FROM lorebook WHERE character_id = ? ORDER BY insertion_order ASC')
    .all(id) as Row[];
  const character = mapCharacter(row, lore);
  character.references = listReferences(id);
  return character;
}

export interface CharacterPatch {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMes?: string;
  mesExample?: string;
  systemPrompt?: string;
  postHistory?: string;
  alternateGreetings?: string[];
  tags?: string[];
  lorebook?: Omit<LorebookEntry, 'id'>[];
}

export function updateCharacter(patch: CharacterPatch, id = 'char-main'): Character {
  const current = getCharacter(id);
  const next = {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    personality: patch.personality ?? current.personality,
    scenario: patch.scenario ?? current.scenario,
    firstMes: patch.firstMes ?? current.firstMes,
    mesExample: patch.mesExample ?? current.mesExample,
    systemPrompt: patch.systemPrompt ?? current.systemPrompt,
    postHistory: patch.postHistory ?? current.postHistory,
    alternateGreetings: patch.alternateGreetings ?? current.alternateGreetings,
    tags: patch.tags ?? current.tags
  };
  db.prepare(
    `UPDATE characters SET name=?, description=?, personality=?, scenario=?, first_mes=?,
      mes_example=?, system_prompt=?, post_history=?, alternate_greetings=?, tags=?, updated_at=?
     WHERE id=?`
  ).run(
    next.name,
    next.description,
    next.personality,
    next.scenario,
    next.firstMes,
    next.mesExample,
    next.systemPrompt,
    next.postHistory,
    JSON.stringify(next.alternateGreetings),
    JSON.stringify(next.tags),
    nowMs(),
    id
  );

  if (patch.lorebook) {
    db.prepare('DELETE FROM lorebook WHERE character_id = ?').run(id);
    for (const [index, entry] of patch.lorebook.entries()) {
      db.prepare(
        `INSERT INTO lorebook (id, character_id, keys, content, enabled, constant, insertion_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId('lore'),
        id,
        JSON.stringify(entry.keys ?? []),
        String(entry.content ?? ''),
        entry.enabled === false ? 0 : 1,
        entry.constant ? 1 : 0,
        Number(entry.insertionOrder ?? index * 10 + 10)
      );
    }
  }
  return getCharacter(id);
}

export function saveAvatar(dataUrl: string, id = 'char-main'): string {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('头像格式不支持，请使用 PNG/JPG/WebP');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const fileName = `avatar-${id}-${Date.now()}.${ext}`;
  writeFileSync(resolve(ASSETS_DIR, fileName), Buffer.from(match[2], 'base64'));
  const url = `/assets/${fileName}`;
  db.prepare('UPDATE characters SET avatar_url = ?, updated_at = ? WHERE id = ?').run(
    url,
    nowMs(),
    id
  );
  return url;
}

export function addCharacterReference(
  dataUrl: string,
  caption = '',
  id = 'char-main'
): CharacterReference {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    dataUrl
  );
  if (!match) throw new Error('参考图格式不支持，请使用 PNG/JPG/WebP/GIF');
  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('参考图是空的');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('参考图不能超过 8MB');
  const count = listReferences(id).length;
  if (count >= 6) throw new Error('最多保存 6 张形象参考图');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const fileName = `ref-${id}-${Date.now()}.${ext}`;
  writeFileSync(resolve(REFERENCE_DIR, fileName), buffer);
  const refId = newId('ref');
  const url = `/assets/references/${fileName}`;
  db.prepare(
    `INSERT INTO character_references (id, character_id, file_name, url, mime, caption, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    refId,
    id,
    fileName,
    url,
    mime,
    caption.slice(0, 200),
    nowMs()
  );
  const row = db.prepare('SELECT * FROM character_references WHERE id = ?').get(refId) as Row;
  return mapReference(row);
}

export function deleteCharacterReference(referenceId: string, id = 'char-main'): void {
  const row = db
    .prepare('SELECT file_name FROM character_references WHERE id = ? AND character_id = ?')
    .get(referenceId, id) as Row | undefined;
  db.prepare('DELETE FROM character_references WHERE id = ? AND character_id = ?').run(
    referenceId,
    id
  );
  if (row?.file_name) {
    try {
      unlinkSync(resolve(REFERENCE_DIR, String(row.file_name)));
    } catch {
      // Best effort; a missing file should not block removing the reference.
    }
  }
}

export function getReferenceImages(): { path: string; mime: string; caption: string; id: string }[] {
  const character = getCharacter();
  return character.references
    .map((reference) => {
      if (!reference.url.startsWith('/assets/')) return null;
      const relative = reference.url.slice('/assets/'.length);
      const path = resolve(ASSETS_DIR, relative);
      if (!existsSync(path)) return null;
      return {
        id: reference.id,
        path,
        mime: reference.mime || mimeOf(relative),
        caption: reference.caption
      };
    })
    .filter((item): item is { path: string; mime: string; caption: string; id: string } =>
      Boolean(item)
    );
}

export interface ImportedCard {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMes?: string;
  mesExample?: string;
  systemPrompt?: string;
  postHistory?: string;
  alternateGreetings?: string[];
  tags?: string[];
  lorebook?: Omit<LorebookEntry, 'id'>[];
  avatarDataUrl?: string;
}

export function normalizeCard(raw: Record<string, any>): ImportedCard {
  const loreRaw: any[] = Array.isArray(raw.lorebook)
    ? raw.lorebook
    : Array.isArray(raw.character_book?.entries)
      ? raw.character_book.entries
      : [];
  return {
    name: String(raw.name ?? raw.char_name ?? '未命名').slice(0, 80),
    description: String(raw.description ?? raw.char_persona ?? ''),
    personality: String(raw.personality ?? ''),
    scenario: String(raw.scenario ?? raw.world_scenario ?? ''),
    firstMes: String(raw.firstMes ?? raw.first_mes ?? raw.greeting ?? ''),
    mesExample: String(raw.mesExample ?? raw.mes_example ?? raw.example_dialogue ?? ''),
    systemPrompt: String(raw.systemPrompt ?? raw.system_prompt ?? ''),
    postHistory: String(raw.postHistoryInstructions ?? raw.post_history_instructions ?? ''),
    alternateGreetings: Array.isArray(raw.alternateGreetings)
      ? raw.alternateGreetings.map(String)
      : Array.isArray(raw.alternate_greetings)
        ? raw.alternate_greetings.map(String)
        : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    lorebook: loreRaw.map((entry, index) => ({
      keys: Array.isArray(entry.keys) ? entry.keys.map(String) : [String(entry.key ?? '')],
      content: String(entry.content ?? ''),
      enabled: entry.enabled !== false,
      constant: Boolean(entry.constant),
      insertionOrder: Number(entry.insertionOrder ?? entry.insertion_order ?? entry.order ?? index * 10 + 10)
    })),
    avatarDataUrl: typeof raw.avatarDataUrl === 'string' ? raw.avatarDataUrl : undefined
  };
}

export function importCard(raw: Record<string, any>, id = 'char-main'): Character {
  const card = normalizeCard(raw);
  const character = updateCharacter(
    {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      firstMes: card.firstMes,
      mesExample: card.mesExample,
      systemPrompt: card.systemPrompt,
      postHistory: card.postHistory,
      alternateGreetings: card.alternateGreetings,
      tags: card.tags,
      lorebook: card.lorebook
    },
    id
  );
  if (card.avatarDataUrl) saveAvatar(card.avatarDataUrl, id);
  return getCharacter(id);
}

export function loadSeedCard(): Record<string, any> | null {
  const path = resolve(process.cwd(), 'seed', 'character.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
  } catch {
    return null;
  }
}
