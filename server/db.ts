import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type {
  Character,
  Conversation,
  DiaryEntry,
  Dream,
  ImportantDate,
  LifeEvent,
  LifeState,
  Memory,
  Message,
  Note,
  ProactiveRecord,
  Relationship,
  ScheduleBlock
} from '../shared/types.js';
import { DATA_DIR, seedPath } from './config.js';
import { nowMs } from './time.js';

export const DB_PATH = resolve(DATA_DIR, 'alive.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT '',
  first_mes TEXT NOT NULL DEFAULT '',
  mes_example TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  post_history TEXT NOT NULL DEFAULT '',
  alternate_greetings TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lorebook (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  keys TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  constant INTEGER NOT NULL DEFAULT 0,
  insertion_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'app',
  peer_id TEXT NOT NULL DEFAULT 'local-user',
  peer_name TEXT NOT NULL DEFAULT '你',
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_read_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  segments TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'chat',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS timeline (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  summarized INTEGER NOT NULL DEFAULT 0,
  summary_batch TEXT
);
CREATE INDEX IF NOT EXISTS idx_timeline_conv ON timeline(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_timeline_unsummarized ON timeline(conversation_id, summarized, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'private',
  scope_id TEXT NOT NULL DEFAULT 'local-user',
  kind TEXT NOT NULL DEFAULT 'event',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.8,
  valence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'chat',
  source_message_id TEXT,
  happened_at INTEGER,
  expires_at INTEGER,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  pinned INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(character_id, scope_type, scope_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind, status);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, content, tags,
  content='memories',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO memories_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS memory_audit (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS life_state (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  mood REAL NOT NULL DEFAULT 0.1,
  energy REAL NOT NULL DEFAULT 0.75,
  hunger REAL NOT NULL DEFAULT 0.3,
  stress REAL NOT NULL DEFAULT 0.3,
  health REAL NOT NULL DEFAULT 0.9,
  social REAL NOT NULL DEFAULT 0.6,
  sleep_debt REAL NOT NULL DEFAULT 0.1,
  current_activity TEXT NOT NULL DEFAULT '发呆',
  current_location TEXT NOT NULL DEFAULT '房间',
  outfit TEXT NOT NULL DEFAULT '',
  last_tick INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  activity TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  detail TEXT NOT NULL DEFAULT '',
  shareable INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'fallback',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule_blocks(character_id, date, start_min);

CREATE TABLE IF NOT EXISTS life_events (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  importance REAL NOT NULL DEFAULT 0.5,
  shareable INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_life_events ON life_events(character_id, at);

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  mood REAL NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE(character_id, date)
);

CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  content TEXT NOT NULL,
  source_memory_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  due_at INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS important_dates (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  title TEXT NOT NULL,
  month INTEGER NOT NULL,
  day INTEGER NOT NULL,
  year INTEGER,
  recurring INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  peer_name TEXT NOT NULL,
  affinity REAL NOT NULL DEFAULT 50,
  trust REAL NOT NULL DEFAULT 50,
  tension REAL NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT '熟悉',
  notes TEXT NOT NULL DEFAULT '',
  boundaries TEXT NOT NULL DEFAULT '',
  last_interaction_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(character_id, peer_id)
);

CREATE TABLE IF NOT EXISTS relationship_events (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  delta REAL NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chat',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  candidate_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_proactive_time ON proactive_messages(character_id, created_at);

CREATE TABLE IF NOT EXISTS proactive_events (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  candidate_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'discovered',
  score REAL NOT NULL DEFAULT 0,
  blockers TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  delivered_at INTEGER,
  read_at INTEGER,
  replied_at INTEGER,
  closed_at INTEGER,
  close_reason TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proactive_events_topic
  ON proactive_events(character_id, topic_key);
CREATE INDEX IF NOT EXISTS idx_proactive_events_state
  ON proactive_events(character_id, state, updated_at);

CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_logs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  memory_ids TEXT NOT NULL DEFAULT '[]',
  scores TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proactive_candidates (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  score REAL NOT NULL,
  allowed INTEGER NOT NULL,
  blocked_by TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_time ON proactive_candidates(character_id, created_at);

CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_model ON memory_vectors(model);

CREATE TABLE IF NOT EXISTS interests (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '其他',
  question TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  level REAL NOT NULL DEFAULT 0,
  curiosity REAL NOT NULL DEFAULT 0.5,
  competence REAL NOT NULL DEFAULT 0.1,
  study_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  origin TEXT NOT NULL DEFAULT 'self',
  last_studied_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(character_id, topic)
);
CREATE INDEX IF NOT EXISTS idx_interests_status ON interests(character_id, status);

CREATE TABLE IF NOT EXISTS learning_sessions (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  interest_id TEXT,
  topic TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '其他',
  question TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  insight TEXT NOT NULL DEFAULT '',
  shareable TEXT NOT NULL DEFAULT '',
  enjoyment REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0.5,
  want_more INTEGER NOT NULL DEFAULT 1,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_time ON learning_sessions(character_id, created_at);

CREATE TABLE IF NOT EXISTS leisure_sessions (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  activity TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  reaction TEXT NOT NULL DEFAULT '',
  shareable TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL DEFAULT '',
  enjoyment REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leisure_time ON leisure_sessions(character_id, created_at);

CREATE TABLE IF NOT EXISTS leisure_candidates (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  activity TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  appeal REAL NOT NULL DEFAULT 0.5,
  chosen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leisure_candidates ON leisure_candidates(character_id, created_at);

CREATE TABLE IF NOT EXISTS learning_sources (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  site_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'web',
  snippet TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  authority REAL NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_sources_session ON learning_sources(session_id, created_at);

CREATE TABLE IF NOT EXISTS computer_requests (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  executed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_computer_requests ON computer_requests(character_id, status, created_at);

CREATE TABLE IF NOT EXISTS screen_observations (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  window_title TEXT NOT NULL DEFAULT '',
  process_name TEXT NOT NULL DEFAULT '',
  app_label TEXT NOT NULL DEFAULT '',
  scene TEXT NOT NULL DEFAULT 'other',
  summary TEXT NOT NULL DEFAULT '',
  visible_text TEXT NOT NULL DEFAULT '',
  interest REAL NOT NULL DEFAULT 0,
  sensitive INTEGER NOT NULL DEFAULT 0,
  skipped_reason TEXT NOT NULL DEFAULT '',
  commented INTEGER NOT NULL DEFAULT 0,
  image_path TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_screen_observations
  ON screen_observations(character_id, captured_at);

CREATE TABLE IF NOT EXISTS live_events (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  type TEXT NOT NULL,
  uid TEXT NOT NULL DEFAULT '',
  uname TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  gift_name TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_events ON live_events(character_id, created_at);

CREATE TABLE IF NOT EXISTS live_replies (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  event_id TEXT,
  uname TEXT NOT NULL DEFAULT '',
  event_text TEXT NOT NULL DEFAULT '',
  reply TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'suggest',
  sent INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_replies ON live_replies(character_id, created_at);

CREATE TABLE IF NOT EXISTS live_knowledge (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_knowledge
  ON live_knowledge(character_id, room_id, updated_at);

CREATE TABLE IF NOT EXISTS learning_candidates (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '其他',
  question TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  chosen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_candidates ON learning_candidates(character_id, created_at);

CREATE TABLE IF NOT EXISTS character_references (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  url TEXT NOT NULL,
  mime TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_character_references ON character_references(character_id, created_at);

CREATE TABLE IF NOT EXISTS wardrobe_items (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  image_url TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wardrobe_items ON wardrobe_items(character_id, created_at);

CREATE TABLE IF NOT EXISTS daily_outfits (
  character_id TEXT NOT NULL,
  date TEXT NOT NULL,
  item_id TEXT,
  description TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'fallback',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, date)
);

CREATE TABLE IF NOT EXISTS generated_images (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  url TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  source TEXT NOT NULL DEFAULT 'selfie',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generated_images ON generated_images(character_id, created_at);

CREATE TABLE IF NOT EXISTS outfit_photos (
  character_id TEXT NOT NULL,
  date TEXT NOT NULL,
  image_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, date)
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  highlights TEXT NOT NULL DEFAULT '[]',
  photo_url TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(character_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_reviews ON weekly_reviews(character_id, week_start);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  vision TEXT NOT NULL DEFAULT '{}',
  vision_model TEXT,
  analyzed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at);

CREATE TABLE IF NOT EXISTS absence_periods (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_absence_time ON absence_periods(character_id, end_at);

PRAGMA user_version = 5;
`;

db.exec(SCHEMA);

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type Row = Record<string, any>;

export function mapCharacter(row: Row, lore: Row[] = []): Character {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    personality: String(row.personality ?? ''),
    scenario: String(row.scenario ?? ''),
    firstMes: String(row.first_mes ?? ''),
    mesExample: String(row.mes_example ?? ''),
    systemPrompt: String(row.system_prompt ?? ''),
    postHistory: String(row.post_history ?? ''),
    alternateGreetings: parseJson<string[]>(row.alternate_greetings, []),
    tags: parseJson<string[]>(row.tags, []),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    references: [],
    lorebook: lore.map((entry) => ({
      id: String(entry.id),
      keys: parseJson<string[]>(entry.keys, []),
      content: String(entry.content),
      enabled: Boolean(entry.enabled),
      constant: Boolean(entry.constant),
      insertionOrder: Number(entry.insertion_order ?? 100)
    })),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

export function mapMemory(row: Row): Memory {
  return {
    id: String(row.id),
    characterId: String(row.character_id),
    scopeType: row.scope_type,
    scopeId: String(row.scope_id),
    kind: row.kind,
    title: String(row.title ?? ''),
    content: String(row.content),
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    valence: Number(row.valence),
    source: String(row.source ?? 'chat'),
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
    happenedAt: row.happened_at == null ? null : Number(row.happened_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    useCount: Number(row.use_count ?? 0),
    status: row.status,
    pinned: Boolean(row.pinned),
    tags: parseJson<string[]>(row.tags, []),
    meta: parseJson<Record<string, unknown>>(row.meta, {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

export function mapState(row: Row): LifeState {
  return {
    characterId: String(row.character_id),
    mood: Number(row.mood),
    energy: Number(row.energy),
    hunger: Number(row.hunger),
    stress: Number(row.stress),
    health: Number(row.health),
    social: Number(row.social),
    sleepDebt: Number(row.sleep_debt),
    currentActivity: String(row.current_activity),
    currentLocation: String(row.current_location),
    outfit: String(row.outfit ?? ''),
    lastTick: Number(row.last_tick),
    updatedAt: Number(row.updated_at)
  };
}

export function mapBlock(row: Row): ScheduleBlock {
  return {
    id: String(row.id),
    characterId: String(row.character_id),
    date: String(row.date),
    startMin: Number(row.start_min),
    endMin: Number(row.end_min),
    activity: String(row.activity),
    location: String(row.location ?? ''),
    category: String(row.category ?? 'other'),
    detail: String(row.detail ?? ''),
    shareable: Boolean(row.shareable),
    source: String(row.source ?? 'fallback')
  };
}

export function mapEvent(row: Row): LifeEvent {
  return {
    id: String(row.id),
    at: Number(row.at),
    type: String(row.type),
    title: String(row.title),
    detail: String(row.detail ?? ''),
    importance: Number(row.importance),
    shareable: Boolean(row.shareable),
    meta: parseJson<Record<string, unknown>>(row.meta, {})
  };
}

export function mapDiary(row: Row): DiaryEntry {
  return {
    id: String(row.id),
    date: String(row.date),
    content: String(row.content),
    mood: Number(row.mood),
    tags: parseJson<string[]>(row.tags, []),
    createdAt: Number(row.created_at)
  };
}

export function mapDream(row: Row): Dream {
  return {
    id: String(row.id),
    at: Number(row.at),
    content: String(row.content),
    sourceMemoryIds: parseJson<string[]>(row.source_memory_ids, []),
    createdAt: Number(row.created_at)
  };
}

export function mapNote(row: Row): Note {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content ?? ''),
    dueAt: row.due_at == null ? null : Number(row.due_at),
    done: Boolean(row.done),
    createdAt: Number(row.created_at)
  };
}

export function mapImportantDate(row: Row): ImportantDate {
  return {
    id: String(row.id),
    title: String(row.title),
    month: Number(row.month),
    day: Number(row.day),
    year: row.year == null ? null : Number(row.year),
    recurring: Boolean(row.recurring),
    note: String(row.note ?? ''),
    createdAt: Number(row.created_at)
  };
}

export function mapRelationship(row: Row): Relationship {
  return {
    id: String(row.id),
    characterId: String(row.character_id),
    peerId: String(row.peer_id),
    peerName: String(row.peer_name),
    affinity: Number(row.affinity),
    trust: Number(row.trust),
    tension: Number(row.tension),
    stage: String(row.stage),
    notes: String(row.notes ?? ''),
    boundaries: String(row.boundaries ?? ''),
    lastInteractionAt: row.last_interaction_at == null ? null : Number(row.last_interaction_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

export function mapConversation(row: Row): Conversation {
  return {
    id: String(row.id),
    title: String(row.title),
    channel: String(row.channel),
    peerId: String(row.peer_id),
    peerName: String(row.peer_name),
    characterId: String(row.character_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastReadAt: Number(row.last_read_at ?? 0)
  };
}

export function mapMessage(row: Row): Message {
  const meta = parseJson<Record<string, unknown>>(row.meta, {});
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role,
    content: String(row.content),
    segments: parseJson<string[]>(row.segments, []),
    kind: String(row.kind ?? 'chat'),
    meta,
    attachments: Array.isArray(meta.attachments)
      ? (meta.attachments as Message['attachments'])
      : [],
    createdAt: Number(row.created_at)
  };
}

export function mapProactive(row: Row): ProactiveRecord {
  return {
    id: String(row.id),
    candidateType: String(row.candidate_type),
    reason: String(row.reason),
    content: String(row.content ?? ''),
    status: row.status,
    score: Number(row.score ?? 0),
    createdAt: Number(row.created_at),
    sentAt: row.sent_at == null ? null : Number(row.sent_at),
    meta: parseJson<Record<string, unknown>>(row.meta, {})
  };
}

function splitSegments(text: string): string[] {
  return text
    .split(/\n\s*---\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function seedCharacter(): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM characters').get() as Row;
  if (Number(count?.n ?? 0) > 0) return;

  const rawPath = seedPath('character.json');
  const fallback = {
    name: '未命名',
    description: '',
    personality: '',
    scenario: '',
    firstMes: '……你来了。',
    mesExample: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    lorebook: []
  };
  const raw: Record<string, any> = existsSync(rawPath)
    ? (JSON.parse(readFileSync(rawPath, 'utf8')) as Record<string, any>)
    : (fallback as Record<string, any>);

  const ts = nowMs();
  const id = 'char-main';
  let avatarUrl: string | null = null;
  const avatarNames = ['avatar.jpg', 'avatar.jpeg', 'avatar.png', 'avatar.webp'];
  const avatarSource = avatarNames
    .map((name) => seedPath(name))
    .find((path) => existsSync(path));
  if (avatarSource) {
    const extension = extname(avatarSource).toLowerCase();
    const fileName = `avatar-seed${extension}`;
    copyFileSync(avatarSource, resolve(DATA_DIR, 'assets', fileName));
    avatarUrl = `/assets/${fileName}`;
  }

  db.prepare(
    `INSERT INTO characters
      (id, name, description, personality, scenario, first_mes, mes_example, system_prompt,
       post_history, alternate_greetings, tags, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(raw.name ?? fallback.name),
    String(raw.description ?? ''),
    String(raw.personality ?? ''),
    String(raw.scenario ?? ''),
    String(raw.firstMes ?? raw.first_mes ?? fallback.firstMes),
    String(raw.mesExample ?? raw.mes_example ?? ''),
    String(raw.systemPrompt ?? raw.system_prompt ?? ''),
    String(raw.postHistoryInstructions ?? raw.post_history_instructions ?? ''),
    JSON.stringify(raw.alternateGreetings ?? raw.alternate_greetings ?? []),
    JSON.stringify(raw.tags ?? []),
    avatarUrl,
    ts,
    ts
  );

  const lorebook = Array.isArray(raw.lorebook)
    ? raw.lorebook
    : Array.isArray(raw.character_book?.entries)
      ? raw.character_book.entries
      : [];
  for (const [index, entry] of lorebook.entries()) {
    db.prepare(
      `INSERT INTO lorebook (id, character_id, keys, content, enabled, constant, insertion_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId('lore'),
      id,
      JSON.stringify(entry.keys ?? entry.key ?? []),
      String(entry.content ?? ''),
      entry.enabled === false ? 0 : 1,
      entry.constant ? 1 : 0,
      Number(entry.insertionOrder ?? entry.insertion_order ?? entry.order ?? index * 10 + 10)
    );
  }

  const convId = 'conv-main';
  const peerName = '你';
  db.prepare(
    `INSERT INTO conversations
      (id, title, channel, peer_id, peer_name, character_id, created_at, updated_at, last_read_at)
     VALUES (?, ?, 'app', 'local-user', ?, ?, ?, ?, 0)`
  ).run(convId, `和${raw.name ?? '她'}的对话`, peerName, id, ts, ts);

  const greeting = String(raw.firstMes ?? raw.first_mes ?? fallback.firstMes);
  if (greeting) {
    const msgId = newId('msg');
    const segments = splitSegments(greeting);
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, segments, kind, meta, created_at)
       VALUES (?, ?, 'assistant', ?, ?, 'greeting', '{}', ?)`
    ).run(msgId, convId, greeting, JSON.stringify(segments.length ? segments : [greeting]), ts);
    db.prepare(
      `INSERT INTO timeline (id, conversation_id, message_id, role, content, created_at, summarized)
       VALUES (?, ?, ?, 'assistant', ?, ?, 1)`
    ).run(newId('tl'), convId, msgId, greeting, ts);
  }

  db.prepare(
    `INSERT INTO life_state
      (character_id, mood, energy, hunger, stress, health, social, sleep_debt,
       current_activity, current_location, outfit, last_tick, updated_at)
     VALUES (?, 0.16, 0.72, 0.32, 0.34, 0.9, 0.6, 0.12, ?, ?, ?, ?, ?)`
  ).run(id, '刚处理完一叠文件', '算理中枢局 · 总务官办公室', '总务官制服', ts, ts);

  db.prepare(
    `INSERT INTO relationships
      (id, character_id, peer_id, peer_name, affinity, trust, tension, stage, notes, boundaries,
       last_interaction_at, created_at, updated_at)
     VALUES (?, ?, 'local-user', ?, 52, 55, 0, '熟悉', '', '', NULL, ?, ?)`
  ).run(newId('rel'), id, peerName, ts, ts);

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'seeded_at',
    String(ts)
  );
}

seedCharacter();

export function getMeta(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
  return row ? String(row.value) : fallback;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}
