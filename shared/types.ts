export type Role = 'user' | 'assistant' | 'system';

export type MemoryKind =
  | 'fact'
  | 'preference'
  | 'event'
  | 'promise'
  | 'relationship'
  | 'emotion'
  | 'self'
  | 'core'
  | 'summary';

export type MemoryStatus = 'active' | 'archived' | 'done' | 'deleted';
export type ScopeType = 'private' | 'group' | 'self' | 'shared';

export interface LorebookEntry {
  id: string;
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  insertionOrder: number;
}

export interface CharacterReference {
  id: string;
  url: string;
  mime: string;
  caption: string;
  createdAt: number;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  systemPrompt: string;
  postHistory: string;
  alternateGreetings: string[];
  tags: string[];
  avatarUrl: string | null;
  lorebook: LorebookEntry[];
  references: CharacterReference[];
  createdAt: number;
  updatedAt: number;
}

export interface LifeState {
  characterId: string;
  mood: number;
  energy: number;
  hunger: number;
  stress: number;
  health: number;
  social: number;
  sleepDebt: number;
  currentActivity: string;
  currentLocation: string;
  outfit: string;
  lastTick: number;
  updatedAt: number;
}

export interface ScheduleBlock {
  id: string;
  characterId: string;
  date: string;
  startMin: number;
  endMin: number;
  activity: string;
  location: string;
  category: string;
  detail: string;
  shareable: boolean;
  source: string;
}

export interface LifeEvent {
  id: string;
  at: number;
  type: string;
  title: string;
  detail: string;
  importance: number;
  shareable: boolean;
  meta: Record<string, unknown>;
}

export interface Weather {
  city: string;
  temperature: number;
  apparent: number;
  code: number;
  label: string;
  wind: number;
  humidity: number;
  isDay: boolean;
  updatedAt: number;
  source: 'open-meteo' | 'fallback' | 'cache';
}

export interface Memory {
  id: string;
  characterId: string;
  scopeType: ScopeType;
  scopeId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  valence: number;
  source: string;
  sourceMessageId: string | null;
  happenedAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  useCount: number;
  status: MemoryStatus;
  pinned: boolean;
  tags: string[];
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  score?: number;
  reasons?: string[];
}

export interface MemoryExportFile {
  format: 'alive-memory-v1';
  version: 1;
  exportedAt: string;
  character: { id: string; name: string };
  count: number;
  memories: Memory[];
}

export interface MemoryImportResult {
  imported: number;
  skipped: number;
  invalid: number;
  total: number;
  errors: { index: number; message: string }[];
}

