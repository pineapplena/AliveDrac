import type { AppSettings, PublicSettings } from '../shared/types.js';
import { cloneDefaults, DEFAULT_SETTINGS } from './defaults.js';
import { db } from './db.js';
import { safeTimeZone } from './time.js';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out = Array.isArray(base) ? ([...base] as T) : ({ ...base } as T);
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof base[key] === 'object'
    ) {
      out[key] = merge(base[key], value as DeepPartial<T[keyof T]>) as T[keyof T];
    } else {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function validQuiet(value: string, fallback: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function normalize(input: AppSettings): AppSettings {
  const s = structuredClone(input);
  s.provider.baseUrl = s.provider.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.provider.baseUrl;
  s.provider.model = s.provider.model.trim() || DEFAULT_SETTINGS.provider.model;
  s.provider.temperature = clamp(Number(s.provider.temperature), 0, 2, 0.95);
  s.provider.maxTokens = Math.round(clamp(Number(s.provider.maxTokens), 128, 4096, 900));
  s.provider.apiKey = String(s.provider.apiKey ?? '').trim();
  s.provider.mock = Boolean(s.provider.mock);
  s.user.timezone = safeTimeZone(s.user.timezone);
  s.user.name = String(s.user.name || '你').slice(0, 40);
  s.user.nickname = String(s.user.nickname ?? '').slice(0, 40);
  s.chatAvatarSource = s.chatAvatarSource === 'outfit' ? 'outfit' : 'character';
  s.notifications.enabled = Boolean(s.notifications.enabled);
  s.notifications.onlyWhenHidden = s.notifications.onlyWhenHidden !== false;
  s.weeklyReview.enabled = Boolean(s.weeklyReview.enabled);
  s.weeklyReview.weekday = Math.round(clamp(Number(s.weeklyReview.weekday), 0, 6, 0));
  s.weeklyReview.time = validQuiet(s.weeklyReview.time, '21:00');
  s.weeklyReview.notify = s.weeklyReview.notify !== false;
  s.life.city = String(s.life.city || '上海').slice(0, 40);
  s.life.latitude = clamp(Number(s.life.latitude), -90, 90, 31.2304);
  s.life.longitude = clamp(Number(s.life.longitude), -180, 180, 121.4737);
  s.life.weatherEnabled = Boolean(s.life.weatherEnabled);
  s.life.autoSchedule = Boolean(s.life.autoSchedule);
  s.life.proactiveMicroEvents = Boolean(s.life.proactiveMicroEvents);
  s.proactive.enabled = Boolean(s.proactive.enabled);
  s.proactive.minIntervalMin = Math.round(clamp(Number(s.proactive.minIntervalMin), 30, 1440, 180));
  s.proactive.dailyCap = Math.round(clamp(Number(s.proactive.dailyCap), 0, 12, 3));
  s.proactive.quietStart = validQuiet(s.proactive.quietStart, '23:30');
  s.proactive.quietEnd = validQuiet(s.proactive.quietEnd, '08:00');
  s.proactive.idleMin = Math.round(clamp(Number(s.proactive.idleMin), 15, 1440, 90));
  s.memory.enabled = Boolean(s.memory.enabled);
  s.memory.summarizeEvery = Math.round(clamp(Number(s.memory.summarizeEvery), 4, 40, 10));
  s.memory.topK = Math.round(clamp(Number(s.memory.topK), 3, 20, 6));
  s.memory.decayEnabled = Boolean(s.memory.decayEnabled);
  s.memory.embedding.enabled = Boolean(s.memory.embedding.enabled);
  s.memory.embedding.baseUrl =
    s.memory.embedding.baseUrl.trim().replace(/\/+$/, '') ||
    DEFAULT_SETTINGS.memory.embedding.baseUrl;
  s.memory.embedding.model =
    s.memory.embedding.model.trim() || DEFAULT_SETTINGS.memory.embedding.model;
  s.memory.embedding.apiKey = String(s.memory.embedding.apiKey ?? '').trim();
  s.memory.embedding.batchSize = Math.round(
    clamp(Number(s.memory.embedding.batchSize), 1, 64, 16)
  );
  s.memory.rerank.enabled = Boolean(s.memory.rerank.enabled);
  s.memory.rerank.baseUrl =
    s.memory.rerank.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.memory.rerank.baseUrl;
  s.memory.rerank.model =
    s.memory.rerank.model.trim() || DEFAULT_SETTINGS.memory.rerank.model;
  s.memory.rerank.apiKey = String(s.memory.rerank.apiKey ?? '').trim();
  s.memory.rerank.topN = Math.round(clamp(Number(s.memory.rerank.topN), 3, 30, 10));
  s.vision.enabled = Boolean(s.vision.enabled);
  s.vision.baseUrl =
    s.vision.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.vision.baseUrl;
  s.vision.model = s.vision.model.trim() || DEFAULT_SETTINGS.vision.model;
  s.vision.apiKey = String(s.vision.apiKey ?? '').trim();
  s.vision.maxTokens = Math.round(clamp(Number(s.vision.maxTokens), 512, 4096, 2000));
  if (/deepseek/i.test(s.vision.baseUrl) || /deepseek/i.test(s.vision.model)) {
    // DeepSeek Flash's hidden reasoning can consume the whole output budget.
    s.vision.maxTokens = Math.max(2000, s.vision.maxTokens);
  }
  s.learning.enabled = Boolean(s.learning.enabled);
  s.learning.dailySessions = Math.round(clamp(Number(s.learning.dailySessions), 0, 4, 1));
  s.learning.minGapMin = Math.round(clamp(Number(s.learning.minGapMin), 30, 1440, 240));
  s.learning.maxMinutes = Math.round(clamp(Number(s.learning.maxMinutes), 10, 120, 40));
  s.learning.researchEnabled = Boolean(s.learning.researchEnabled);
  s.learning.videoEnabled = Boolean(s.learning.videoEnabled);

  s.leisure.enabled = Boolean(s.leisure.enabled);
  s.leisure.dailyChoices = Math.round(clamp(Number(s.leisure.dailyChoices), 0, 4, 1));
  s.leisure.minGapMin = Math.round(clamp(Number(s.leisure.minGapMin), 30, 1440, 180));
  s.leisure.allowOvertime = Boolean(s.leisure.allowOvertime);
  s.leisure.onlineEnabled = Boolean(s.leisure.onlineEnabled);
  s.leisure.maxMinutes = Math.round(clamp(Number(s.leisure.maxMinutes), 5, 120, 30));

  s.computer.enabled = Boolean(s.computer.enabled);
  s.computer.consentAt = s.computer.consentAt ? Number(s.computer.consentAt) : null;
  s.computer.consentVersion = Number(s.computer.consentVersion ?? 1);
  s.computer.allowOpenUrls = Boolean(s.computer.allowOpenUrls);
  s.computer.dailyLimit = Math.round(clamp(Number(s.computer.dailyLimit), 1, 10, 3));
  if (!s.computer.consentAt) s.computer.enabled = false;
  s.computer.allowedApps = Array.isArray(s.computer.allowedApps)
    ? s.computer.allowedApps
        .filter(
          (app: any) =>
            app &&
            typeof app.path === 'string' &&
            app.path.toLowerCase().endsWith('.exe') &&
            app.path.length < 500
        )
        .slice(0, 12)
        .map((app: any) => ({
          id: String(app.id ?? crypto.randomUUID()),
          label: String(app.label ?? '程序').slice(0, 60),
          path: String(app.path),
          addedAt: Number(app.addedAt ?? Date.now())
        }))
    : [];
  s.screen.enabled = Boolean(s.screen.enabled);
  s.screen.consentAt = s.screen.consentAt ? Number(s.screen.consentAt) : null;
  s.screen.consentVersion = Number(s.screen.consentVersion ?? 1);
  s.screen.intervalMin = Math.round(clamp(Number(s.screen.intervalMin), 10, 120, 30));
  s.screen.probability = clamp(Number(s.screen.probability), 0.05, 0.9, 0.35);
  s.screen.dailyCap = Math.round(clamp(Number(s.screen.dailyCap), 1, 12, 6));
  s.screen.allowVision = Boolean(s.screen.allowVision);
  if (!s.screen.consentAt) s.screen.enabled = false;
  s.liveAssistant.installed = Boolean(s.liveAssistant.installed);
  s.liveAssistant.installedAt = s.liveAssistant.installedAt
    ? Number(s.liveAssistant.installedAt)
    : null;
  s.liveAssistant.enabled = Boolean(s.liveAssistant.enabled);
  s.liveAssistant.roomId = String(s.liveAssistant.roomId ?? '')
    .replace(/\D/g, '')
    .slice(0, 20);
  s.liveAssistant.streamerName = String(s.liveAssistant.streamerName ?? '').slice(0, 40);
  s.liveAssistant.cookie = String(s.liveAssistant.cookie ?? '').trim().slice(0, 2000);
  s.liveAssistant.autoReply = Boolean(s.liveAssistant.autoReply);
  s.liveAssistant.replyMode = s.liveAssistant.replyMode === 'send' ? 'send' : 'suggest';
  s.liveAssistant.autoReplyCooldownSec = Math.round(
    clamp(Number(s.liveAssistant.autoReplyCooldownSec), 5, 300, 20)
  );
  s.liveAssistant.maxPerMinute = Math.round(
    clamp(Number(s.liveAssistant.maxPerMinute), 0, 30, 6)
  );
  s.liveAssistant.maxReplyChars = Math.round(
    clamp(Number(s.liveAssistant.maxReplyChars), 10, 200, 80)
  );
  s.liveAssistant.replyToGifts = Boolean(s.liveAssistant.replyToGifts);
  s.liveAssistant.moderationHints = Boolean(s.liveAssistant.moderationHints);
  s.liveAssistant.learnFromDanmaku = s.liveAssistant.learnFromDanmaku !== false;
  if (!s.liveAssistant.installed) s.liveAssistant.enabled = false;
  s.voice.enabled = Boolean(s.voice.enabled);
  s.voice.baseUrl =
    s.voice.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.voice.baseUrl;
  s.voice.apiKey = String(s.voice.apiKey ?? '').trim();
  s.voice.model = s.voice.model.trim() || DEFAULT_SETTINGS.voice.model;
  s.voice.voiceId = String(s.voice.voiceId ?? '').trim().slice(0, 120);
  s.voice.speed = clamp(Number(s.voice.speed), 0.5, 2, 1);
  s.voice.probability = clamp(Number(s.voice.probability), 0, 1, 0.3);
  s.voice.maxChars = Math.round(clamp(Number(s.voice.maxChars), 20, 300, 120));
  s.voice.autoplay = Boolean(s.voice.autoplay);
  s.image.enabled = Boolean(s.image.enabled);
  s.image.baseUrl = s.image.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.image.baseUrl;
  s.image.apiKey = String(s.image.apiKey ?? '').trim();
  s.image.model = s.image.model.trim() || DEFAULT_SETTINGS.image.model;
  s.image.size = String(s.image.size ?? '').trim().slice(0, 32) || DEFAULT_SETTINGS.image.size;
  s.image.quality = String(s.image.quality ?? '').trim().slice(0, 32);
  s.image.stylePrompt = String(s.image.stylePrompt ?? '').trim().slice(0, 800);
  s.image.identityPrompt = String(s.image.identityPrompt ?? '').trim().slice(0, 1200);
  s.image.maxPerDay = Math.round(clamp(Number(s.image.maxPerDay), 1, 100, 12));
  s.image.useReferences = s.image.useReferences !== false;
  s.image.autoMorningPhoto = s.image.autoMorningPhoto !== false;
  return s;
}

export function getSettings(): AppSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    const defaults = cloneDefaults();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(
      JSON.stringify(defaults)
    );
    return defaults;
  }
  try {
    const stored = JSON.parse(row.value) as DeepPartial<AppSettings>;
    return normalize(merge(cloneDefaults(), stored));
  } catch {
    return cloneDefaults();
  }
}

