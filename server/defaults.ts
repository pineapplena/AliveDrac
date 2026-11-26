import type { AppSettings } from '../shared/types.js';

export const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    baseUrl: process.env.ALIVE_LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    model: process.env.ALIVE_LLM_MODEL ?? 'deepseek-chat',
    temperature: 0.95,
    maxTokens: 900,
    mock: false
  },
  user: {
    name: '你',
    nickname: '',
    timezone: 'Asia/Shanghai'
  },
  chatAvatarSource: 'character',
  notifications: {
    enabled: false,
    onlyWhenHidden: true
  },
  weeklyReview: {
    enabled: true,
    weekday: 0,
    time: '21:00',
    notify: true
  },
  life: {
    city: '上海',
    latitude: 31.2304,
    longitude: 121.4737,
    weatherEnabled: true,
    autoSchedule: true,
    proactiveMicroEvents: true
  },
  proactive: {
    enabled: true,
    minIntervalMin: 180,
    dailyCap: 3,
    quietStart: '23:30',
    quietEnd: '08:00',
    idleMin: 90
  },
  memory: {
    enabled: true,
    summarizeEvery: 10,
    topK: 6,
    decayEnabled: true,
    embedding: {
      enabled: false,
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'BAAI/bge-m3',
      batchSize: 16
    },
    rerank: {
      enabled: false,
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'BAAI/bge-reranker-v2-m3',
      topN: 10
    }
  },
  vision: {
    enabled: true,
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-flash',
    maxTokens: 2000
  },
  learning: {
    enabled: true,
    dailySessions: 1,
    minGapMin: 240,
    maxMinutes: 40,
    researchEnabled: false,
    videoEnabled: true
  },
  leisure: {
    enabled: true,
    dailyChoices: 1,
    minGapMin: 180,
    allowOvertime: true,
    onlineEnabled: false,
    maxMinutes: 30
  },
  computer: {
    enabled: false,
    consentAt: null,
    consentVersion: 1,
    allowOpenUrls: true,
    allowedApps: [],
    dailyLimit: 3
  },
  screen: {
    enabled: false,
    consentAt: null,
    consentVersion: 1,
    intervalMin: 30,
    probability: 0.35,
    dailyCap: 6,
    allowVision: true
  },
  liveAssistant: {
    installed: false,
    installedAt: null,
    enabled: false,
    roomId: '',
    streamerName: '',
    cookie: '',
    autoReply: false,
    replyMode: 'suggest',
    autoReplyCooldownSec: 20,
    maxPerMinute: 6,
    maxReplyChars: 80,
    replyToGifts: true,
    moderationHints: true,
    learnFromDanmaku: true
  },
  voice: {
    enabled: false,
    baseUrl: 'https://api.stepfun.com/v1',
    apiKey: '',
    model: 'step-tts-mini',
    voiceId: '',
    speed: 1,
    probability: 0.3,
    maxChars: 120,
    autoplay: false
  },
  image: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: '',
    stylePrompt: '动漫插画，柔和自然光，干净的构图，角色外貌保持一致。',
    identityPrompt: '',
    maxPerDay: 12,
    useReferences: true,
    autoMorningPhoto: true
  }
};

export function cloneDefaults(): AppSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings;
}