export interface Relationship {
  id: string;
  characterId: string;
  peerId: string;
  peerName: string;
  affinity: number;
  trust: number;
  tension: number;
  stage: string;
  notes: string;
  boundaries: string;
  lastInteractionAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type VisionSafety =
  | 'safe'
  | 'suggestive'
  | 'sexual'
  | 'violent'
  | 'minor'
  | 'unknown';

export interface VisionSummary {
  summary: string;
  visibleText: string;
  mood: string;
  intent: string;
  safety: VisionSafety;
  identity: 'self' | 'other' | 'uncertain';
  identityConfidence: number;
  identityEvidence: string;
  referenceSignature: string;
  model: string;
  analyzedAt: number;
}

export interface Attachment {
  id: string;
  url: string;
  mime: string;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  vision: VisionSummary | null;
}

export interface VoiceAttachment {
  url: string;
  mime: string;
  voiceId: string;
  model: string;
  createdAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  segments: string[];
  kind: string;
  meta: Record<string, unknown>;
  attachments: Attachment[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  channel: string;
  peerId: string;
  peerName: string;
  characterId: string;
  createdAt: number;
  updatedAt: number;
  lastReadAt: number;
}

export interface DiaryEntry {
  id: string;
  date: string;
  content: string;
  mood: number;
  tags: string[];
  createdAt: number;
}

export interface Dream {
  id: string;
  at: number;
  content: string;
  sourceMemoryIds: string[];
  createdAt: number;
}

export interface ProactiveRecord {
  id: string;
  candidateType: string;
  reason: string;
  content: string;
  status:
    | 'sent'
    | 'delivered'
    | 'read'
    | 'replied'
    | 'ignored'
    | 'expired'
    | 'skipped'
    | 'failed'
    | 'candidate';
  score: number;
  createdAt: number;
  sentAt: number | null;
  meta: Record<string, unknown>;
}

export type ProactiveEventState =
  | 'discovered'
  | 'blocked'
  | 'eligible'
  | 'selected'
  | 'generating'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'replied'
  | 'ignored'
  | 'failed'
  | 'expired';

/** 同一个话题从“候选”到“被回应”只有这一条主记录。 */
export interface ProactiveEvent {
  id: string;
  topicKey: string;
  candidateType: string;
  reason: string;
  detail: string;
  state: ProactiveEventState;
  score: number;
  blockers: string[];
  attempts: number;
  payload: Record<string, unknown>;
  messageId: string | null;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  deliveredAt: number | null;
  readAt: number | null;
  repliedAt: number | null;
  closedAt: number | null;
  closeReason: string;
}

export interface ImportantDate {
  id: string;
  title: string;
  month: number;
  day: number;
  year: number | null;
  recurring: boolean;
  note: string;
  createdAt: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  dueAt: number | null;
  done: boolean;
  createdAt: number;
}

export interface MemoryStats {
  total: number;
  core: number;
  promises: number;
  completedPromises: number;
  archived: number;
  timeline: number;
}

export type InterestStatus = 'active' | 'paused' | 'dropped' | 'curious' | 'completed';
export interface Interest {
  id: string;
  topic: string;
  domain: string;
  question: string;
  summary: string;
  level: number;
  curiosity: number;
  competence: number;
  studyCount: number;
  status: InterestStatus;
  origin: string;
  lastStudiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type LeisureKind =
  | 'overtime'
  | 'video'
  | 'music'
  | 'game'
  | 'walk'
  | 'snack'
  | 'nap'
  | 'read'
  | 'idle';

export interface LeisureSession {
  id: string;
  kind: LeisureKind;
  activity: string;
  reason: string;
  reaction: string;
  shareable: string;
  sourceUrl: string;
  sourceTitle: string;
  enjoyment: number;
  createdAt: number;
}

export interface LeisureCandidate {
  id: string;
  kind: string;
  activity: string;
  reason: string;
  appeal: number;
  chosen: boolean;
  createdAt: number;
}

export interface LeisureView {
  boredom: number;
  canChoose: boolean;
  reason: string;
  sessions: LeisureSession[];
  candidates: LeisureCandidate[];
  stats: {
    today: number;
    averageEnjoyment: number | null;
    overtime: number;
  };
}

export type LearningSourceType = 'web' | 'video';

export interface LearningSource {
  id: string;
  sessionId: string;
  title: string;
  url: string;
  siteName: string;
  type: LearningSourceType;
  snippet: string;
  excerpt: string;
  authority: number;
  fetched: boolean;
  createdAt: number;
}

export interface LearningSession {
  id: string;
  interestId: string | null;
  topic: string;
  domain: string;
  question: string;
  notes: string;
  insight: string;
  shareable: string;
  enjoyment: number;
  difficulty: number;
  wantMore: boolean;
  model: string;
  sources: LearningSource[];
  createdAt: number;
}

export interface LearningCandidate {
  id: string;
  topic: string;
  domain: string;
  question: string;
  reason: string;
  chosen: boolean;
  createdAt: number;
}

export interface LearningView {
  interests: Interest[];
  sessions: LearningSession[];
  candidates: LearningCandidate[];
  stats: {
    active: number;
    sessions: number;
    studiedToday: number;
    averageEnjoyment: number | null;
  };
  canLearn: boolean;
  reason: string;
}

export interface AllowedApp {
  id: string;
  label: string;
  path: string;
  addedAt: number;
}

export interface ComputerSettings {
  enabled: boolean;
  consentAt: number | null;
  consentVersion: number;
  allowOpenUrls: boolean;
  allowedApps: AllowedApp[];
  dailyLimit: number;
}

export type ComputerRequestKind = 'open_url' | 'launch_app';
export type ComputerRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'executed'
  | 'failed';

export interface ComputerRequest {
  id: string;
  kind: ComputerRequestKind;
  target: string;
  label: string;
  reason: string;
  risk: string;
  status: ComputerRequestStatus;
  result: string;
  createdAt: number;
  decidedAt: number | null;
  executedAt: number | null;
}

export interface ComputerView {
  settings: ComputerSettings;
  pending: ComputerRequest[];
  history: ComputerRequest[];
  todayCount: number;
}

export interface ScreenSettings {
  enabled: boolean;
  consentAt: number | null;
  consentVersion: number;
  intervalMin: number;
  probability: number;
  dailyCap: number;
  allowVision: boolean;
}

export interface ScreenObservation {
  id: string;
  capturedAt: number;
  windowTitle: string;
  processName: string;
  appLabel: string;
  scene: string;
  summary: string;
  visibleText: string;
  interest: number;
  sensitive: boolean;
  skippedReason: string;
  commented: boolean;
  meta: Record<string, unknown>;
}

export interface ScreenView {
  settings: ScreenSettings;
  observations: ScreenObservation[];
  todayCount: number;
  lastAttemptAt: number | null;
  lastObservationAt: number | null;
  capabilities: {
    platform: string;
    capture: boolean;
    vision: boolean;
  };
}

export interface ScreenPeekResult {
  ok: boolean;
  reason: string;
  observation?: ScreenObservation;
}

export type LiveEventType =
  | 'danmaku'
  | 'gift'
  | 'super_chat'
  | 'guard'
  | 'enter'
  | 'follow'
  | 'system';

export interface LiveAssistantSettings {
  installed: boolean;
  installedAt: number | null;
  enabled: boolean;
  roomId: string;
  streamerName: string;
  cookie: string;
  autoReply: boolean;
  replyMode: 'suggest' | 'send';
  autoReplyCooldownSec: number;
  maxPerMinute: number;
  maxReplyChars: number;
  replyToGifts: boolean;
  moderationHints: boolean;
  learnFromDanmaku: boolean;
}

export interface PublicLiveAssistantSettings extends Omit<LiveAssistantSettings, 'cookie'> {
  hasCookie: boolean;
  hasSessdata: boolean;
  hasBiliJct: boolean;
  hasBuvid3: boolean;
  hasBuvid4: boolean;
  hasDedeUserId: boolean;
}

export interface LiveCookieFields {
  sessdata?: string;
  biliJct?: string;
  buvid3?: string;
  buvid4?: string;
  dedeUserId?: string;
  extra?: string;
}

export interface LiveEventRecord {
  id: string;
  roomId: string;
  type: LiveEventType;
  uid: string;
  uname: string;
  text: string;
  giftName: string;
  price: number;
  flags: string[];
  meta: Record<string, unknown>;
  createdAt: number;
}

export interface LiveReply {
  id: string;
  eventId: string | null;
  eventText: string;
  uname: string;
  text: string;
  mode: 'suggest' | 'send';
  sent: boolean;
  error: string;
  createdAt: number;
}

export interface LiveRoomInfo {
  roomId: string;
  shortId: string;
  title: string;
  uname: string;
  liveStatus: number;
  online: number;
}

export interface LiveKnowledgeEntry {
  id: string;
  roomId: string;
  topic: string;
  content: string;
  confidence: number;
  sourceCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface LiveLearningStatus {
  enabled: boolean;
  busy: boolean;
  lastAt: number | null;
  error: string;
}

export interface LiveAssistantView {
  installed: boolean;
  settings: PublicLiveAssistantSettings;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  connectionMode: 'none' | 'websocket' | 'history';
  room: LiveRoomInfo | null;
  error: string;
  notice: string;
  events: LiveEventRecord[];
  replies: LiveReply[];
  knowledge: LiveKnowledgeEntry[];
  learning: LiveLearningStatus;
  capabilities: {
    bilibiliRead: boolean;
    bilibiliSend: boolean;
    autoReply: boolean;
  };
}

export interface VoiceSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  voiceId: string;
  speed: number;
  probability: number;
  maxChars: number;
  autoplay: boolean;
}

export interface ImageSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  quality: string;
  stylePrompt: string;
  identityPrompt: string;
  maxPerDay: number;
  useReferences: boolean;
  autoMorningPhoto: boolean;
}

export interface WardrobeItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  imageUrl: string;
  mime: string;
  createdAt: number;
}

export interface DailyOutfit {
  date: string;
  itemId: string | null;
  description: string;
  source: 'wardrobe' | 'manual' | 'fallback';
  createdAt: number;
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  source: string;
  createdAt: number;
}

export interface AppearanceView {
  date: string;
  today: DailyOutfit;
  wardrobe: WardrobeItem[];
  images: GeneratedImage[];
  imageConfigured: boolean;
  remainingToday: number;
  referenceCount: number;
  outfitPhoto: GeneratedImage | null;
}

export interface MemoryIndexStats {
  enabled: boolean;
  configured: boolean;
  model: string;
  total: number;
  indexed: number;
  pending: number;
  dimensions: number;
  lastError: string | null;
}

export interface AbsencePeriod {
  id: string;
  startAt: number;
  endAt: number;
  summary: string;
  eventCount: number;
  createdAt: number;
}

export interface LifeView {
  character: Character;
  state: LifeState;
  date: string;
  blocks: ScheduleBlock[];
  currentBlock: ScheduleBlock | null;
  nextBlock: ScheduleBlock | null;
  events: LifeEvent[];
  weather: Weather;
  diary: DiaryEntry | null;
  dreams: Dream[];
  absences: AbsencePeriod[];
  relationship: Relationship;
  memoryStats: MemoryStats;
  outfitPhoto: GeneratedImage | null;
}

export type AgreementStatus = 'active' | 'done' | 'archived';

/** 约定板与记忆页共用 kind='promise' 的记忆，不另建一份承诺表。 */
export interface Agreement {
  id: string;
  title: string;
  content: string;
  status: AgreementStatus;
  source: string;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  proactiveMentions: number;
  mentionCount: number;
  lastProactiveAt: number | null;
  remindersPausedUntil: number | null;
  completedAt: number | null;
  completedBy: string;
  completedReason: string;
  completedEvidence: string;
}

export interface AgreementsView {
  active: Agreement[];
  done: Agreement[];
  archived: Agreement[];
  stats: {
    active: number;
    done: number;
    archived: number;
    paused: number;
  };
}

export interface WeeklyReview {
  id: string;
  weekStart: string;
  weekEnd: string;
  title: string;
  content: string;
  highlights: string[];
  photoUrl: string | null;
  createdAt: number;
}

export interface WeeklyReviewView {
  reviews: WeeklyReview[];
  currentWeek: { start: string; end: string };
  canGenerate: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  onlyWhenHidden: boolean;
}

export interface WeeklyReviewSettings {
  enabled: boolean;
  weekday: number;
  time: string;
  notify: boolean;
}

export type ChatAvatarSource = 'character' | 'outfit';

export interface VisionSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface EmbeddingSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  batchSize: number;
}

