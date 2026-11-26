import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AppearanceView, GeneratedImage, WardrobeItem } from '../shared/types.js';
import { ASSETS_DIR } from './config.js';
import { getCharacter, getReferenceImages } from './character.js';
import { publish } from './events.js';
import { getState, saveState } from './life.js';
import {
  countGeneratedToday,
  deleteGeneratedImage,
  generateImage,
  getGeneratedImages,
  imageConfigured
} from './imagegen.js';
import {
  createWardrobeItem,
  deleteWardrobeItem,
  getDailyOutfit,
  getWardrobeItem,
  getWardrobeItems,
  rerollDailyOutfit,
  selectDailyOutfit
} from './outfit.js';
import { getSettings } from './settings.js';
import { dateKey, nowMs } from './time.js';
import { getWeather } from './weather.js';
import {
  buildOutfitPhotoPrompt,
  getOutfitPhoto,
  setOutfitPhoto
} from './outfit-photo.js';

const WARDROBE_DIR = resolve(ASSETS_DIR, 'wardrobe');

function saveWardrobeImage(dataUrl: string): { url: string; mime: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    String(dataUrl ?? '')
  );
  if (!match) throw new Error('衣柜图片只支持 PNG / JPG / WebP');
  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('衣柜图片是空的');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('衣柜图片不能超过 8MB');
  if (!existsSync(WARDROBE_DIR)) mkdirSync(WARDROBE_DIR, { recursive: true });
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const fileName = `outfit-${nowMs()}-${randomUUID().slice(0, 8)}.${ext}`;
  writeFileSync(resolve(WARDROBE_DIR, fileName), buffer);
  return { url: `/assets/wardrobe/${fileName}`, mime };
}

async function currentContext() {
  const character = getCharacter();
  const settings = getSettings();
  const date = dateKey(nowMs(), settings.user.timezone);
  const weather = await getWeather();
  const today = getDailyOutfit(character.id, date, weather);
  return { character, settings, date, weather, today };
}

function publishState(): void {
  publish('state', { state: getState() });
}

export async function getAppearanceView(): Promise<AppearanceView> {
  const { character, settings, date, today } = await currentContext();
  const generated = getGeneratedImages(character.id, 24);
  const used = countGeneratedToday(character.id);
  return {
    date,
    today,
    wardrobe: getWardrobeItems(character.id),
    images: generated,
    imageConfigured: imageConfigured(),
    remainingToday: Math.max(0, settings.image.maxPerDay - used),
    referenceCount: getReferenceImages().filter((reference) =>
      ['image/png', 'image/jpeg', 'image/webp'].includes(reference.mime)
    ).length,
    outfitPhoto: getOutfitPhoto(character.id, date)
  };
}

export async function addWardrobeItem(input: {
  name: string;
  description?: string;
  tags?: string[];
  imageDataUrl?: string;
}): Promise<WardrobeItem> {
  const character = getCharacter();
  const image = input.imageDataUrl ? saveWardrobeImage(input.imageDataUrl) : null;
  return createWardrobeItem({
    characterId: character.id,
    name: input.name,
    description: input.description,
    tags: input.tags,
    imageUrl: image?.url,
    mime: image?.mime
  });
}

export async function removeWardrobeItem(id: string): Promise<void> {
  const character = getCharacter();
  deleteWardrobeItem(character.id, id);
}

export async function rerollTodayOutfit(): Promise<AppearanceView> {
  const { character, date, weather } = await currentContext();
  const outfit = rerollDailyOutfit(character.id, date, weather);
  const state = getState(character.id);
  if (state.outfit !== '宽松的睡衣，袖口有点长。') {
    state.outfit = outfit.description;
    state.updatedAt = nowMs();
    saveState(state);
    publishState();
  }
  return getAppearanceView();
}

export async function chooseTodayOutfit(id: string): Promise<AppearanceView> {
  const character = getCharacter();
  const item = getWardrobeItem(character.id, id);
  if (!item) throw new Error('衣柜里找不到这套衣服');
  const { date } = await currentContext();
  const outfit = selectDailyOutfit(character.id, date, item);
  const state = getState(character.id);
  if (state.outfit !== '宽松的睡衣，袖口有点长。') {
    state.outfit = outfit.description;
    state.updatedAt = nowMs();
    saveState(state);
    publishState();
  }
  return getAppearanceView();
}

export async function generateAppearanceImage(input: {
  prompt?: string;
  source?: string;
}): Promise<GeneratedImage> {
  const { character, settings, date, today } = await currentContext();
  if (!imageConfigured()) throw new Error('先在设置 → 生图里填入图片 API');
  const used = countGeneratedToday(character.id);
  if (used >= settings.image.maxPerDay) {
    throw new Error(`今天的生图额度已经用完了（${settings.image.maxPerDay} 张）`);
  }
  const references = settings.image.useReferences
    ? getReferenceImages()
        .filter((reference) => ['image/png', 'image/jpeg', 'image/webp'].includes(reference.mime))
        .slice(0, 3)
        .map((reference) => ({ path: reference.path, mime: reference.mime }))
    : [];
  const image = await generateImage({
    characterId: character.id,
    prompt: buildOutfitPhotoPrompt({
      outfit: today.description,
      scene: String(input.prompt ?? ''),
      referenceCount: references.length
    }),
    source: input.source ?? 'outfit',
    references
  });
  setOutfitPhoto(character.id, date, image);
  return image;
}

export async function removeGeneratedImage(id: string): Promise<boolean> {
  return deleteGeneratedImage(getCharacter().id, id);
}
