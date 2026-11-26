import type { Bootstrap, LifeView } from '../shared/types.js';
import { VERSION } from './config.js';
import { getCharacter } from './character.js';
import { db } from './db.js';
import {
  ensureSchedule,
  findBlock,
  findNextBlock,
  getBlocks,
  getDiary,
  getDreams,
  getEvents,
  getState,
  tickLife
} from './life.js';
import {
  getConversation,
  getMessages,
  markRead,
  memoryStats,
  unreadCount
} from './memory.js';
import { getRelationship } from './relationship.js';
import { getAbsences } from './absence.js';
import { getSettings, isDemo, llmConfigured, publicSettings } from './settings.js';
import { dateKey, nowMs, partsInZone } from './time.js';
import { getWeather } from './weather.js';
import { getOutfitPhoto } from './outfit-photo.js';

export function syncConversationProfile(): void {
  const settings = getSettings();
  db.prepare(
    `UPDATE conversations SET peer_name = ? WHERE character_id = 'char-main' AND peer_id = 'local-user'`
  ).run(settings.user.name);
}

export async function buildLifeView(date?: string): Promise<LifeView> {
  const settings = getSettings();
  const character = getCharacter();
  const today = dateKey(nowMs(), settings.user.timezone);
  const target = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  if (target === today) ensureSchedule(today);
  const blocks = getBlocks(target);
  const state = getState();
  const minutes = partsInZone(nowMs(), settings.user.timezone).minutes;
  const currentBlock = target === today ? findBlock(blocks, minutes) : null;
  const nextBlock = target === today ? findNextBlock(blocks, minutes) : null;
  const weather = await getWeather();
  const events = getEvents(80).filter(
    (event) => dateKey(event.at, settings.user.timezone) === target
  );
  return {
    character,
    state,
    date: target,
    blocks,
    currentBlock,
    nextBlock,
    events,
    weather,
    diary: getDiary(target),
    dreams: getDreams(8),
    absences: getAbsences(4),
    relationship: getRelationship(),
    memoryStats: memoryStats(),
    outfitPhoto: getOutfitPhoto(character.id, target)
  };
}

export async function buildBootstrap(): Promise<Bootstrap> {
  syncConversationProfile();
  await tickLife();
  const life = await buildLifeView();
  const conversation = getConversation();
  return {
    character: life.character,
    settings: publicSettings(),
    life,
    conversation,
    unread: unreadCount(),
    llmConfigured: llmConfigured(),
    demo: isDemo(),
    version: VERSION
  };
}

export function recentMessagesForClient(limit = 60): ReturnType<typeof getMessages> {
  return getMessages('conv-main', limit);
}

export function markConversationRead(): void {
  markRead();
}