export interface RerankSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  topN: number;
}

export interface MemorySettings {
  enabled: boolean;
  summarizeEvery: number;
  topK: number;
  decayEnabled: boolean;
  embedding: EmbeddingSettings;
  rerank: RerankSettings;
}

export interface AppSettings {
  provider: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    mock: boolean;
  };
  user: {
    name: string;
    nickname: string;
    timezone: string;
  };
  chatAvatarSource: ChatAvatarSource;
  notifications: NotificationSettings;
  weeklyReview: WeeklyReviewSettings;
  life: {
    city: string;
    latitude: number;
    longitude: number;
    weatherEnabled: boolean;
    autoSchedule: boolean;
    proactiveMicroEvents: boolean;
  };
  proactive: {
    enabled: boolean;
    minIntervalMin: number;
    dailyCap: number;
    quietStart: string;
    quietEnd: string;
    idleMin: number;
  };
  memory: MemorySettings;
  vision: VisionSettings;
  learning: {
    enabled: boolean;
    dailySessions: number;
    minGapMin: number;
    maxMinutes: number;
    researchEnabled: boolean;
    videoEnabled: boolean;
  };
  leisure: {
    enabled: boolean;
    dailyChoices: number;
    minGapMin: number;
    allowOvertime: boolean;
    onlineEnabled: boolean;
    maxMinutes: number;
  };
  computer: ComputerSettings;
  screen: ScreenSettings;
  liveAssistant: LiveAssistantSettings;
  voice: VoiceSettings;
  image: ImageSettings;
}

