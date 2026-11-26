import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-appearance-'));

const { getCharacter } = await import('../server/character.js');
const settings = await import('../server/settings.js');
const outfit = await import('../server/outfit.js');
const imagegen = await import('../server/imagegen.js');
const outfitPhoto = await import('../server/outfit-photo.js');
const { db } = await import('../server/db.js');

const weather = {
  city: '测试城',
  temperature: 18,
  apparent: 18,
  code: 0,
  label: '多云',
  wind: 2,
  humidity: 50,
  isDay: true,
  updatedAt: Date.now(),
  source: 'fallback' as const
};

test('wardrobe items feed the daily outfit and can be rerolled', () => {
  const character = getCharacter();
  const first = outfit.createWardrobeItem({
    characterId: character.id,
    name: '米色针织衫',
    description: '米色针织衫配深色长裤，适合不冷的天气。',
    tags: ['日常', '秋天']
  });
  const second = outfit.createWardrobeItem({
    characterId: character.id,
    name: '深色风衣',
    description: '深色风衣，里面是白衬衫。',
    tags: ['外出']
  });
  assert.equal(outfit.getWardrobeItems(character.id).length, 2);

  const day = outfit.getDailyOutfit(character.id, '2030-01-02', weather);
  assert.equal(day.source, 'wardrobe');
  assert.ok(day.itemId);
  const rerolled = outfit.rerollDailyOutfit(character.id, '2030-01-02', weather);
  assert.equal(rerolled.source, 'manual');
  assert.notEqual(rerolled.itemId, day.itemId);
  assert.ok([first.id, second.id].includes(rerolled.itemId ?? ''));
});

test('an empty wardrobe falls back to a weather-appropriate outfit', () => {
  const character = getCharacter();
  for (const item of outfit.getWardrobeItems(character.id)) {
    outfit.deleteWardrobeItem(character.id, item.id);
  }
  const day = outfit.getDailyOutfit(character.id, '2030-02-03', weather);
  assert.equal(day.source, 'fallback');
  assert.ok(day.description.length > 4);
});

test('outfit photos are scoped to a single date', () => {
  const character = getCharacter();
  const image = {
    id: 'img-test-outfit',
    prompt: 'test',
    url: '/assets/generated/test.png',
    mime: 'image/png',
    width: 512,
    height: 512,
    source: 'morning-outfit',
    createdAt: Date.now()
  };
  db.prepare(
    `INSERT INTO generated_images
      (id, character_id, prompt, url, mime, width, height, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    image.id,
    character.id,
    image.prompt,
    image.url,
    image.mime,
    image.width,
    image.height,
    image.source,
    image.createdAt
  );
  outfitPhoto.setOutfitPhoto(character.id, '2030-03-04', image);
  assert.equal(outfitPhoto.getOutfitPhoto(character.id, '2030-03-04')?.url, image.url);
  assert.equal(outfitPhoto.getOutfitPhoto(character.id, '2030-03-05'), null);
});

test('image settings are private and an unconfigured generator refuses politely', () => {
  settings.saveSettings({
    image: {
      enabled: false,
      apiKey: 'image-secret',
      baseUrl: 'https://example.test/v1',
      model: 'image-test'
    }
  });
  assert.equal(imagegen.imageConfigured(), false);
  settings.saveSettings({ image: { enabled: true } });
  assert.equal(imagegen.imageConfigured(), true);
  const publicImage = settings.publicSettings().image;
  assert.equal(publicImage.hasApiKey, true);
  assert.equal(publicImage.useReferences, true);
  assert.equal(settings.getSettings().image.autoMorningPhoto, true);
  assert.equal('apiKey' in publicImage, false);
  assert.doesNotMatch(JSON.stringify(publicImage), /image-secret/);
});
