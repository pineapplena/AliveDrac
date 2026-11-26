import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment, VisionSummary } from '../shared/types.js';
import { ASSETS_DIR } from './config.js';
import { db, newId } from './db.js';
import { getCharacter, getReferenceImages } from './character.js';
import { describeImage, visionConfigured } from './vision.js';
import { nowMs } from './time.js';

type Row = Record<string, any>;

export const UPLOADS_DIR = resolve(ASSETS_DIR, 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

function parseVision(row: Row): VisionSummary | null {
  if (!row.vision || row.vision === '{}') return null;
  try {
    const parsed = JSON.parse(String(row.vision)) as VisionSummary;
    if (!parsed || !parsed.analyzedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mapUpload(row: Row): Attachment {
  return {
    id: String(row.id),
    url: `/assets/uploads/${String(row.file_name)}`,
    mime: String(row.mime),
    name: String(row.file_name),
    size: Number(row.size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    vision: parseVision(row)
  };
}

export function saveUpload(input: {
  dataUrl: string;
  name?: string;
  width?: number | null;
  height?: number | null;
}): Attachment {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    input.dataUrl
  );
  if (!match) throw new Error('只支持 PNG / JPG / WebP / GIF 图片');
  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('图片是空的');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('图片不能超过 8MB');
  const extension = MIME_EXT[mime] ?? 'png';
  const fileName = `upload-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const filePath = resolve(UPLOADS_DIR, fileName);
  writeFileSync(filePath, buffer);
  const id = newId('upl');
  db.prepare(
    `INSERT INTO uploads
      (id, character_id, file_name, mime, size, width, height, vision, vision_model, analyzed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', NULL, NULL, ?)`
  ).run(
    id,
    getCharacter().id,
    fileName,
    mime,
    buffer.length,
    input.width ?? null,
    input.height ?? null,
    nowMs()
  );
  return mapUpload(db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as Row);
}

export function getUpload(id: string): Attachment | null {
  const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as Row | undefined;
  return row ? mapUpload(row) : null;
}

export function getUploads(ids: string[]): Attachment[] {
  if (!ids.length) return [];
  const unique = [...new Set(ids)].slice(0, 6);
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM uploads WHERE id IN (${placeholders})`)
    .all(...unique) as Row[];
  const byId = new Map(rows.map((row) => [String(row.id), mapUpload(row)]));
  return unique.map((id) => byId.get(id)).filter((item): item is Attachment => Boolean(item));
}

export function uploadPath(attachment: Attachment): string {
  const row = db.prepare('SELECT file_name FROM uploads WHERE id = ?').get(attachment.id) as
    | Row
    | undefined;
  if (!row) throw new Error('图片不存在');
  return resolve(UPLOADS_DIR, String(row.file_name));
}

export async function analyzeUpload(
  attachment: Attachment,
  context = ''
): Promise<Attachment> {
  const references = getReferenceImages();
  const signature = references.length
    ? references.map((reference) => reference.id).join('|')
    : 'none';
  if (
    attachment.vision &&
    attachment.vision.referenceSignature === signature &&
    attachment.vision.identity
  ) {
    return attachment;
  }
  if (!visionConfigured()) return attachment;
  try {
    const vision = await describeImage(
      uploadPath(attachment),
      attachment.mime,
      context,
      references
    );
    db.prepare(
      'UPDATE uploads SET vision = ?, vision_model = ?, analyzed_at = ? WHERE id = ?'
    ).run(JSON.stringify(vision), vision.model, vision.analyzedAt, attachment.id);
    return { ...attachment, vision };
  } catch {
    return attachment;
  }
}

