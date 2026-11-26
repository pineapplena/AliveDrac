import type {
  Character,
  DiaryEntry,
  Dream,
  LifeEvent,
  LifeState,
  ScheduleBlock,
  Weather
} from '../shared/types.js';
import { db, getMeta, mapBlock, mapDiary, mapDream, mapEvent, mapState, newId, setMeta } from './db.js';
import { getCharacter } from './character.js';
import { complete, LLMError, parseJsonLoose } from './llm.js';
import { llmConfigured } from './settings.js';
import { publish } from './events.js';
import { SAFETY_PROMPT, scrubOutput } from './safety.js';
import { getSettings } from './settings.js';
import { fallbackSchedule } from './schedule-template.js';
import {
  normalizeBlocks,
  type NormalizedBlock,
  type ScheduleInput
} from './schedule-validation.js';
import {
  addDays,
  dateKey,
  dateLabel,
  dayPhase,
  formatClock,
  formatDateTime,
  minutesOfDay,
  minutesToHM,
  nowMs,
  partsInZone,
  weekdayName
} from './time.js';
import { getCachedWeather, getWeather, weatherLine } from './weather.js';
import { buildAbsenceSummary, createAbsence } from './absence.js';
import { createMemory } from './memory.js';
import { getRelationship } from './relationship.js';
import { zonedDateTimeToMs } from './time.js';
import { getDailyOutfit } from './outfit.js';
import { maybeSendMorningOutfitPhoto } from './outfit-photo.js';

type Row = Record<string, any>;

const fragmentInFlight = new Set<string>();