export function saveSettings(patch: DeepPartial<AppSettings>): AppSettings {
  const next = normalize(merge(getSettings(), patch));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(
    JSON.stringify(next)
  );
  return next;
}

export function publicSettings(): PublicSettings {
  const s = getSettings();
  const { apiKey, ...provider } = s.provider;
  const { apiKey: embeddingKey, ...embedding } = s.memory.embedding;
  const { apiKey: rerankKey, ...rerank } = s.memory.rerank;
  const { embedding: _embedding, rerank: _rerank, ...memory } = s.memory;
  const { apiKey: visionKey, ...vision } = s.vision;
  const { apiKey: voiceKey, ...voice } = s.voice;
  const { apiKey: imageKey, ...image } = s.image;
  const { cookie: liveCookie, ...liveAssistant } = s.liveAssistant;
  const hasCookieKey = (name: string): boolean =>
    new RegExp(`(?:^|;\\s*)${name}=`, 'i').test(liveCookie);
  const { computer: _computer, ...rest } = s;
  return {
    ...rest,
    provider: {
      ...provider,
      hasApiKey: Boolean(apiKey)
    },
    memory: {
      ...memory,
      embedding: {
        ...embedding,
        hasApiKey: Boolean(embeddingKey)
      },
      rerank: {
        ...rerank,
        hasApiKey: Boolean(rerankKey)
      }
    },
    vision: {
      ...vision,
      hasApiKey: Boolean(visionKey)
    },
    voice: {
      ...voice,
      hasApiKey: Boolean(voiceKey)
    },
    image: {
      ...image,
      hasApiKey: Boolean(imageKey)
    },
    liveAssistant: {
      ...liveAssistant,
      hasCookie: Boolean(liveCookie),
      hasSessdata: hasCookieKey('SESSDATA'),
      hasBiliJct: hasCookieKey('bili_jct'),
      hasBuvid3: hasCookieKey('buvid3'),
      hasBuvid4: hasCookieKey('buvid4'),
      hasDedeUserId: hasCookieKey('DedeUserID')
    }
  };
}

export function llmConfigured(): boolean {
  const s = getSettings();
  return Boolean(s.provider.apiKey) && !s.provider.mock;
}

export function isDemo(): boolean {
  return !llmConfigured();
}
