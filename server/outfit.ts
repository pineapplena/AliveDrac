import type { DailyOutfit, WardrobeItem, Weather } from '../shared/types.js';
import { db, newId } from './db.js';
import { nowMs, partsInZone } from './time.js';

type Row = Record<string, any>;

const ROTATION_DAYS = 14;

function mapItem(row: Row): WardrobeItem {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(String(row.tags ?? '[]'));
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    tags,
    imageUrl: String(row.image_url ?? ''),
    mime: String(row.mime ?? ''),
    createdAt: Number(row.created_at)
  };
}

function mapOutfit(row: Row): DailyOutfit {
  const source =
    row.source === 'manual' ? 'manual' : row.source === 'wardrobe' ? 'wardrobe' : 'fallback';
  return {
    date: String(row.date),
    itemId: row.item_id ? String(row.item_id) : null,
    description: String(row.description),
    source,
    createdAt: Number(row.created_at)
  };
}

export function getWardrobeItems(characterId: string): WardrobeItem[] {
  const rows = db
    .prepare('SELECT * FROM wardrobe_items WHERE character_id = ? ORDER BY created_at DESC')
    .all(characterId) as Row[];
  return rows.map(mapItem);
}

export function getWardrobeItem(characterId: string, id: string): WardrobeItem | null {
  const row = db
    .prepare('SELECT * FROM wardrobe_items WHERE character_id = ? AND id = ?')
    .get(characterId, id) as Row | undefined;
  return row ? mapItem(row) : null;
}