const CATEGORY_TEXT: Record<string, string> = {
  sleep: '休息',
  routine: '打理生活',
  meal: '吃饭',
  work: '工作',
  rest: '歇一会儿',
  leisure: '自己的时间',
  commute: '路上',
  study: '看书',
  exercise: '活动身体',
  other: '日常'
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function charId(): string {
  return getCharacter().id;
}

export function getState(id = charId()): LifeState {
  let row = db.prepare('SELECT * FROM life_state WHERE character_id = ?').get(id) as Row | undefined;
  if (!row) {
    const ts = nowMs();
    db.prepare(
      `INSERT INTO life_state
        (character_id, mood, energy, hunger, stress, health, social, sleep_debt,
         current_activity, current_location, outfit, last_tick, updated_at)
       VALUES (?, 0.1, 0.7, 0.3, 0.3, 0.9, 0.6, 0.1, '发呆', '房间', '', ?, ?)`
    ).run(id, ts, ts);
    row = db.prepare('SELECT * FROM life_state WHERE character_id = ?').get(id) as Row;
  }
  return mapState(row);
}

export function saveState(state: LifeState): void {
  db.prepare(
    `UPDATE life_state SET mood=?, energy=?, hunger=?, stress=?, health=?, social=?,
      sleep_debt=?, current_activity=?, current_location=?, outfit=?, last_tick=?, updated_at=?
     WHERE character_id=?`
  ).run(
    state.mood,
    state.energy,
    state.hunger,
    state.stress,
    state.health,
    state.social,
    state.sleepDebt,
    state.currentActivity,
    state.currentLocation,
    state.outfit,
    state.lastTick,
    state.updatedAt,
    state.characterId
  );
}

export function getBlocks(date: string, id = charId()): ScheduleBlock[] {
  const rows = db
    .prepare(
      'SELECT * FROM schedule_blocks WHERE character_id = ? AND date = ? ORDER BY start_min ASC'
    )
    .all(id, date) as Row[];
  return rows.map(mapBlock);
}

export function findBlock(blocks: ScheduleBlock[], minutes: number): ScheduleBlock | null {
  return blocks.find((block) => minutes >= block.startMin && minutes < block.endMin) ?? null;
}

export function findNextBlock(blocks: ScheduleBlock[], minutes: number): ScheduleBlock | null {
  return blocks.find((block) => block.startMin > minutes) ?? null;
}

export function insertBlocks(date: string, blocks: NormalizedBlock[], source: string): void {
  const id = charId();
  db.prepare('DELETE FROM schedule_blocks WHERE character_id = ? AND date = ?').run(id, date);
  const ts = nowMs();
  for (const block of blocks) {
    db.prepare(
      `INSERT INTO schedule_blocks
        (id, character_id, date, start_min, end_min, activity, location, category, detail, shareable, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId('blk'),
      id,
      date,
      block.startMin,
      block.endMin,
      block.activity,
      block.location,
      block.category,
      block.detail,
      block.shareable ? 1 : 0,
      source,
      ts
    );
  }
}

function fallbackBlocks(date: string, salt?: string | number): NormalizedBlock[] {
  const wd = partsInZone(Date.parse(`${date}T12:00:00Z`), 'UTC').weekday;
  return fallbackSchedule(wd, {
    date,
    salt,
    weather: getCachedWeather()
  }).map((block) => ({
    startMin: block.startMin,
    endMin: block.endMin,
    activity: block.activity,
    location: block.location,
    category: block.category,
    detail: block.detail,
    shareable: block.shareable
  }));
}

export function ensureSchedule(date: string): ScheduleBlock[] {
  const existing = getBlocks(date);
  if (existing.length > 0) return existing;
  const settings = getSettings();
  if (!settings.life.autoSchedule) {
    const previous = db
      .prepare(
        `SELECT date FROM schedule_blocks WHERE character_id = ? AND date < ?
         ORDER BY date DESC LIMIT 1`
      )
      .get(charId(), date) as Row | undefined;
    if (previous) {
      const blocks = getBlocks(String(previous.date)).map((block) => ({
        startMin: block.startMin,
        endMin: block.endMin,
        activity: block.activity,
        location: block.location,
        category: block.category,
        detail: block.detail,
        shareable: block.shareable
      }));
      insertBlocks(date, blocks, 'carry');
      publish('schedule', { date });
      return getBlocks(date);
    }
  }
  insertBlocks(date, fallbackBlocks(date), 'fallback');
  publish('schedule', { date });
  return getBlocks(date);
}

export async function generateSchedule(date: string): Promise<{ blocks: ScheduleBlock[]; source: string }> {
  const character = getCharacter();
  const settings = getSettings();
  const weather = await getWeather();
  const p = partsInZone(Date.parse(`${date}T12:00:00Z`), 'UTC');
  if (!llmConfigured()) {
    insertBlocks(date, fallbackBlocks(date, `manual-${Date.now()}`), 'fallback');
    publish('schedule', { date });
    return { blocks: getBlocks(date), source: 'fallback' };
  }
  try {
    const result = await complete({
      task: 'schedule',
      system: `你在为角色「${character.name}」安排真实的一天。只输出 JSON，不要解释。
角色：${character.description}
性格：${character.personality}
场景：${character.scenario}
${SAFETY_PROMPT}`,
      messages: [
        {
          role: 'user',
          content: `日期：${date} ${weekdayName(p.weekday)}。城市：${settings.life.city}，天气：${weatherLine(weather)}。
请生成 10-16 个时间块，覆盖 00:00-24:00，不能重叠。要像一个真实的人：睡觉、吃饭、工作、通勤、休息、自己的小爱好，细节具体，有生活气。
每天的时间、活动和细节尽量不同，但保留睡眠、三餐、通勤和工作的合理锚点，不要完全随机。
角色是罗斯凯利法算理中枢局的总务官，工作日有文件与数据工作，周末更松弛。不要写血腥。
JSON 格式：
{"blocks":[{"start":420,"end":470,"activity":"吃早饭","location":"中枢局食堂","category":"meal","detail":"一碗热粥，一枚煎蛋。","shareable":true}]}
category 只能是 sleep/routine/meal/work/rest/leisure/commute/study/exercise/other。`
        }
      ],
      json: true,
      temperature: 0.8,
      maxTokens: 1400,
      mockPayload: { weekday: p.weekday }
    });
    const parsed = JSON.parse(result.text) as ScheduleInput;
    const blocks = normalizeBlocks(parsed);
    if (blocks.length >= 4) {
      insertBlocks(date, blocks, 'llm');
      setMeta(`schedule_${date}`, 'llm');
      publish('schedule', { date });
      return { blocks: getBlocks(date), source: 'llm' };
    }
  } catch (error) {
    if (!(error instanceof LLMError)) {
      console.warn('[life] schedule generation failed:', error);
    }
  }
  insertBlocks(date, fallbackBlocks(date, `manual-${Date.now()}`), 'fallback');
  publish('schedule', { date });
  return { blocks: getBlocks(date), source: 'fallback' };
}

export function getEvents(limit = 30, id = charId()): LifeEvent[] {
  const rows = db
    .prepare('SELECT * FROM life_events WHERE character_id = ? ORDER BY at DESC LIMIT ?')
    .all(id, limit) as Row[];
  return rows.map(mapEvent);
}

export function addEvent(input: {
  type: string;
  title: string;
  detail?: string;
  importance?: number;
  shareable?: boolean;
  at?: number;
  meta?: Record<string, unknown>;
}): LifeEvent {
  const id = newId('evt');
  const at = input.at ?? nowMs();
  db.prepare(
    `INSERT INTO life_events (id, character_id, at, type, title, detail, importance, shareable, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    charId(),
    at,
    input.type,
    input.title.slice(0, 120),
    (input.detail ?? '').slice(0, 500),
    clamp(input.importance ?? 0.5),
    input.shareable ? 1 : 0,
    JSON.stringify(input.meta ?? {})
  );
  publish('life_event', { id, title: input.title });
  return { id, at, type: input.type, title: input.title, detail: input.detail ?? '', importance: input.importance ?? 0.5, shareable: Boolean(input.shareable), meta: input.meta ?? {} };
}

function updateBlockDetail(blockId: string, detail: string): void {
  db.prepare('UPDATE schedule_blocks SET detail = ? WHERE id = ?').run(
    detail.slice(0, 500),
    blockId
  );
}

export interface LifeFragment {
  title: string;
  detail: string;
  kind: 'daily' | 'hiccup';
  importance: number;
  shareable: boolean;
  source: 'llm' | 'fallback';
}

const FRAGMENT_FOODS = [
  '番茄炖菜',
  '热汤面',
  '烤鱼套餐',
  '饭团',
  '小锅馄饨',
  '咖喱饭',
  '三明治'
];
const FRAGMENT_BREAKFAST = [
  '热豆浆和包子',
  '煎蛋三明治',
  '一碗热粥',
  '饭团',
  '小摊的煎饼'
];
const FRAGMENT_TASKS = [
  '改到第三版',
  '把数据对上了',
  '会议拖了十分钟',
  '临时被叫去签字',
  '把旧档案翻了一遍'
];
const WORK_HICCUPS = [
  '同事临时来问旧档案',
  '咖啡洒在文件角上',
  '临时被叫去签字',
  '打印机卡纸了'
];

function pickFragment<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function fallbackLifeFragment(
  block: ScheduleBlock,
  state: LifeState,
  weather: Weather
): LifeFragment {
  const place = block.location || '宿舍';
  const food = block.activity.includes('早')
    ? pickFragment(FRAGMENT_BREAKFAST)
    : pickFragment(FRAGMENT_FOODS);
  const task = pickFragment(FRAGMENT_TASKS);
  const hiccup = Math.random() < 0.24;

  if (block.category === 'meal') {
    if (/食堂/.test(place)) {
      return hiccup
        ? {
            title: `最后一份${food}`,
            detail: `食堂窗口前排了很长的队，轮到我时${food}刚好吃完，我换了另一道，端着盘子站了一会儿才找到位置。`,
            kind: 'hiccup',
            importance: 0.55,
            shareable: true,
            source: 'fallback'
          }
        : {
            title: `${food}和排队`,
            detail: `食堂窗口前排了几个人，我最后要了${food}，找了个靠窗的位置慢慢吃完。`,
            kind: 'daily',
            importance: 0.4,
            shareable: true,
            source: 'fallback'
          };
    }
    if (/楼下|早餐摊|小店/.test(place)) {
      return hiccup
        ? {
            title: '早餐摊收得早',
            detail: `我走到楼下时早餐摊已经在收东西了，最后只买到一杯热的，捧着走了一段路。`,
            kind: 'hiccup',
            importance: 0.48,
            shareable: true,
            source: 'fallback'
          }
        : {
            title: `${food}和早上的风`,
            detail: `楼下早餐摊还冒着热气，我买了${food}，站在路边吃完才往回走。`,
            kind: 'daily',
            importance: 0.38,
            shareable: true,
            source: 'fallback'
          };
    }
    if (/宿舍|小厨房/.test(place)) {
      return hiccup
        ? {
            title: '外卖晚了十分钟',
            detail: `我点了${food}，外卖比预计晚了十分钟，送到时汤还有点烫，我把盖子掀开晾了一会儿。`,
            kind: 'hiccup',
            importance: 0.52,
            shareable: true,
            source: 'fallback'
          }
        : {
            title: `自己煮了${food}`,
            detail: `水开之后把${food}下锅，等的时候我靠在灶台边看了会儿窗外，锅里咕嘟得很轻。`,
            kind: 'daily',
            importance: 0.4,
            shareable: true,
            source: 'fallback'
          };
    }
    return {
      title: `${food}的小馆`,
      detail: `旧城区的小馆人不多，我点了${food}，吃完又坐了一会儿才起身，外面正好${weather.label || '阴着'}。`,
      kind: 'daily',
      importance: 0.4,
      shareable: true,
      source: 'fallback'
    };
  }

  if (block.category === 'work') {
    return {
      title: task,
      detail: hiccup
        ? `本来在${block.activity}，中途${pickFragment(WORK_HICCUPS)}，我只好把刚理好的顺序又翻了一遍。`
        : `我在${block.activity}，做到一半停下来，把旁边的批注重新看了一遍。`,
      kind: hiccup ? 'hiccup' : 'daily',
      importance: hiccup ? 0.55 : 0.4,
      shareable: true,
      source: 'fallback'
    };
  }

  if (block.category === 'commute') {
    const rainy = /雨/.test(weather.label || '');
    const byTrain = /悬浮|列车|车站/.test(place) || /列车/.test(block.activity);
    return {
      title: rainy ? '雨里的通勤' : byTrain ? '列车晚了两分钟' : '路上慢了半拍',
      detail: rainy
        ? byTrain
          ? `雨比预报早到，我站在悬浮列车的门边，把伞收得很慢，袖口还是湿了一点。`
          : `雨比预报早到，我撑着伞走了半段路，鞋尖溅上一点水，到的时候裤脚有些潮。`
        : byTrain
          ? `悬浮列车晚了两分钟，我靠在门边看站台上的灯，一站一站往后退。`
          : `我走到一半又折回去拿了忘带的东西，耽误了几分钟，到的时候还有点喘。`,
      kind: 'daily',
      importance: 0.35,
      shareable: true,
      source: 'fallback'
    };
  }

  if (block.category === 'rest') {
    return {
      title: '窗边的十分钟',
      detail:
        state.energy < 0.3
          ? `我没有睡，靠在窗边闭了会儿眼，手里的杯子慢慢凉了，肩膀也塌下来一点。`
          : `我没有睡，靠在窗边看楼下的车，手里的杯子慢慢凉了，脑子里什么也没想。`,
      kind: 'daily',
      importance: 0.35,
      shareable: true,
      source: 'fallback'
    };
  }

  if (block.category === 'leisure') {
    const assembling = /拼|模型/.test(block.activity);
    return {
      title: hiccup
        ? assembling
          ? '拼到一半卡住了'
          : '被打断的一小段'
        : '一小段自己的时间',
      detail: hiccup
        ? assembling
          ? `${block.activity}到一半，零件怎么也按不进去，我停下来翻说明书，眉头皱了一会儿。`
          : `我刚${block.activity}没多久，就被一件小事打断，回来时已经接不上刚才的感觉。`
        : `我在${block.activity}，没有特意做什么，只是把这段时间留给了自己。`,
      kind: hiccup ? 'hiccup' : 'daily',
      importance: 0.38,
      shareable: true,
      source: 'fallback'
    };
  }

  if (block.category === 'routine') {
    if (/洗|泡澡|洗漱/.test(block.activity)) {
      return {
        title: '镜子上的雾',
        detail: `热水冲了很久，镜子蒙上一层雾，我伸手抹开一小块，看见自己有点困的眼睛。`,
        kind: 'daily',
        importance: 0.3,
        shareable: false,
        source: 'fallback'
      };
    }
    if (/收拾|整理|晾|洗衣/.test(block.activity)) {
      return {
        title: '把台面擦干净',
        detail: `我把台面上的水渍擦掉，又把散着的东西归回原位，做完之后站着看了一小会儿。`,
        kind: 'daily',
        importance: 0.3,
        shareable: false,
        source: 'fallback'
      };
    }
    return {
      title: '手上的小事',
      detail: `我把手边的小事一件件做完，没有急着去下一件事，水声和窗外的动静都很轻。`,
      kind: 'daily',
      importance: 0.3,
      shareable: false,
      source: 'fallback'
    };
  }

  if (block.category === 'exercise') {
    return {
      title: '绕楼走了一圈',
      detail: `我没走远，只绕着楼慢慢走了一圈，风把额前的头发吹乱了几次。`,
      kind: 'daily',
      importance: 0.35,
      shareable: true,
      source: 'fallback'
    };
  }

  if (block.category === 'study') {
    return {
      title: '笔记写到最后一行',
      detail: `我把笔记写到最后一行，停了一会儿，又把前面的一个词划掉重写。`,
      kind: 'daily',
      importance: 0.38,
      shareable: true,
      source: 'fallback'
    };
  }

  if (block.category === 'sleep') {
    return {
      title: '关灯之后',
      detail: `灯关掉之后，房间里只剩下很轻的呼吸声，我把被角往上拉了拉。`,
      kind: 'daily',
      importance: 0.25,
      shareable: false,
      source: 'fallback'
    };
  }

  return {
    title: '一小段空白',
    detail: `我在${block.activity}，停下来安安静静地待了一会儿，没有急着去下一件事。`,
    kind: 'daily',
    importance: 0.3,
    shareable: Boolean(block.shareable),
    source: 'fallback'
  };
}

export async function generateLifeFragment(input: {
  block: ScheduleBlock;
  state: LifeState;
  weather: Weather;
  date: string;
}): Promise<LifeFragment> {
  const fallback = fallbackLifeFragment(input.block, input.state, input.weather);
  if (!llmConfigured()) return fallback;

  try {
    const character = getCharacter();
    const settings = getSettings();
    const p = partsInZone(nowMs(), settings.user.timezone);
    const recent = getEvents(6)
      .map((event) => `- ${event.title}${event.detail ? `：${event.detail}` : ''}`)
      .join('\n');
    const result = await complete({
      task: 'life-fragment',
      system: `你在以「${character.name}」的第一人称，记录她生活中刚发生的一小段切片，不是在复述日程。保持她的性格和说话方式，写具体的生活，不写总结或报告。不写性内容、事故、疾病、暴力或违法的事。
【你是谁】
${character.description.slice(0, 1200)}
【她的性格】
${character.personality.slice(0, 800)}
【她的说话方式】
${character.systemPrompt.slice(0, 900)}
${SAFETY_PROMPT}`,
      messages: [
        {
          role: 'user',
          content: `日期：${input.date} ${weekdayName(p.weekday)} ${minutesToHM(input.block.startMin)}
天气：${weatherLine(input.weather)}
她此刻的状态：心情 ${input.state.mood.toFixed(2)}，精力 ${input.state.energy.toFixed(2)}，压力 ${input.state.stress.toFixed(2)}，饥饿 ${input.state.hunger.toFixed(2)}，社交 ${input.state.social.toFixed(2)}
当前日程块：${input.block.activity}；地点：${input.block.location || '不固定'}；类别：${input.block.category}
日程备注（只是背景，不要照抄）：${input.block.detail || '（没有备注）'}

最近的碎片：
${recent || '（还没有）'}

写一条 30-90 字的生活切片。要求：
- 不要写“开始/正在/按照日程/此刻”；不要复述日程名。
- 必须有一个具体到能看见的选择或动作：吃饭要写食堂/外卖/自己做/哪家店、点了什么、排队或送餐情况；工作要写具体的文件、数据或谁来找她；路上要写天气、交通工具或遇到什么。
- 大部分是普通小事；大约四分之一可以有一个很小的意外或麻烦（外卖送错、售货机卡住、临时被叫走、下雨、文件顺序错了），不要大事、事故、疾病、暴力、违法或性内容。
- 不要和最近碎片重复；不要每天都吃一样的东西。
- 细节必须和当前地点、时间、类别一致：地点在食堂就写食堂，地点在宿舍就不要写还在办公室；不要凭空换地点。
- 第一人称，用“我”来写；不要用“她”指代自己，也不要写成旁观者在记录她。标题也尽量用第一人称视角，不要用“她”开头。克制，有生活气；不总结、不说教、不写 AI 或提示词。
- 标题 6-14 个汉字，具体；detail 30-90 个汉字。
只输出 JSON：{"title":"...","detail":"...","kind":"daily|hiccup","importance":0.35,"shareable":true}`
        }
      ],
      json: true,
      temperature: 0.95,
      maxTokens: 300,
      signal: AbortSignal.timeout(15_000),
      mockPayload: {
        activity: input.block.activity,
        category: input.block.category,
        location: input.block.location
      }
    });
    const parsed = parseJsonLoose<{
      title?: string;
      detail?: string;
      kind?: string;
      importance?: number;
      shareable?: boolean;
    }>(result.text);
    const title = String(parsed.title ?? '').trim().slice(0, 40);
    const detail = String(parsed.detail ?? '').trim().slice(0, 300);
    if (
      !title ||
      !detail ||
      title.length < 2 ||
      detail.length < 12 ||
      !detail.includes('我') ||
      title.startsWith('她') ||
      detail === input.block.detail.trim() ||
      /^(开始|正在|此刻[:：])/.test(title) ||
      /按照日程|日程安排/.test(detail)
    ) {
      return fallback;
    }
    const rawImportance = Number(parsed.importance);
    const importance = Number.isFinite(rawImportance)
      ? clamp(rawImportance, 0.25, 0.7)
      : 0.4;
    return {
      title,
      detail,
      kind: parsed.kind === 'hiccup' ? 'hiccup' : 'daily',
      importance,
      shareable: parsed.shareable !== false,
      source: 'llm'
    };
  } catch {
    return fallback;
  }
}

export async function generateCurrentFragment(): Promise<LifeEvent | null> {
  const settings = getSettings();
  const tz = settings.user.timezone;
  const date = dateKey(nowMs(), tz);
  ensureSchedule(date);
  const blocks = getBlocks(date);
  const minutes = minutesOfDay(nowMs(), tz);
  const block = findBlock(blocks, minutes);
  if (!block) return null;
  const weather = await getWeather();
  const state = getState();
  const fragment = await generateLifeFragment({ block, state, weather, date });
  const event = addEvent({
    at: nowMs(),
    type: 'fragment',
    title: fragment.title,
    detail: fragment.detail,
    importance: fragment.importance,
    shareable: fragment.shareable,
    meta: {
      blockId: block.id,
      category: block.category,
      source: fragment.source,
      kind: fragment.kind,
      manual: true
    }
  });
  updateBlockDetail(block.id, fragment.detail);
  publish('schedule', { date });
  return event;
}

function updateOutfitIfNeeded(state: LifeState, weather: Weather, date: string): string {
  return getDailyOutfit(state.characterId, date, weather).description;
}

function wakeMinute(blocks: ScheduleBlock[]): number {
  const night =
    blocks.find(
      (block) =>
        block.category === 'sleep' && block.endMin > 4 * 60 && block.endMin <= 12 * 60
    ) ?? blocks.find((block) => block.category === 'sleep');
  return night?.endMin ?? 8 * 60;
}

function applyMorningEffects(state: LifeState, debtBeforeSleep: number): void {
  const debt = clamp(debtBeforeSleep);
  if (debt < 0.22) return;
  state.energy = clamp(state.energy - debt * 0.22);
  state.mood = clamp(state.mood - debt * 0.08, -1, 1);
  state.stress = clamp(state.stress + debt * 0.04);
}

function sleepDebtNote(debt: number): string | null {
  if (debt < 0.45) return null;
  if (debt < 0.7) return '昨晚睡得不太够，今天有点提不起劲。';
  return '昨晚几乎没睡好，脑子像蒙了一层雾。';
}

const MORNING_DEBT_KEY = 'pending_morning_debt';

function applyPendingMorningEffect(state: LifeState, block: ScheduleBlock | null): void {
  if (block?.category === 'sleep') return;
  const raw = getMeta(MORNING_DEBT_KEY);
  if (!raw) return;
  const debt = Number(raw);
  setMeta(MORNING_DEBT_KEY, '');
  if (!Number.isFinite(debt)) return;
  applyMorningEffects(state, debt);
  const note = sleepDebtNote(debt);
  if (note) {
    addEvent({
      type: 'state',
      title: '没太睡够',
      detail: note,
      importance: 0.45,
      shareable: true
    });
  }
}

function applyDelta(state: LifeState, block: ScheduleBlock | null, dtHours: number): void {
  const dt = Math.max(0.0001, Math.min(6, dtHours));
  const category = block?.category ?? 'other';
  const sleeping = category === 'sleep';
  const working = category === 'work' || category === 'study';

  state.energy += (sleeping ? 0.13 : working ? -0.055 : category === 'rest' ? 0.02 : -0.018) * dt;
  state.hunger += (category === 'meal' ? -0.75 : sleeping ? 0.025 : 0.055) * dt;
  state.stress += (working ? 0.045 : category === 'rest' || category === 'leisure' ? -0.07 : sleeping ? -0.055 : 0) * dt;
  state.sleepDebt += (sleeping ? -0.09 : 0.018) * dt;
  state.social += (category === 'work' || category === 'meal' ? 0.02 : -0.012) * dt;

  let moodTarget = 0.12;
  if (category === 'leisure') moodTarget += 0.12;
  if (category === 'meal') moodTarget += 0.05;
  if (working) moodTarget -= 0.04;
  if (sleeping) moodTarget += 0.04;
  if (state.hunger > 0.8) moodTarget -= 0.18;
  if (state.energy < 0.2) moodTarget -= 0.12;
  state.mood += (moodTarget - state.mood) * Math.min(0.35, dt * 0.18);

  if (state.hunger > 0.92 || state.sleepDebt > 0.8) {
    state.health -= 0.006 * dt;
  } else {
    state.health += 0.004 * dt;
  }

  state.energy = clamp(state.energy);
  state.hunger = clamp(state.hunger);
  state.stress = clamp(state.stress);
  state.sleepDebt = clamp(state.sleepDebt);
  state.social = clamp(state.social);
  state.health = clamp(state.health, 0.2, 1);
  state.mood = clamp(state.mood, -1, 1);
}

async function catchUpLife(
  state: LifeState,
  from: number,
  to: number,
  weather: Weather,
  settings: ReturnType<typeof getSettings>
): Promise<LifeState> {
  const character = getCharacter();
  const tz = settings.user.timezone;
  const simStart = Math.max(from, to - 14 * 86_400_000);
  const fromDate = dateKey(simStart, tz);
  const toDate = dateKey(to, tz);
  const debtBeforeSleep = state.sleepDebt;
  const created: LifeEvent[] = [];

  const addOfflineEvent = (at: number, block: ScheduleBlock, title?: string) => {
    if (created.length >= 32) return;
    const fragment = fallbackLifeFragment(block, state, weather);
    created.push(
      addEvent({
        at,
        type: 'offline',
        title: title ?? fragment.title,
        detail: fragment.detail,
        importance: fragment.importance,
        shareable: fragment.shareable,
        meta: {
          blockId: block.id,
          category: block.category,
          offline: true,
          source: 'fallback',
          kind: fragment.kind
        }
      })
    );
    updateBlockDetail(block.id, fragment.detail);
  };

  const fromBlocks = ensureSchedule(fromDate);
  const initialBlock = findBlock(fromBlocks, minutesOfDay(simStart, tz));
  if (initialBlock) {
    addOfflineEvent(simStart, initialBlock, `你离开时我正在${initialBlock.activity}`);
  }

  let date = fromDate;
  let dayGuard = 0;
  while (date <= toDate && dayGuard < 15) {
    ensureSchedule(date);
    for (const block of getBlocks(date)) {
      const start = zonedDateTimeToMs(date, block.startMin, tz);
      const end = zonedDateTimeToMs(date, block.endMin, tz);
      const overlapStart = Math.max(start, simStart);
      const overlapEnd = Math.min(end, to);
      if (overlapEnd <= overlapStart) continue;
      applyDelta(state, block, (overlapEnd - overlapStart) / 3_600_000);
      if (start >= simStart && start <= to && start !== simStart) {
        addOfflineEvent(start, block, `开始${block.activity}`);
      }
    }
    if (date === toDate) break;
    date = addDays(date, 1);
    dayGuard++;
  }

  const currentBlocks = getBlocks(toDate);
  const current = findBlock(currentBlocks, minutesOfDay(to, tz));
  const next = findNextBlock(currentBlocks, minutesOfDay(to, tz));
  if (current) {
    state.currentActivity = current.activity;
    state.currentLocation = current.location || state.currentLocation;
  } else {
    state.currentActivity = '发呆';
  }
  if (fromDate !== toDate) {
    setMeta(MORNING_DEBT_KEY, String(debtBeforeSleep));
    applyPendingMorningEffect(state, current);
  }
  state.outfit = updateOutfitIfNeeded(state, weather, toDate);
  if (current?.category === 'sleep') state.outfit = '宽松的睡衣，袖口有点长。';
  state.lastTick = to;
  state.updatedAt = to;
  saveState(state);

  const wake = wakeMinute(currentBlocks);
  const toMinutes = minutesOfDay(to, tz);
  if (current && current.category !== 'sleep' && toMinutes >= wake && toMinutes <= wake + 4 * 60) {
    void maybeSendMorningOutfitPhoto({
      date: toDate,
      outfit: state.outfit,
      wakeMin: wake
    });
  }

  setMeta(`last_block_${character.id}`, current?.id ?? '');
  setMeta(`last_day_${character.id}`, toDate);

  if (fromDate !== toDate) {
    addEvent({
      at: zonedDateTimeToMs(toDate, 0, tz),
      type: 'day',
      title: '新的一天',
      detail: `从${fromDate}走到了${toDate}。你在不在，日子都在往前走。`,
      importance: 0.3,
      shareable: false
    });
  }

  let diaryDate = fromDate;
  let diaryGuard = 0;
  while (diaryDate < toDate && diaryGuard < 8) {
    if (!getDiary(diaryDate)) {
      await generateDiary(diaryDate, false, false);
    }
    diaryDate = addDays(diaryDate, 1);
    diaryGuard++;
  }

  const gap = to - from;
  if (gap >= 90 * 60_000) {
    const summary = buildAbsenceSummary(from, to, created);
    const absence = createAbsence(from, to, summary, created);
    createMemory({
      kind: 'self',
      title: '你不在的时候',
      content: summary,
      importance: 0.5,
      confidence: 0.85,
      valence: 0.05,
      source: 'offline',
      happenedAt: to,
      tags: ['离线', '自我', '你不在的时候'],
      meta: {
        absenceId: absence.id,
        startAt: from,
        endAt: to,
        eventCount: created.length
      }
    });
  }

  publish('state', { state, block: current, next, weather, date: toDate });
  return state;
}

export async function tickLife(force = false): Promise<LifeState> {
  const character = getCharacter();
  const settings = getSettings();
  const state = getState(character.id);
  const now = nowMs();
  const tz = settings.user.timezone;
  const today = dateKey(now, tz);
  const weather = await getWeather();

  if (!force && now - state.lastTick > 20 * 60_000) {
    return catchUpLife(state, state.lastTick, now, weather, settings);
  }

  ensureSchedule(today);
  const blocks = getBlocks(today);
  const minutes = minutesOfDay(now, tz);
  const block = findBlock(blocks, minutes);
  const next = findNextBlock(blocks, minutes);

  const dt = force ? 0.25 : (now - state.lastTick) / 3_600_000;
  const debtBeforeSleep = state.sleepDebt;
  applyDelta(state, block, dt);

  const lastDayKey = `last_day_${character.id}`;
  const lastDay = getMeta(lastDayKey);
  if (lastDay && lastDay !== today) {
    setMeta(MORNING_DEBT_KEY, String(debtBeforeSleep));
  }
  applyPendingMorningEffect(state, block);

  if (block) {
    state.currentActivity = block.activity;
    state.currentLocation = block.location || state.currentLocation;
  } else {
    state.currentActivity = minutes < 360 ? '睡着' : '发呆';
  }
  state.outfit = updateOutfitIfNeeded(state, weather, today);
  if (block?.category === 'sleep') {
    state.outfit = '宽松的睡衣，袖口有点长。';
  }
  state.lastTick = now;
  state.updatedAt = now;
  saveState(state);

  const wake = wakeMinute(blocks);
  if (block && block.category !== 'sleep' && minutes >= wake && minutes <= wake + 4 * 60) {
    void maybeSendMorningOutfitPhoto({
      date: today,
      outfit: state.outfit,
      wakeMin: wake
    });
  }

  const lastBlockKey = `last_block_${character.id}`;
  const lastBlockId = getMeta(lastBlockKey);
  if (block && block.id !== lastBlockId) {
    setMeta(lastBlockKey, block.id);
    if (settings.life.proactiveMicroEvents && !fragmentInFlight.has(block.id)) {
      fragmentInFlight.add(block.id);
      const at = zonedDateTimeToMs(today, block.startMin, tz);
      const snapshot = { ...state };
      void generateLifeFragment({
        block,
        state: snapshot,
        weather,
        date: today
      })
        .then((fragment) => {
          addEvent({
            at,
            type: 'fragment',
            title: fragment.title,
            detail: fragment.detail,
            importance: fragment.importance,
            shareable: fragment.shareable,
            meta: {
              blockId: block.id,
              category: block.category,
              source: fragment.source,
              kind: fragment.kind
            }
          });
          updateBlockDetail(block.id, fragment.detail);
          publish('schedule', { date: today });
        })
        .catch((error) => {
          console.warn(
            '[life-fragment]',
            error instanceof Error ? error.message : String(error)
          );
        })
        .finally(() => fragmentInFlight.delete(block.id));
    }
  }

  if (lastDay !== today) {
    setMeta(lastDayKey, today);
    if (lastDay) {
      addEvent({
        type: 'day',
        title: '新的一天',
        detail: `从${lastDay}走到了${today}。`,
        importance: 0.3,
        shareable: false
      });
    }
  }

  publish('state', { state, block, next, weather, date: today });
  return state;
}

export function getDayView(date: string): {
  date: string;
  blocks: ScheduleBlock[];
  state: LifeState;
  weather: Weather | null;
  events: LifeEvent[];
  diary: DiaryEntry | null;
  dreams: Dream[];
} {
  const settings = getSettings();
  const blocks = getBlocks(date);
  const state = getState();
  const events = getEvents(40).filter(
    (event) => dateKey(event.at, settings.user.timezone) === date
  );
  return {
    date,
    blocks,
    state,
    weather: null,
    events,
    diary: getDiary(date),
    dreams: getDreams(6)
  };
}

export function getDiary(date: string): DiaryEntry | null {
  const row = db
    .prepare('SELECT * FROM diary_entries WHERE character_id = ? AND date = ?')
    .get(charId(), date) as Row | undefined;
  return row ? mapDiary(row) : null;
}

export function getDreams(limit = 10): Dream[] {
  const rows = db
    .prepare('SELECT * FROM dreams WHERE character_id = ? ORDER BY at DESC LIMIT ?')
    .all(charId(), limit) as Row[];
  return rows.map(mapDream);
}

export async function generateDiary(
  date: string,
  force = false,
  useLLM = true
): Promise<DiaryEntry> {
  const existing = getDiary(date);
  if (existing && !force) return existing;
  const character = getCharacter();
  const settings = getSettings();
  const relationship = getRelationship();
  const weather = await getWeather();
  const since = nowMs() - 3 * 86_400_000;
  const events = getEvents(80).filter(
    (event) => dateKey(event.at, settings.user.timezone) === date
  );
  const messages = db
    .prepare(
      `SELECT * FROM messages
       WHERE conversation_id = 'conv-main' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 80`
    )
    .all(since) as Row[];
  const todayMessages = messages
    .filter((m) => {
      if (dateKey(Number(m.created_at), settings.user.timezone) !== date) return false;
      try {
        const meta = JSON.parse(String(m.meta ?? '{}'));
        if (meta?.safety) return false;
      } catch {
        // ignore malformed metadata
      }
      return true;
    })
    .reverse();

  const eventText = events
    .slice(0, 12)
    .map((event) => `- ${formatClock(event.at, settings.user.timezone)} ${event.title}${event.detail ? `：${event.detail}` : ''}`)
    .join('\n');
  const chatText = todayMessages
    .slice(-20)
    .map((m) => `${m.role === 'user' ? settings.user.name : character.name}：${String(m.content).slice(0, 180)}`)
    .join('\n');

  let content = '';
  if (useLLM) {
    try {
      const result = await complete({
        task: 'diary',
        system: `你在写「${character.name}」的私人日记。用第一人称，具体、克制、有生活细节，不要总结成报告，不要提到 AI、提示词或系统。日记不写露骨性内容；可以写亲近、想念、被对方牵动的心情。${SAFETY_PROMPT}`,
        messages: [
          {
            role: 'user',
            content: `日期：${date}。天气：${weatherLine(weather)}。地点：${settings.life.city}。
你和对方目前的关系：${relationship.stage}（好感 ${Math.round(relationship.affinity)}/100，信任 ${Math.round(relationship.trust)}/100）。
${
  relationship.affinity >= 80
    ? '你们已经很亲近，日记里可以自然写一点被对方牵动的柔软和想念，但不要写露骨性内容。'
    : relationship.affinity >= 60
      ? '你们彼此信任，日记里会自然提到对方，但仍保留自己的空间。'
      : relationship.affinity >= 40
        ? '你们还在熟悉，日记里对对方的笔墨不多，更多是观察。'
        : '你们还有距离，日记里不会过多写对方。'
}
今天发生的事：
${eventText || '（没有特别的记录，只是普通的一天。）'}

今天的对话片段：
${chatText || '（今天没有和对方说太多话。）'}

写一篇 150-300 字的日记。可以写自己的小情绪、没做完的事、对对方的观察，但不要编造没有发生过的重大事件。`
          }
        ],
        temperature: 0.9,
        maxTokens: 500,
        mockPayload: { events, date }
      });
      content = scrubOutput(result.text.trim()).text;
    } catch {
      // Fall through to the offline template below.
    }
  }
  if (!content) {
    content = `今天${events.length ? `做了${events.length}件事` : '过得很安静'}。${events[0]?.detail ?? ''}\n\n${weatherLine(weather)}。我把窗户开了一条缝，风进来的时候，桌上的纸动了一下。\n\n有些事还没做完，明天再说吧。`;
  }

  const id = existing?.id ?? newId('diary');
  db.prepare(
    `INSERT INTO diary_entries (id, character_id, date, content, mood, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_id, date) DO UPDATE SET content=excluded.content, mood=excluded.mood,
       tags=excluded.tags, created_at=excluded.created_at`
  ).run(
    id,
    charId(),
    date,
    content,
    getState().mood,
    JSON.stringify(events.slice(0, 5).map((event) => event.type)),
    nowMs()
  );
  publish('diary', { date });
  return getDiary(date)!;
}

export async function generateDream(force = false): Promise<Dream> {
  const state = getState();
  const settings = getSettings();
  const date = dateKey(nowMs(), settings.user.timezone);
  const key = `dream_${date}`;
  if (!force && getMeta(key)) {
    const latest = getDreams(1)[0];
    if (latest) return latest;
  }
  const character = getCharacter();
  const rows = db
    .prepare(
      `SELECT * FROM memories
       WHERE character_id = ? AND status = 'active' AND kind NOT IN ('core')
       ORDER BY RANDOM() LIMIT 4`
    )
    .all(character.id) as Row[];
  const memoryText = rows.map((row) => String(row.content).slice(0, 160)).join('\n');
  let content = '';
  try {
    const result = await complete({
      task: 'dream',
      system: `你在写「${character.name}」的一个梦。梦是碎片化的、有情绪的，不要解释象征，不要写解析。${SAFETY_PROMPT}`,
      messages: [
        {
          role: 'user',
          content: `她今天的状态：心情 ${state.mood.toFixed(2)}，精力 ${state.energy.toFixed(2)}，压力 ${state.stress.toFixed(2)}。
最近的记忆碎片：
${memoryText || '（最近没有特别鲜明的记忆。）'}

写一段 100-200 字的梦。可以荒诞，但要保留她自己的语气和在意的东西。`
        }
      ],
      temperature: 1.0,
      maxTokens: 400,
      mockPayload: { memories: rows }
    });
    content = result.text.trim();
  } catch {
    content = `梦里走廊很长，灯一盏一盏往后退。\n\n她手里还抱着没签完的文件，走到尽头才发现那里没有门，只有一张小桌子，桌上放着一杯已经凉掉的茶。\n\n醒来时，窗外还没亮。`;
  }
  const id = newId('dream');
  db.prepare(
    `INSERT INTO dreams (id, character_id, at, content, source_memory_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, character.id, nowMs(), content, JSON.stringify(rows.map((row) => String(row.id))), nowMs());
  setMeta(key, '1');
  addEvent({
    type: 'dream',
    title: '做了一个梦',
    detail: content.slice(0, 80),
    importance: 0.35,
    shareable: false
  });
  publish('dream', { id });
  return getDreams(1)[0];
}

export function currentMomentPrompt(weather: Weather): string {
  const settings = getSettings();
  const tz = settings.user.timezone;
  const now = nowMs();
  const state = getState();
  const date = dateKey(now, tz);
  const blocks = getBlocks(date);
  const minutes = minutesOfDay(now, tz);
  const block = findBlock(blocks, minutes);
  const next = findNextBlock(blocks, minutes);
  const p = partsInZone(now, tz);
  const daylight =
    p.hour >= 6 && p.hour < 18
      ? true
      : Boolean(weather.isDay) && p.hour >= 5 && p.hour < 20;
  const light = daylight ? '窗外是白天' : '窗外已经黑了';
  return [
    `现在是 ${dateLabel(date, tz)} ${formatClock(now, tz)}（${dayPhase(p.hour)}，${light}）。`,
    `你此刻正在${block ? `${block.activity}，在${block.location}` : state.currentActivity || '发呆'}。`,
    next ? `接下来：${minutesToHM(next.startMin)} 开始${next.activity}。` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function lifePromptContext(weather: Weather): string {
  const settings = getSettings();
  const tz = settings.user.timezone;
  const now = nowMs();
  const state = getState();
  const date = dateKey(now, tz);
  const blocks = getBlocks(date);
  const minutes = minutesOfDay(now, tz);
  const block = findBlock(blocks, minutes);
  const recentEvents = getEvents(5);
  return [
    currentMomentPrompt(weather),
    `天气：${settings.life.city}，${weatherLine(weather)}。`,
    block?.detail ? `此刻的细节：${block.detail}` : '',
    `身体状态：精力 ${Math.round(state.energy * 100)}%，饥饿 ${Math.round(state.hunger * 100)}%，压力 ${Math.round(state.stress * 100)}%，心情 ${state.mood >= 0 ? '+' : ''}${state.mood.toFixed(2)}。`,
    state.outfit ? `今天穿着：${state.outfit}` : '',
    recentEvents.length
      ? `最近发生的小事：\n${recentEvents
          .map((event) => `- ${formatDateTime(event.at, tz)} ${event.title}${event.detail ? `：${event.detail}` : ''}`)
          .join('\n')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function summarizeState(state: LifeState): string {
  const mood =
    state.mood < -0.4 ? '低落' : state.mood < -0.1 ? '有点闷' : state.mood < 0.25 ? '平静' : state.mood < 0.55 ? '还不错' : '心情很好';
  const energy =
    state.energy < 0.2 ? '快没电了' : state.energy < 0.4 ? '有点累' : state.energy < 0.7 ? '还行' : '精神不错';
  return `${mood}，${energy}`;
}

export function scheduleForPrompt(date: string): string {
  const tz = getSettings().user.timezone;
  const blocks = getBlocks(date);
  const minutes = minutesOfDay(nowMs(), tz);
  return blocks
    .map((block) => {
      const marker = minutes >= block.startMin && minutes < block.endMin ? ' ←现在' : '';
      return `${minutesToHM(block.startMin)}-${minutesToHM(block.endMin)} ${block.activity}（${CATEGORY_TEXT[block.category] ?? block.category}，${block.location}）${marker}`;
    })
    .join('\n');
}

export function yesterdayKey(): string {
  return addDays(dateKey(nowMs(), getSettings().user.timezone), -1);
}

export { CATEGORY_TEXT };
