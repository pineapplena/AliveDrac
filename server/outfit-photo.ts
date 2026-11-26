import type { GeneratedImage, ImageSettings } from '../shared/types.js';
import { getCharacter, getReferenceImages } from './character.js';
import { publish } from './events.js';
import {
  countGeneratedToday,
  generateImage,
  getGeneratedImage,
  imageConfigured
} from './imagegen.js';
import { createMessage } from './memory.js';
import { getSettings } from './settings.js';
import { db, setMeta } from './db.js';
import { nowMs } from './time.js';

const inFlight = new Set<string>();
const lastAttempt = new Map<string, number>();

function appearanceAnchor(): string {
  const character = getCharacter();
  const match = /外表[：:]\s*([^\n]+)/.exec(character.description);
  if (match?.[1]) return match[1].trim();
  return [character.name, character.tags.join('、')].filter(Boolean).join('，');
}

export function getOutfitPhoto(characterId: string, date: string): GeneratedImage | null {
  const row = db
    .prepare('SELECT image_id FROM outfit_photos WHERE character_id = ? AND date = ?')
    .get(characterId, date) as { image_id?: string } | undefined;
  return row?.image_id ? getGeneratedImage(String(row.image_id)) : null;
}

export function setOutfitPhoto(
  characterId: string,
  date: string,
  image: GeneratedImage
): void {
  db.prepare(
    `INSERT INTO outfit_photos (character_id, date, image_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id, date) DO UPDATE SET
       image_id = excluded.image_id,
       created_at = excluded.created_at`
  ).run(characterId, date, image.id, image.createdAt);
  publish('outfit_photo', { date, image });
}

export function buildOutfitPhotoPrompt(input: {
  outfit: string;
  scene?: string;
  referenceCount?: number;
}): string {
  const character = getCharacter();
  const settings = getSettings();
  const identity = settings.image.identityPrompt.trim() || appearanceAnchor();
  const style = settings.image.stylePrompt.trim();
  const scene =
    String(input.scene ?? '').trim() ||
    '在窗边站定，半身或全身穿搭照，自然光，看向镜头。';
  return [
    identity,
    `角色：${character.name}`,
    `今日穿搭：${input.outfit}`,
    `画面：${scene}`,
    input.referenceCount
      ? `参考图说明：共 ${input.referenceCount} 张角色形象参考图，以参考图中的脸型、发色、瞳色、龙角等固定特征为准，保持同一角色。`
      : '',
    style,
    '单人，完整人物，自然比例，画面干净，避免文字、水印和多余肢体。'
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

function selectedReferences(settings: ImageSettings) {
  if (!settings.useReferences) return [];
  return getReferenceImages()
    .filter((reference) => ['image/png', 'image/jpeg', 'image/webp'].includes(reference.mime))
    .slice(0, 3)
    .map((reference) => ({ path: reference.path, mime: reference.mime }));
}

function morningText(date: string): string {
  const templates = [
    '唔，早。今天穿这身，先拍给你看。',
    '起床了。衣服挑好了，给你看一眼。',
    '早。今天的光刚好，顺手把穿搭拍下来了。',
    '醒了。今天的衣服是这样，别猜了，直接看。'
  ];
  const seed = [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return templates[seed % templates.length];
}

export async function maybeSendMorningOutfitPhoto(input: {
  date: string;
  outfit: string;
  wakeMin: number;
}): Promise<GeneratedImage | null> {  const settings = getSettings();
  if (!settings.image.enabled || !settings.image.autoMorningPhoto || !imageConfigured()) {
    return null;
  }
  const character = getCharacter();
  const existing = getOutfitPhoto(character.id, input.date);
  if (existing) return existing;
  const key = `${character.id}|${input.date}`;
  if (inFlight.has(key)) return null;
  const attempted = lastAttempt.get(key) ?? 0;
  if (attempted && nowMs() - attempted < 30 * 60_000) return null;
  if (countGeneratedToday(character.id) >= settings.image.maxPerDay) return null;

  inFlight.add(key);
  lastAttempt.set(key, nowMs());
  try {
    const references = selectedReferences(settings.image);
    const image = await generateImage({
      characterId: character.id,
      prompt: buildOutfitPhotoPrompt({
        outfit: input.outfit,
        scene: '刚起床，在房间窗边站定，半身或全身穿搭照，头发自然，晨光。',
        referenceCount: references.length
      }),
      source: 'morning-outfit',
      references
    });
    setOutfitPhoto(character.id, input.date, image);
    const text = morningText(input.date);
    createMessage({
      role: 'assistant',
      content: text,
      kind: 'outfit',
      meta: {
        image,
        outfitDate: input.date,
        outfit: input.outfit,
        wakeMin: input.wakeMin,
        source: 'morning-outfit'
      }
    });
    setMeta(`morning_outfit_photo_${input.date}`, String(image.createdAt));
    return image;
  } catch (error) {
    console.warn(
      '[outfit-photo] morning photo failed:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  } finally {
    inFlight.delete(key);
  }
}


