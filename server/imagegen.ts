import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { GeneratedImage } from '../shared/types.js';
import { ASSETS_DIR } from './config.js';
import { db, newId } from './db.js';
import { getSettings } from './settings.js';
import { dateKey, nowMs, zonedDateTimeToMs } from './time.js';

type Row = Record<string, any>;

const IMAGE_DIR = resolve(ASSETS_DIR, 'generated');
const MAX_BYTES = 20 * 1024 * 1024;

function mapImage(row: Row): GeneratedImage {
  return {
    id: String(row.id),
    prompt: String(row.prompt),
    url: String(row.url),
    mime: String(row.mime ?? 'image/png'),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    source: String(row.source ?? 'selfie'),
    createdAt: Number(row.created_at)
  };
}

function imageKey(): string {
  const image = getSettings().image;
  if (image.apiKey) return image.apiKey;
  const provider = getSettings().provider;
  try {
    if (new URL(image.baseUrl).origin === new URL(provider.baseUrl).origin) {
      return provider.apiKey;
    }
  } catch {
    // The request builder reports an invalid URL.
  }
  return '';
}

export function imageConfigured(): boolean {
  const image = getSettings().image;
  return Boolean(image.enabled && image.baseUrl && image.model && imageKey());
}

function imageEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/images/generations')) return url.toString();
  if (path.endsWith('/images/edits')) {
    url.pathname = `${path.slice(0, -'/images/edits'.length)}/images/generations`;
    return url.toString();
  }
  if (path.endsWith('/v1')) url.pathname = `${path}/images/generations`;
  else url.pathname = `${path}/v1/images/generations`.replace(/\/+/g, '/');
  return url.toString();
}

function imageEditEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/images/edits')) return url.toString();
  if (path.endsWith('/images/generations')) {
    url.pathname = `${path.slice(0, -'/images/generations'.length)}/images/edits`;
    return url.toString();
  }
  if (path.endsWith('/v1')) url.pathname = `${path}/images/edits`;
  else url.pathname = `${path}/v1/images/edits`.replace(/\/+/g, '/');
  return url.toString();
}

export interface ImageReference {
  path: string;
  mime: string;
}

export function countGeneratedToday(characterId: string): number {
  const timezone = getSettings().user.timezone;
  const today = dateKey(nowMs(), timezone);
  const start = zonedDateTimeToMs(today, 0, timezone);
  const rows = db
    .prepare(
      'SELECT created_at FROM generated_images WHERE character_id = ? AND created_at >= ?'
    )
    .all(characterId, start) as Row[];
  return rows.length;
}

export function getGeneratedImages(characterId: string, limit = 24): GeneratedImage[] {
  const rows = db
    .prepare(
      'SELECT * FROM generated_images WHERE character_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(characterId, Math.max(1, Math.min(limit, 80))) as Row[];
  return rows.map(mapImage);
}

export function getGeneratedImage(id: string): GeneratedImage | null {
  const row = db.prepare('SELECT * FROM generated_images WHERE id = ?').get(id) as
    | Row
    | undefined;
  return row ? mapImage(row) : null;
}

function imageDimensions(buffer: Buffer, mime: string): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7)
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // Dimensions are optional.
  }
  return { width: null, height: null };
}