export function createWardrobeItem(input: {
  characterId: string;
  name: string;
  description?: string;
  tags?: string[];
  imageUrl?: string;
  mime?: string;
}): WardrobeItem {
  const id = newId('wrb');
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) throw new Error('给这套衣服起个名字');
  const description = String(input.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const tags = (input.tags ?? [])
    .map((tag) => String(tag).replace(/\s+/g, ' ').trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 12);
  const createdAt = nowMs();
  db.prepare(
    `INSERT INTO wardrobe_items
      (id, character_id, name, description, tags, image_url, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.characterId,
    name,
    description,
    JSON.stringify(tags),
    String(input.imageUrl ?? '').slice(0, 500),
    String(input.mime ?? '').slice(0, 80),
    createdAt
  );
  return getWardrobeItem(input.characterId, id)!;
}

export function deleteWardrobeItem(characterId: string, id: string): boolean {
  db.prepare('UPDATE daily_outfits SET item_id = NULL WHERE character_id = ? AND item_id = ?').run(
    characterId,
    id
  );
  return Boolean(
    db
      .prepare('DELETE FROM wardrobe_items WHERE character_id = ? AND id = ?')
      .run(characterId, id).changes
  );
}

function fallbackOutfit(weather: Weather, date: string, variant = 0): string {
  const p = partsInZone(Date.parse(`${date}T12:00:00Z`), 'UTC');
  const weekend = p.weekday === 0 || p.weekday === 6;
  const cold = weather.temperature < 10;
  const cool = weather.temperature >= 10 && weather.temperature < 18;
  const raining = [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(Number(weather.code));
  const pools: Record<string, string[]> = {
    weekendCold: [
      '宽松的米色卫衣和长裤，外面披一件厚外套。',
      '深色针织开衫配长裙，围巾松松地绕在颈侧。',
      '奶白色毛衣和阔腿裤，脚边放着一双短靴。'
    ],
    weekendCool: [
      '宽松的浅色针织衫和长裤，头发随手别在耳后。',
      '深色薄卫衣配牛仔裤，袖口挽到手肘。',
      '米色衬衫外面套一件软马甲，领口留着一颗扣子。'
    ],
    weekendWarm: [
      '浅色短袖和宽松长裤，头发用一根发绳松松束着。',
      '薄衬衫裙，腰间系着细带，适合在傍晚散步。',
      '白色短袖配浅色半裙，袖口干净利落。'
    ],
    workCold: [
      '总务官制服，外面加一件深色厚外套，围巾绕了两圈。',
      '深色制服外搭长款大衣，文件袋抱在臂弯里。',
      '制服外加绒里披肩，领口的徽章擦得很亮。'
    ],
    workCool: [
      '总务官制服，外搭一件深色短外套。',
      '总务官制服，外面套一件窄肩风衣，腰带收得整齐。',
      '深色制服配薄毛衣，袖口露出一小截白衬衫。'
    ],
    workWarm: [
      '总务官制服，袖口挽到小臂。',
      '薄款总务官制服，领口松开一颗扣子。',
      '浅色制服衬衫配深色下装，工牌端正地别在胸前。'
    ]
  };
  const key = weekend
    ? cold
      ? 'weekendCold'
      : cool
        ? 'weekendCool'
        : 'weekendWarm'
    : cold
      ? 'workCold'
      : cool
        ? 'workCool'
        : 'workWarm';
  const pool = pools[key];
  const base = stableHash(
    `${date}|${Math.round(weather.temperature)}|${raining ? 'rain' : 'dry'}|${variant}`
  );
  return pool[base % pool.length];
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function describeItem(item: WardrobeItem): string {
  const description = item.description.trim();
  if (!description) return item.name;
  if (description.includes(item.name)) return description;
  return `${item.name}：${description}`;
}

function chooseItem(
  characterId: string,
  date: string,
  weather: Weather,
  excludeId?: string | null
): WardrobeItem | null {
  const allItems = getWardrobeItems(characterId);
  if (!allItems.length) return null;
  const items = allItems.filter((item) => item.id !== excludeId);
  const available = items.length ? items : allItems;
  const since = new Date(Date.parse(`${date}T00:00:00Z`) - ROTATION_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recentRows = db
    .prepare(
      `SELECT item_id FROM daily_outfits
       WHERE character_id = ? AND date >= ? AND item_id IS NOT NULL`
    )
    .all(characterId, since) as Row[];
  const recent = new Set(recentRows.map((row) => String(row.item_id)));
  const fresh = available.filter((item) => !recent.has(item.id));
  const pool = fresh.length ? fresh : available;
  const index = stableHash(`${characterId}|${date}|${Math.round(weather.temperature / 3)}`) % pool.length;
  return pool[index] ?? pool[0] ?? null;
}

function saveDailyOutfit(characterId: string, outfit: Omit<DailyOutfit, 'createdAt'>): DailyOutfit {
  const createdAt = nowMs();
  db.prepare(
    `INSERT INTO daily_outfits (character_id, date, item_id, description, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_id, date) DO UPDATE SET
       item_id = excluded.item_id,
       description = excluded.description,
       source = excluded.source,
       created_at = excluded.created_at`
  ).run(
    characterId,
    outfit.date,
    outfit.itemId,
    outfit.description,
    outfit.source,
    createdAt
  );
  return { ...outfit, createdAt };
}

export function getDailyOutfit(
  characterId: string,
  date: string,
  weather: Weather
): DailyOutfit {
  const row = db
    .prepare('SELECT * FROM daily_outfits WHERE character_id = ? AND date = ?')
    .get(characterId, date) as Row | undefined;
  if (row) return mapOutfit(row);
  const item = chooseItem(characterId, date, weather);
  return saveDailyOutfit(characterId, {
    date,
    itemId: item?.id ?? null,
    description: item ? describeItem(item) : fallbackOutfit(weather, date),
    source: item ? 'wardrobe' : 'fallback'
  });
}

export function rerollDailyOutfit(
  characterId: string,
  date: string,
  weather: Weather
): DailyOutfit {
  const current = db
    .prepare('SELECT * FROM daily_outfits WHERE character_id = ? AND date = ?')
    .get(characterId, date) as Row | undefined;
  const currentItem = current?.item_id ? String(current.item_id) : null;
  const item = chooseItem(characterId, date, weather, currentItem);
  return saveDailyOutfit(characterId, {
    date,
    itemId: item?.id ?? null,
    description: item ? describeItem(item) : fallbackOutfit(weather, date, 1),
    source: item ? 'manual' : 'fallback'
  });
}

export function selectDailyOutfit(
  characterId: string,
  date: string,
  item: WardrobeItem
): DailyOutfit {
  return saveDailyOutfit(characterId, {
    date,
    itemId: item.id,
    description: describeItem(item),
    source: 'manual'
  });
}