export interface PublicEmbeddingSettings extends Omit<EmbeddingSettings, 'apiKey'> {
  hasApiKey: boolean;
}

export interface PublicRerankSettings extends Omit<RerankSettings, 'apiKey'> {
  hasApiKey: boolean;
}

export interface PublicMemorySettings extends Omit<MemorySettings, 'embedding' | 'rerank'> {
  embedding: PublicEmbeddingSettings;
  rerank: PublicRerankSettings;
}

export interface PublicVisionSettings extends Omit<VisionSettings, 'apiKey'> {
  hasApiKey: boolean;
}

export interface PublicVoiceSettings extends Omit<VoiceSettings, 'apiKey'> {
  hasApiKey: boolean;
}

export interface PublicImageSettings extends Omit<ImageSettings, 'apiKey'> {
  hasApiKey: boolean;
}

export interface PublicSettings
  extends Omit<
    AppSettings,
    'provider' | 'memory' | 'vision' | 'computer' | 'liveAssistant' | 'voice' | 'image'
  > {
  provider: Omit<AppSettings['provider'], 'apiKey'> & { hasApiKey: boolean };
  memory: PublicMemorySettings;
  vision: PublicVisionSettings;
  liveAssistant: PublicLiveAssistantSettings;
  voice: PublicVoiceSettings;
  image: PublicImageSettings;
}

export interface Bootstrap {
  character: Character;
  settings: PublicSettings;
  life: LifeView;
  conversation: Conversation;
  unread: number;
  llmConfigured: boolean;
  demo: boolean;
  version: string;
}

export interface ChatStreamMeta {
  userMessage: Message;
  memoryIds: string[];
  memoryCount: number;
  memoryMode?: string;
  voicePlanned?: boolean;
}

export interface ChatDone {
  message: Message;
  relationship: Relationship;
}