function saveImage(
  characterId: string,
  prompt: string,
  buffer: Buffer,
  mime: string,
  source: string
): GeneratedImage {
  if (!buffer.length) throw new Error('生图服务返回了空图片');
  if (buffer.length > MAX_BYTES) throw new Error('生成的图片太大，已放弃保存');
  if (!existsSync(IMAGE_DIR)) mkdirSync(IMAGE_DIR, { recursive: true });
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const fileName = `image-${nowMs()}-${randomUUID().slice(0, 8)}.${ext}`;
  writeFileSync(join(IMAGE_DIR, fileName), buffer);
  const dimensions = imageDimensions(buffer, mime);
  const id = newId('img');
  db.prepare(
    `INSERT INTO generated_images
      (id, character_id, prompt, url, mime, width, height, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    characterId,
    prompt.slice(0, 4000),
    `/assets/generated/${fileName}`,
    mime,
    dimensions.width,
    dimensions.height,
    source.slice(0, 40),
    nowMs()
  );
  return mapImage(
    db.prepare('SELECT * FROM generated_images WHERE id = ?').get(id) as Row
  );
}

async function readImageResponse(response: Response): Promise<{ buffer: Buffer; mime: string }> {
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.startsWith('image/')) {
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mime: contentType.split(';')[0] || 'image/png'
    };
  }
  const data = (await response.json()) as any;
  const item = data?.data?.[0] ?? data?.images?.[0] ?? data;
  const b64 = item?.b64_json ?? item?.b64 ?? data?.b64_json;
  if (typeof b64 === 'string') {
    const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(b64);
    const raw = dataMatch ? dataMatch[2] : b64;
    if (raw.length > 20) {
      return { buffer: Buffer.from(raw, 'base64'), mime: dataMatch?.[1] ?? 'image/png' };
    }
  }
  const url = item?.url ?? data?.url;
  if (typeof url === 'string' && url.startsWith('data:image/')) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url);
    if (match) return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] };
  }
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    const image = await fetch(url, {
      headers: imageKey() ? { Authorization: `Bearer ${imageKey()}` } : undefined,
      signal: AbortSignal.timeout(60_000)
    });
    if (!image.ok) throw new Error(`下载生成图片失败（${image.status}）`);
    return {
      buffer: Buffer.from(await image.arrayBuffer()),
      mime: String(image.headers.get('content-type') ?? 'image/png').split(';')[0]
    };
  }
  throw new Error('生图服务没有返回图片数据');
}

export async function generateImage(input: {
  characterId: string;
  prompt: string;
  source?: string;
  references?: ImageReference[];
}): Promise<GeneratedImage> {
  const settings = getSettings().image;
  const apiKey = imageKey();
  if (!settings.enabled || !apiKey) throw new Error('生图模型还没有配置');
  const prompt = String(input.prompt ?? '').trim().slice(0, 4000);
  if (!prompt) throw new Error('先写一点画面描述');
  const references = (input.references ?? []).filter(
    (reference) =>
      existsSync(reference.path) &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(reference.mime)
  );
  const baseBody: Record<string, unknown> = {
    model: settings.model,
    prompt,
    n: 1,
    size: settings.size
  };
  if (settings.quality) baseBody.quality = settings.quality;

  let response: Response;
  if (references.length) {
    const requestEdit = async (
      selected: ImageReference[],
      includeFormat: boolean
    ): Promise<Response> => {
      const form = new FormData();
      form.append('model', settings.model);
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', settings.size);
      if (settings.quality) form.append('quality', settings.quality);
      if (includeFormat) form.append('response_format', 'b64_json');
      selected.slice(0, 3).forEach((reference, index) => {
        const buffer = readFileSync(reference.path);
        const extension = extname(reference.path).replace(/^\./, '') || 'png';
        const field = selected.length > 1 ? 'image[]' : 'image';
        form.append(
          field,
          new Blob([buffer], { type: reference.mime }),
          `reference-${index + 1}.${extension}`
        );
      });
      return fetch(imageEditEndpoint(settings.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json'
        },
        body: form,
        signal: AbortSignal.timeout(180_000)
      });
    };
    response = await requestEdit(references, true);
    if (!response.ok && response.status === 400) {
      response = await requestEdit(references, false);
    }
    if (!response.ok && response.status === 400 && references.length > 1) {
      response = await requestEdit(references.slice(0, 1), true);
    }
    if (!response.ok && response.status === 400 && references.length > 1) {
      response = await requestEdit(references.slice(0, 1), false);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 400);
      throw new Error(
        `参考图生图失败（${response.status}）——当前接口可能不支持 /images/edits，或参考图格式不被接受。${detail ? `：${detail}` : ''}`
      );
    }
  } else {
    const endpoint = imageEndpoint(settings.baseUrl);
    const request = async (payload: Record<string, unknown>): Promise<Response> =>
      fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000)
      });
    response = await request({ ...baseBody, response_format: 'b64_json' });
    if (!response.ok && response.status === 400) {
      response = await request(baseBody);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 400);
      throw new Error(`生图失败（${response.status}）${detail ? `：${detail}` : ''}`);
    }
  }
  const image = await readImageResponse(response);
  return saveImage(
    input.characterId,
    prompt,
    image.buffer,
    image.mime,
    input.source ?? 'selfie'
  );
}

export function deleteGeneratedImage(characterId: string, id: string): boolean {
  const row = db
    .prepare('SELECT * FROM generated_images WHERE character_id = ? AND id = ?')
    .get(characterId, id) as Row | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM generated_images WHERE character_id = ? AND id = ?').run(
    characterId,
    id
  );
  try {
    const url = String(row.url);
    if (url.startsWith('/assets/generated/')) {
      const file = resolve(IMAGE_DIR, url.slice('/assets/generated/'.length));
      if (file.startsWith(IMAGE_DIR) && existsSync(file)) unlinkSync(file);
    }
  } catch {
    // The record is gone even if the file was already missing.
  }
  return true;
}
