import type {
  Agreement,
  AgreementsView,
  AppearanceView,
  Attachment,
  Bootstrap,
  Character,
  CharacterReference,
  ChatDone,
  ChatStreamMeta,
  ComputerRequest,
  ComputerSettings,
  ComputerView,
  Conversation,
  DiaryEntry,
  Dream,
  GeneratedImage,
  ImportantDate,
  Interest,
  LearningCandidate,
  LearningSession,
  LearningView,
  LeisureSession,
  LeisureView,
  LiveAssistantView,
  LiveCookieFields,
  LiveReply,
  ScreenPeekResult,
  ScreenSettings,
  ScreenView,
  LifeEvent,
  Note,
  LifeView,
  Memory,
  MemoryImportResult,
  MemoryIndexStats,
  MemoryStats,
  Message,
  ProactiveEvent,
  ProactiveRecord,
  WardrobeItem,
  PublicSettings,
  Relationship,
  ScheduleBlock,
  Weather,
  WeeklyReview,
  WeeklyReviewView
} from '../shared/types';

export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? `请求失败（${response.status}）`,
      data?.detail
    );
  }
  return data as T;
}

function json(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  health: () => request<{ ok: boolean; demo: boolean; version: string }>('/api/health'),
  life: (date?: string) =>
    request<LifeView>(`/api/life${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  tick: () => request<LifeView>('/api/life/tick', { method: 'POST' }),
  fragment: () => request<LifeEvent>('/api/life/fragment', { method: 'POST' }),
  schedule: (date?: string) =>
    request<{ date: string; blocks: ScheduleBlock[] }>(
      `/api/schedule${date ? `?date=${encodeURIComponent(date)}` : ''}`
    ),
  generateSchedule: (date?: string) =>
    request<{ date: string; blocks: ScheduleBlock[]; source: string }>(
      '/api/schedule/generate',
      json({ date })
    ),
  uploadImage: (body: { dataUrl: string; name?: string; width?: number; height?: number }) =>
    request<Attachment>('/api/uploads', json(body)),
  messages: (limit = 60, before?: number) =>
    request<{ messages: Message[] }>(
      `/api/messages?limit=${limit}${before ? `&before=${before}` : ''}`
    ),
  conversation: () =>
    request<{ conversation: Conversation; unread: number }>('/api/conversation'),
  markRead: () => request<{ ok: boolean; unread: number }>('/api/messages/read', { method: 'POST' }),
  clearMessages: () =>
    request<{
      ok: boolean;
      conversationId: string;
      messages: number;
      timeline: number;
      uploads: number;
      clearedAt: number;
      unread: number;
    }>('/api/messages/clear', { method: 'POST' }),
  memories: (params: { query?: string; kind?: string; status?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.query) search.set('query', params.query);
    if (params.kind) search.set('kind', params.kind);
    if (params.status) search.set('status', params.status);
    if (params.limit) search.set('limit', String(params.limit));
    return request<{ memories: Memory[] }>(`/api/memories?${search.toString()}`);
  },
  memoryStats: () => request<MemoryStats>('/api/memories/stats'),
  memoryIndexStatus: () => request<MemoryIndexStats>('/api/memories/index-status'),
  reindexMemories: () =>
    request<MemoryIndexStats>('/api/memories/reindex', { method: 'POST' }),
  createMemory: (body: unknown) => request<Memory>('/api/memories', json(body)),
  updateMemory: (id: string, body: unknown) =>
    request<Memory>(`/api/memories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMemory: (id: string) => request<{ ok: boolean }>(`/api/memories/${id}`, { method: 'DELETE' }),
  deleteMemories: (ids: string[]) =>
    request<{ ok: boolean; deleted: number }>('/api/memories/bulk-delete', json({ ids })),
  completeMemory: (
    id: string,
    body: { by?: 'self' | 'user'; reason?: string; evidence?: string } = {}
  ) => request<Memory>(`/api/memories/${id}/complete`, json(body)),
  reopenMemory: (id: string) =>
    request<Memory>(`/api/memories/${id}/reopen`, { method: 'POST' }),
  reviewPromises: () =>
    request<{ checked: boolean; reason?: string; completed: Memory[]; error?: string }>(
      '/api/memories/review-promises',
      { method: 'POST' }
    ),
  importMemories: (body: unknown) =>
    request<MemoryImportResult>('/api/memories/import', json(body)),
  memoryExportUrl: '/api/memories/export',
  summarize: () =>
    request<{ ok: boolean; result: { created: number; summary: string } | null }>(
      '/api/memories/summarize',
      { method: 'POST' }
    ),
  agreements: () => request<AgreementsView>('/api/agreements'),
  createAgreement: (body: { title?: string; content: string; dueAt?: number | null }) =>
    request<{ agreement: Agreement; deduplicated: boolean }>('/api/agreements', json(body)),
  updateAgreement: (
    id: string,
    body: { title?: string; content: string; dueAt?: number | null }
  ) => request<Agreement>(`/api/agreements/${id}`, { ...json(body), method: 'PUT' }),
  completeAgreement: (id: string, reason?: string) =>
    request<Agreement>(`/api/agreements/${id}/complete`, json({ reason })),
  reopenAgreement: (id: string) =>
    request<Agreement>(`/api/agreements/${id}/reopen`, { method: 'POST' }),
  archiveAgreement: (id: string) =>
    request<Agreement>(`/api/agreements/${id}/archive`, { method: 'POST' }),
  pauseAgreement: (id: string, days = 7) =>
    request<Agreement>(`/api/agreements/${id}/pause`, json({ days })),
  resumeAgreement: (id: string) =>
    request<Agreement>(`/api/agreements/${id}/resume`, { method: 'POST' }),
  reviews: () => request<WeeklyReviewView>('/api/reviews'),
  generateReview: (weekStart?: string) =>
    request<WeeklyReview>('/api/reviews/generate', json({ weekStart })),
  learning: () => request<LearningView>('/api/learning'),
  leisure: () => request<LeisureView>('/api/leisure'),
  runLeisure: (force = false) =>
    request<{
      started: boolean;
      reason: string;
      session?: LeisureSession;
      view?: LeisureView;
    }>('/api/leisure/run', json({ force })),
  computer: () => request<ComputerView>('/api/computer'),
  saveComputer: (input: {
    enabled: boolean;
    agreed: boolean;
    allowOpenUrls: boolean;
    dailyLimit: number;
    allowedApps: { id?: string; label?: string; path: string }[];
  }) => request<ComputerSettings>('/api/computer', { ...json(input), method: 'PUT' }),
  decideComputer: (id: string, approve: boolean) =>
    request<ComputerRequest>(`/api/computer/requests/${id}/decide`, json({ approve })),
  screen: () => request<ScreenView>('/api/screen'),
  saveScreen: (input: {
    enabled?: boolean;
    consent?: boolean;
    intervalMin?: number;
    probability?: number;
    dailyCap?: number;
    allowVision?: boolean;
  }) => request<ScreenSettings>('/api/screen', { ...json(input), method: 'PATCH' }),
  peekScreen: () => request<ScreenPeekResult>('/api/screen/peek', { method: 'POST' }),
  deleteScreenObservation: (id: string) =>
    request<{ ok: boolean }>(`/api/screen/observations/${id}`, { method: 'DELETE' }),
  clearScreenObservations: () =>
    request<{ cleared: number }>('/api/screen/observations', { method: 'DELETE' }),
  live: () => request<LiveAssistantView>('/api/live'),
  installLive: (installed: boolean) =>
    request<LiveAssistantView>('/api/live/install', json({ installed })),
  saveLive: (input: {
    enabled?: boolean;
    roomId?: string;
    streamerName?: string;
    cookie?: string;
    cookieFields?: LiveCookieFields;
    clearCookie?: boolean;
    autoReply?: boolean;
    replyMode?: 'suggest' | 'send';
    autoReplyCooldownSec?: number;
    maxPerMinute?: number;
    maxReplyChars?: number;
    replyToGifts?: boolean;
    moderationHints?: boolean;
    learnFromDanmaku?: boolean;
  }) => request<LiveAssistantView>('/api/live', { ...json(input), method: 'PATCH' }),
  startLive: (roomId?: string) =>
    request<LiveAssistantView>('/api/live/start', json({ roomId })),
  stopLive: () => request<LiveAssistantView>('/api/live/stop', { method: 'POST' }),
  replyLiveEvent: (eventId: string) =>
    request<LiveReply>(`/api/live/events/${eventId}/reply`, { method: 'POST' }),
  sendLiveReply: (replyId: string) =>
    request<LiveReply>(`/api/live/replies/${replyId}/send`, { method: 'POST' }),
  sendLiveText: (text: string) =>
    request<LiveReply>('/api/live/send', json({ text })),
  clearLiveHistory: () =>
    request<{ ok: boolean }>('/api/live/history', { method: 'DELETE' }),
  clearLiveKnowledge: () =>
    request<{ ok: boolean }>('/api/live/knowledge', { method: 'DELETE' }),
  learnLiveNow: () => request<LiveAssistantView>('/api/live/learn', { method: 'POST' }),
  appearance: () => request<AppearanceView>('/api/appearance'),
  addWardrobeItem: (input: {
    name: string;
    description?: string;
    tags?: string[];
    imageDataUrl?: string;
  }) =>
    request<WardrobeItem>('/api/appearance/wardrobe', json(input)),
  deleteWardrobeItem: (id: string) =>
    request<{ ok: boolean }>(`/api/appearance/wardrobe/${id}`, { method: 'DELETE' }),
  rerollOutfit: () =>
    request<AppearanceView>('/api/appearance/outfit/reroll', { method: 'POST' }),
  selectOutfit: (itemId: string) =>
    request<AppearanceView>('/api/appearance/outfit/select', json({ itemId })),
  generateAppearanceImage: (input: { prompt?: string; source?: string }) =>
    request<{ image: GeneratedImage; view: AppearanceView }>(
      '/api/appearance/generate',
      json(input)
    ),
  deleteGeneratedImage: (id: string) =>
    request<{ ok: boolean }>(`/api/appearance/images/${id}`, { method: 'DELETE' }),
  runLearning: (force = false) =>
    request<{
      started: boolean;
      reason: string;
      session?: LearningSession;
      interest?: Interest;
      candidates?: LearningCandidate[];
      view?: LearningView;
    }>('/api/learning/run', json({ force })),
  relationship: () =>
    request<{
      relationship: Relationship;
      events: { id: string; delta: number; reason: string; source: string; createdAt: number }[];
      stages: string[];
      intimacy: {
        explicitThreshold: number;
        softRefusalThreshold: number;
        explicitAllowed: boolean;
      };
    }>('/api/relationship'),
  updateRelationship: (body: unknown) =>
    request<Relationship>('/api/relationship', { method: 'PATCH', body: JSON.stringify(body) }),
  proactive: () =>
    request<{
      records: ProactiveRecord[];
      candidates: { id: string; type: string; reason: string; score: number; allowed: boolean; blockedBy: string[]; createdAt: number }[];
      events: ProactiveEvent[];
      stats: { sentToday: number; sentTotal: number; skippedToday: number; lastSentAt: number | null };
    }>('/api/proactive'),
  runProactive: (force = false) =>
    request<{ sent: boolean; reason: string; candidate?: { type: string; reason: string }; message?: Message }>(
      '/api/proactive/run',
      json({ force })
    ),
  markProactiveDelivered: (id: string) =>
    request<ProactiveRecord | null>(`/api/proactive/${id}/delivered`, { method: 'POST' }),
  diary: (date?: string) =>
    request<{ date: string; diary: DiaryEntry | null }>(
      `/api/diary${date ? `?date=${encodeURIComponent(date)}` : ''}`
    ),
  generateDiary: (date?: string, force = false) =>
    request<DiaryEntry>('/api/diary/generate', json({ date, force })),
  dreams: (limit = 10) => request<{ dreams: Dream[] }>(`/api/dreams?limit=${limit}`),
  generateDream: () => request<Dream>('/api/dreams/generate', { method: 'POST' }),
  dates: () => request<{ dates: ImportantDate[] }>('/api/dates'),
  createDate: (body: unknown) => request<ImportantDate>('/api/dates', json(body)),
  deleteDate: (id: string) => request<{ ok: boolean }>(`/api/dates/${id}`, { method: 'DELETE' }),
  notes: () => request<{ notes: Note[] }>('/api/notes'),
  createNote: (body: unknown) => request<Note>('/api/notes', json(body)),
  updateNote: (id: string, body: unknown) =>
    request<Note>(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNote: (id: string) => request<{ ok: boolean }>(`/api/notes/${id}`, { method: 'DELETE' }),
  settings: () => request<PublicSettings>('/api/settings'),
  saveSettings: (patch: unknown) =>
    request<PublicSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  clearApiKey: (
    scope: 'provider' | 'embedding' | 'rerank' | 'vision' | 'voice' | 'image' =
      'provider'
  ) => request<PublicSettings>('/api/settings/clear-key', json({ scope })),
  testVoice: (input: { text?: string; voice?: unknown }) =>
    request<{ ok: boolean; url: string; latencyMs: number; message: string }>(
      '/api/settings/test-voice',
      json(input)
    ),
  testEmbedding: (embedding?: unknown) =>
    request<{ ok: boolean; dimensions?: number; latencyMs?: number; message?: string }>(
      '/api/settings/test-embedding',
      json({ embedding })
    ),
  testRerank: (rerank?: unknown) =>
    request<{ ok: boolean; scores?: number[]; latencyMs?: number; message?: string }>(
      '/api/settings/test-rerank',
      json({ rerank })
    ),
  testProvider: (provider?: unknown) =>
    request<{ ok: boolean; demo?: boolean; text?: string; model?: string; latencyMs?: number; message?: string }>(
      '/api/settings/test',
      json({ provider })
    ),
  geocode: (city: string) =>
    request<{ name: string; latitude: number; longitude: number; country?: string }>(
      '/api/settings/geocode',
      json({ city })
    ),
  character: () => request<Character>('/api/character'),
  saveCharacter: (body: unknown) =>
    request<Character>('/api/character', { method: 'PUT', body: JSON.stringify(body) }),
  importCharacter: (card: unknown, avatarDataUrl?: string) =>
    request<Character>('/api/character/import', json({ card, avatarDataUrl })),
  uploadAvatar: (dataUrl: string) =>
    request<{ avatarUrl: string }>('/api/character/avatar', json({ dataUrl })),
  addCharacterReference: (dataUrl: string, caption: string) =>
    request<CharacterReference>('/api/character/references', json({ dataUrl, caption })),
  deleteCharacterReference: (id: string) =>
    request<{ ok: boolean }>(`/api/character/references/${id}`, { method: 'DELETE' }),
  stats: () => request<any>('/api/stats')
};

export interface StreamHandlers {
  onStatus?: (text: string) => void;
  onMeta?: (data: ChatStreamMeta) => void;
  onDelta?: (text: string) => void;
  onDone?: (data: ChatDone) => void;
  onError?: (message: string, detail?: string) => void;
}

export async function streamChat(
  text: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  attachmentIds: string[] = []
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, attachmentIds }),
    signal
  });
  if (!response.ok || !response.body) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json();
      message = data.error ?? message;
    } catch {
      // ignore
    }
    handlers.onError?.(message);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = raw.split('\n');
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) {
        try {
          const data = JSON.parse(dataLines.join('\n'));
          if (event === 'status') handlers.onStatus?.(data.text ?? '');
          else if (event === 'meta') handlers.onMeta?.(data);
          else if (event === 'delta') handlers.onDelta?.(data.text ?? '');
          else if (event === 'done') handlers.onDone?.(data);
          else if (event === 'error') handlers.onError?.(data.message ?? '生成失败', data.detail);
        } catch {
          // Ignore malformed event.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export type LiveEvent = {
  type: string;
  data: any;
};

export function connectLive(onEvent: (event: LiveEvent) => void): () => void {
  const source = new EventSource('/api/events/stream');
  const types = [
    'state',
    'message',
    'message_voice',
    'messages_cleared',
    'proactive',
    'relationship',
    'memory',
    'memory_summary',
    'schedule',
    'life_event',
    'diary',
    'dream',
    'screen_observation',
    'live_event',
    'live_reply',
    'live_status',
    'live_knowledge',
    'outfit_photo',
    'weekly_review'
  ];
  const listeners: { type: string; fn: (event: MessageEvent) => void }[] = [];
  for (const type of types) {
    const fn = (event: MessageEvent) => {
      try {
        onEvent({ type, data: JSON.parse(event.data) });
      } catch {
        // ignore
      }
    };
    source.addEventListener(type, fn);
    listeners.push({ type, fn });
  }
  return () => {
    for (const listener of listeners) {
      source.removeEventListener(listener.type, listener.fn);
    }
    source.close();
  };
}

export type { Weather, LifeEvent };
