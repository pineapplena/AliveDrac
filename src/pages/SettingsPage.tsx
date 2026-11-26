import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BookMarked,
  Brain,
  Check,
  ChevronRight,
  Cloud,
  Database,
  Download,
  Monitor,
  Popcorn,
  Eye,
  HeartPulse,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  MapPin,
  Plus,
  Puzzle,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  Wand2,
  Zap
} from 'lucide-react';
import type {
  Character,
  LorebookEntry,
  MemoryIndexStats,
  PublicSettings
} from '../../shared/types';
import { api } from '../api';
import {
  notificationPermission,
  requestNotificationPermission,
  showDesktopNotification
} from '../notifications';
import { Avatar } from '../components/Avatar';
import { ComputerPanel } from '../components/ComputerPanel';
import type { ToastKind } from '../components/Toast';
import { parseCardFile, readFileAsDataUrl } from '../lib/card';
import { cn } from '../utils';

interface Props {
  character: Character;
  settings: PublicSettings;
  demo: boolean;
  onChanged: (next?: { character?: Character; settings?: PublicSettings }) => Promise<void>;
  onToast: (message: string, kind?: ToastKind) => void;
}

type Tab =
  | 'model'
  | 'character'
  | 'life'
  | 'proactive'
  | 'memory'
  | 'voice'
  | 'image'
  | 'computer'
  | 'notifications'
  | 'extensions'
  | 'data';

const CANDIDATE_LABELS: Record<string, string> = {
  schedule_share: '日程里的小事',
  open_loop: '未完成的事',
  important_date: '重要日子',
  weather_change: '天气变化',
  idle_share: '隔了一阵子',
  spontaneous: '忽然想说',
  reminder: '便签提醒',
  learning_share: '学到的东西',
  leisure_share: '放松时的小事'
};

const PROACTIVE_STATUS_LABELS: Record<string, string> = {
  sent: '已发送',
  delivered: '已送达',
  read: '已读',
  replied: '已回应',
  ignored: '未回应',
  expired: '已过期',
  skipped: '已跳过',
  failed: '失败',
  candidate: '候选'
};

const PROACTIVE_EVENT_LABELS: Record<string, string> = {
  discovered: '刚发现',
  blocked: '被拦住',
  eligible: '等待发送',
  selected: '已选中',
  generating: '生成中',
  sent: '已发送',
  delivered: '已送达',
  read: '已读',
  replied: '已回应',
  ignored: '未回应',
  failed: '失败',
  expired: '已过期'
};

const TABS: { id: Tab; label: string; icon: typeof Settings2 }[] = [
  { id: 'model', label: '模型', icon: Zap },
  { id: 'character', label: '角色', icon: BookMarked },
  { id: 'life', label: '生活与称呼', icon: HeartPulse },
  { id: 'proactive', label: '主动消息', icon: Sparkles },
  { id: 'memory', label: '记忆与语义', icon: Brain },
  { id: 'voice', label: '语音', icon: Volume2 },
  { id: 'image', label: '生图', icon: ImageIcon },
  { id: 'computer', label: '电脑', icon: Monitor },
  { id: 'notifications', label: '通知与回顾', icon: Bell },
  { id: 'extensions', label: '扩展', icon: Puzzle },
  { id: 'data', label: '数据', icon: Database }
];

interface LoreDraft {
  keys: string;
  content: string;
  enabled: boolean;
  constant: boolean;
  insertionOrder: number;
}

export function SettingsPage({ character, settings, demo, onChanged, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('model');

  const [provider, setProvider] = useState({
    baseUrl: settings.provider.baseUrl,
    model: settings.provider.model,
    apiKey: '',
    temperature: settings.provider.temperature,
    maxTokens: settings.provider.maxTokens
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);

  const [visionForm, setVisionForm] = useState({
    enabled: settings.vision.enabled,
    baseUrl: settings.vision.baseUrl,
    model: settings.vision.model,
    apiKey: '',
    maxTokens: settings.vision.maxTokens
  });
  const [savingVision, setSavingVision] = useState(false);

  const [voiceForm, setVoiceForm] = useState({
    enabled: settings.voice.enabled,
    baseUrl: settings.voice.baseUrl,
    model: settings.voice.model,
    voiceId: settings.voice.voiceId,
    apiKey: '',
    speed: settings.voice.speed,
    probability: settings.voice.probability,
    maxChars: settings.voice.maxChars,
    autoplay: settings.voice.autoplay,
    hasApiKey: settings.voice.hasApiKey
  });
  const [savingVoice, setSavingVoice] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voiceTestUrl, setVoiceTestUrl] = useState<string | null>(null);

  const [imageForm, setImageForm] = useState({
    enabled: settings.image.enabled,
    baseUrl: settings.image.baseUrl,
    model: settings.image.model,
    apiKey: '',
    size: settings.image.size,
    quality: settings.image.quality,
    stylePrompt: settings.image.stylePrompt,
    identityPrompt: settings.image.identityPrompt,
    maxPerDay: settings.image.maxPerDay,
    hasApiKey: settings.image.hasApiKey,
    useReferences: settings.image.useReferences,
    autoMorningPhoto: settings.image.autoMorningPhoto
  });
  const [savingImage, setSavingImage] = useState(false);

  const [profile, setProfile] = useState({
    name: settings.user.name,
    nickname: settings.user.nickname,
    timezone: settings.user.timezone,
    city: settings.life.city,
    latitude: settings.life.latitude,
    longitude: settings.life.longitude,
    weatherEnabled: settings.life.weatherEnabled,
    autoSchedule: settings.life.autoSchedule,
    microEvents: settings.life.proactiveMicroEvents
  });
  const [savingLife, setSavingLife] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [learningForm, setLearningForm] = useState({
    enabled: settings.learning.enabled,
    dailySessions: settings.learning.dailySessions,
    minGapMin: settings.learning.minGapMin,
    maxMinutes: settings.learning.maxMinutes,
    researchEnabled: settings.learning.researchEnabled,
    videoEnabled: settings.learning.videoEnabled
  });
  const [savingLearning, setSavingLearning] = useState(false);
  const [installingLive, setInstallingLive] = useState(false);
  const [leisureForm, setLeisureForm] = useState({
    enabled: settings.leisure.enabled,
    dailyChoices: settings.leisure.dailyChoices,
    minGapMin: settings.leisure.minGapMin,
    allowOvertime: settings.leisure.allowOvertime,
    onlineEnabled: settings.leisure.onlineEnabled,
    maxMinutes: settings.leisure.maxMinutes
  });
  const [savingLeisure, setSavingLeisure] = useState(false);

  const [proactive, setProactive] = useState({
    enabled: settings.proactive.enabled,
    minIntervalMin: settings.proactive.minIntervalMin,
    dailyCap: settings.proactive.dailyCap,
    quietStart: settings.proactive.quietStart,
    quietEnd: settings.proactive.quietEnd,
    idleMin: settings.proactive.idleMin
  });
  const [savingProactive, setSavingProactive] = useState(false);
  const [testingProactive, setTestingProactive] = useState(false);
  const [proactiveData, setProactiveData] = useState<any>(null);
  const [notificationForm, setNotificationForm] = useState({
    enabled: settings.notifications.enabled,
    onlyWhenHidden: settings.notifications.onlyWhenHidden,
    weeklyEnabled: settings.weeklyReview.enabled,
    weeklyWeekday: settings.weeklyReview.weekday,
    weeklyTime: settings.weeklyReview.time,
    weeklyNotify: settings.weeklyReview.notify
  });
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationState, setNotificationState] = useState<string>(
    notificationPermission()
  );

  const [memoryForm, setMemoryForm] = useState({
    enabled: settings.memory.enabled,
    summarizeEvery: settings.memory.summarizeEvery,
    topK: settings.memory.topK,
    decayEnabled: settings.memory.decayEnabled,
    embedding: {
      enabled: settings.memory.embedding.enabled,
      baseUrl: settings.memory.embedding.baseUrl,
      model: settings.memory.embedding.model,
      apiKey: '',
      batchSize: settings.memory.embedding.batchSize
    },
    rerank: {
      enabled: settings.memory.rerank.enabled,
      baseUrl: settings.memory.rerank.baseUrl,
      model: settings.memory.rerank.model,
      apiKey: '',
      topN: settings.memory.rerank.topN
    }
  });
  const [savingMemory, setSavingMemory] = useState(false);
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [testingRerank, setTestingRerank] = useState(false);
  const [embeddingResult, setEmbeddingResult] = useState<string | null>(null);
  const [rerankResult, setRerankResult] = useState<string | null>(null);
  const [indexStats, setIndexStats] = useState<MemoryIndexStats | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const [charForm, setCharForm] = useState({
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    firstMes: character.firstMes,
    systemPrompt: character.systemPrompt,
    postHistory: character.postHistory,
    tags: character.tags.join('，')
  });
  const [lore, setLore] = useState<LoreDraft[]>(
    character.lorebook.map((entry) => ({
      keys: entry.keys.join('，'),
      content: entry.content,
      enabled: entry.enabled,
      constant: entry.constant,
      insertionOrder: entry.insertionOrder
    }))
  );
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [addingReference, setAddingReference] = useState(false);
  const [referenceCaption, setReferenceCaption] = useState('');
  const cardInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    setProvider({
      baseUrl: settings.provider.baseUrl,
      model: settings.provider.model,
      apiKey: '',
      temperature: settings.provider.temperature,
      maxTokens: settings.provider.maxTokens
    });
    setProfile({
      name: settings.user.name,
      nickname: settings.user.nickname,
      timezone: settings.user.timezone,
      city: settings.life.city,
      latitude: settings.life.latitude,
      longitude: settings.life.longitude,
      weatherEnabled: settings.life.weatherEnabled,
      autoSchedule: settings.life.autoSchedule,
      microEvents: settings.life.proactiveMicroEvents
    });
    setProactive({
      enabled: settings.proactive.enabled,
      minIntervalMin: settings.proactive.minIntervalMin,
      dailyCap: settings.proactive.dailyCap,
      quietStart: settings.proactive.quietStart,
      quietEnd: settings.proactive.quietEnd,
      idleMin: settings.proactive.idleMin
    });
    setLearningForm({
      enabled: settings.learning.enabled,
      dailySessions: settings.learning.dailySessions,
      minGapMin: settings.learning.minGapMin,
      maxMinutes: settings.learning.maxMinutes,
      researchEnabled: settings.learning.researchEnabled,
      videoEnabled: settings.learning.videoEnabled
    });
    setLeisureForm({
      enabled: settings.leisure.enabled,
      dailyChoices: settings.leisure.dailyChoices,
      minGapMin: settings.leisure.minGapMin,
      allowOvertime: settings.leisure.allowOvertime,
      onlineEnabled: settings.leisure.onlineEnabled,
      maxMinutes: settings.leisure.maxMinutes
    });
    setVisionForm({
      enabled: settings.vision.enabled,
      baseUrl: settings.vision.baseUrl,
      model: settings.vision.model,
      apiKey: '',
      maxTokens: settings.vision.maxTokens
    });
    setVoiceForm({
      enabled: settings.voice.enabled,
      baseUrl: settings.voice.baseUrl,
      model: settings.voice.model,
      voiceId: settings.voice.voiceId,
      apiKey: '',
      speed: settings.voice.speed,
      probability: settings.voice.probability,
      maxChars: settings.voice.maxChars,
      autoplay: settings.voice.autoplay,
      hasApiKey: settings.voice.hasApiKey
    });
    setImageForm({
      enabled: settings.image.enabled,
      baseUrl: settings.image.baseUrl,
      model: settings.image.model,
      apiKey: '',
      size: settings.image.size,
      quality: settings.image.quality,
      stylePrompt: settings.image.stylePrompt,
      identityPrompt: settings.image.identityPrompt,
      maxPerDay: settings.image.maxPerDay,
      hasApiKey: settings.image.hasApiKey,
      useReferences: settings.image.useReferences,
      autoMorningPhoto: settings.image.autoMorningPhoto
    });
    setNotificationForm({
      enabled: settings.notifications.enabled,
      onlyWhenHidden: settings.notifications.onlyWhenHidden,
      weeklyEnabled: settings.weeklyReview.enabled,
      weeklyWeekday: settings.weeklyReview.weekday,
      weeklyTime: settings.weeklyReview.time,
      weeklyNotify: settings.weeklyReview.notify
    });
    setNotificationState(notificationPermission());
    setMemoryForm({
      enabled: settings.memory.enabled,
      summarizeEvery: settings.memory.summarizeEvery,
      topK: settings.memory.topK,
      decayEnabled: settings.memory.decayEnabled,
      embedding: {
        enabled: settings.memory.embedding.enabled,
        baseUrl: settings.memory.embedding.baseUrl,
        model: settings.memory.embedding.model,
        apiKey: '',
        batchSize: settings.memory.embedding.batchSize
      },
      rerank: {
        enabled: settings.memory.rerank.enabled,
        baseUrl: settings.memory.rerank.baseUrl,
        model: settings.memory.rerank.model,
        apiKey: '',
        topN: settings.memory.rerank.topN
      }
    });
  }, [settings]);

  useEffect(() => {
    setCharForm({
      name: character.name,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      firstMes: character.firstMes,
      systemPrompt: character.systemPrompt,
      postHistory: character.postHistory,
      tags: character.tags.join('，')
    });
    setLore(
      character.lorebook.map((entry) => ({
        keys: entry.keys.join('，'),
        content: entry.content,
        enabled: entry.enabled,
        constant: entry.constant,
        insertionOrder: entry.insertionOrder
      }))
    );
  }, [character]);

  useEffect(() => {
    if (tab === 'data') {
      void api
        .stats()
        .then(setStats)
        .catch(() => undefined);
    }
    if (tab === 'proactive') {
      void api
        .proactive()
        .then(setProactiveData)
        .catch(() => undefined);
    }
    if (tab === 'memory') {
      void api
        .memoryIndexStatus()
        .then(setIndexStats)
        .catch(() => undefined);
    }
  }, [tab]);

  const saveModel = async () => {
    setSavingModel(true);
    try {
      const next = await api.saveSettings({
        provider: {
          baseUrl: provider.baseUrl,
          model: provider.model,
          temperature: provider.temperature,
          maxTokens: provider.maxTokens,
          ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {})
        }
      });
      setProvider((current) => ({ ...current, apiKey: '' }));
      onToast('模型配置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingModel(false);
    }
  };

  const saveVision = async () => {
    setSavingVision(true);
    try {
      const next = await api.saveSettings({
        vision: {
          enabled: visionForm.enabled,
          baseUrl: visionForm.baseUrl,
          model: visionForm.model,
          maxTokens: visionForm.maxTokens,
          ...(visionForm.apiKey.trim() ? { apiKey: visionForm.apiKey.trim() } : {})
        }
      });
      setVisionForm((current) => ({ ...current, apiKey: '' }));
      onToast('识图配置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingVision(false);
    }
  };

  const saveVoice = async () => {
    setSavingVoice(true);
    try {
      const next = await api.saveSettings({
        voice: {
          enabled: voiceForm.enabled,
          baseUrl: voiceForm.baseUrl,
          model: voiceForm.model,
          voiceId: voiceForm.voiceId,
          speed: voiceForm.speed,
          probability: voiceForm.probability,
          maxChars: voiceForm.maxChars,
          autoplay: voiceForm.autoplay,
          ...(voiceForm.apiKey.trim() ? { apiKey: voiceForm.apiKey.trim() } : {})
        }
      });
      setVoiceForm((current) => ({
        ...current,
        apiKey: '',
        hasApiKey: next.voice.hasApiKey
      }));
      onToast('语音配置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingVoice(false);
    }
  };

  const testVoice = async () => {
    setTestingVoice(true);
    setVoiceTestUrl(null);
    try {
      const result = await api.testVoice({
        text: '唔，我在。今天感觉怎么样？',
        voice: {
          enabled: voiceForm.enabled,
          baseUrl: voiceForm.baseUrl,
          model: voiceForm.model,
          voiceId: voiceForm.voiceId,
          speed: voiceForm.speed,
          probability: voiceForm.probability,
          maxChars: voiceForm.maxChars,
          autoplay: voiceForm.autoplay,
          ...(voiceForm.apiKey.trim() ? { apiKey: voiceForm.apiKey.trim() } : {})
        }
      });
      setVoiceTestUrl(result.url);
      onToast(`语音合成正常（${result.latencyMs}ms）`, 'success');
      await onChanged();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '语音测试失败', 'error');
    } finally {
      setTestingVoice(false);
    }
  };

  const saveImage = async () => {
    setSavingImage(true);
    try {
      const next = await api.saveSettings({
        image: {
          enabled: imageForm.enabled,
          baseUrl: imageForm.baseUrl,
          model: imageForm.model,
          size: imageForm.size,
          quality: imageForm.quality,
          stylePrompt: imageForm.stylePrompt,
          identityPrompt: imageForm.identityPrompt,
          maxPerDay: imageForm.maxPerDay,
          useReferences: imageForm.useReferences,
          autoMorningPhoto: imageForm.autoMorningPhoto,
          ...(imageForm.apiKey.trim() ? { apiKey: imageForm.apiKey.trim() } : {})
        }
      });
      setImageForm((current) => ({
        ...current,
        apiKey: '',
        hasApiKey: next.image.hasApiKey
      }));
      onToast('生图配置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingImage(false);
    }
  };

  const testModel = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testProvider({
        baseUrl: provider.baseUrl,
        model: provider.model,
        temperature: provider.temperature,
        maxTokens: provider.maxTokens,
        ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {})
      });
      if (result.demo) {
        setTestResult(result.message ?? '当前是离线演示模式');
        onToast('还没有配置 API Key，当前是离线演示', 'info');
      } else if (result.ok) {
        setTestResult(`连接正常 · ${result.model} · ${result.latencyMs}ms · “${result.text}”`);
        onToast('模型连接正常', 'success');
        await onChanged();
      } else {
        setTestResult(result.message ?? '连接失败');
        onToast(result.message ?? '连接失败', 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      setTestResult(message);
      onToast(message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const saveLearning = async () => {
    setSavingLearning(true);
    try {
      const next = await api.saveSettings({ learning: learningForm });
      onToast('自主学习设置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingLearning(false);
    }
  };

  const saveLeisure = async () => {
    setSavingLeisure(true);
    try {
      const next = await api.saveSettings({ leisure: leisureForm });
      onToast('娱乐与闲暇设置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingLeisure(false);
    }
  };

  const saveLife = async () => {
    setSavingLife(true);
    try {
      const next = await api.saveSettings({
        user: {
          name: profile.name,
          nickname: profile.nickname,
          timezone: profile.timezone
        },
        life: {
          city: profile.city,
          latitude: Number(profile.latitude),
          longitude: Number(profile.longitude),
          weatherEnabled: profile.weatherEnabled,
          autoSchedule: profile.autoSchedule,
          proactiveMicroEvents: profile.microEvents
        }
      });
      onToast('生活资料保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingLife(false);
    }
  };

  const geocode = async () => {
    setGeocoding(true);
    try {
      const found = await api.geocode(profile.city);
      setProfile((current) => ({
        ...current,
        city: found.name,
        latitude: found.latitude,
        longitude: found.longitude
      }));
      onToast(`找到了 ${found.name}（${found.latitude.toFixed(2)}, ${found.longitude.toFixed(2)}）`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '定位失败', 'error');
    } finally {
      setGeocoding(false);
    }
  };

  const saveProactive = async () => {
    setSavingProactive(true);
    try {
      const next = await api.saveSettings({ proactive });
      onToast('主动消息设置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingProactive(false);
    }
  };

  const testProactive = async () => {
    setTestingProactive(true);
    try {
      const result = await api.runProactive(true);
      if (result.sent) {
        onToast('她发来了一条主动消息，去对话里看看', 'success');
      } else {
        onToast(`这次没发：${result.reason}`, 'info');
      }
      setProactiveData(await api.proactive());
    } catch (error) {
      onToast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setTestingProactive(false);
    }
  };

  const askNotificationPermission = async () => {
    const result = await requestNotificationPermission();
    setNotificationState(result);
    if (result === 'granted') onToast('桌面通知已允许', 'success');
    else if (result === 'denied') onToast('浏览器拒绝了通知权限，可以在浏览器设置里重新允许', 'info');
    else if (result === 'unsupported') onToast('当前浏览器不支持桌面通知', 'error');
  };

  const testNotification = () => {
    if (notificationPermission() !== 'granted') {
      onToast('先允许桌面通知，再测试', 'info');
      return;
    }
    showDesktopNotification('Alive', '她在这里。这是一条测试通知。', {
      icon: character.avatarUrl
    });
  };

  const saveNotifications = async () => {
    setSavingNotifications(true);
    try {
      const next = await api.saveSettings({
        notifications: {
          enabled: notificationForm.enabled,
          onlyWhenHidden: notificationForm.onlyWhenHidden
        },
        weeklyReview: {
          enabled: notificationForm.weeklyEnabled,
          weekday: notificationForm.weeklyWeekday,
          time: notificationForm.weeklyTime,
          notify: notificationForm.weeklyNotify
        }
      });
      onToast('通知与周记设置保存好了', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingNotifications(false);
    }
  };

  const saveMemory = async () => {
    setSavingMemory(true);
    try {
      const next = await api.saveSettings({
        memory: {
          enabled: memoryForm.enabled,
          summarizeEvery: memoryForm.summarizeEvery,
          topK: memoryForm.topK,
          decayEnabled: memoryForm.decayEnabled,
          embedding: {
            ...memoryForm.embedding,
            ...(memoryForm.embedding.apiKey.trim()
              ? { apiKey: memoryForm.embedding.apiKey.trim() }
              : {})
          },
          rerank: {
            ...memoryForm.rerank,
            ...(memoryForm.rerank.apiKey.trim()
              ? { apiKey: memoryForm.rerank.apiKey.trim() }
              : {})
          }
        }
      });
      setMemoryForm((current) => ({
        ...current,
        embedding: { ...current.embedding, apiKey: '' },
        rerank: { ...current.rerank, apiKey: '' }
      }));
      onToast('记忆与语义配置保存好了', 'success');
      await onChanged({ settings: next });
      setIndexStats(await api.memoryIndexStatus());
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingMemory(false);
    }
  };

  const testEmbedding = async () => {
    setTestingEmbedding(true);
    setEmbeddingResult(null);
    try {
      const result = await api.testEmbedding(memoryForm.embedding);
      if (result.ok) {
        setEmbeddingResult(`${result.message ?? '正常'} · ${result.latencyMs}ms`);
        onToast('Embedding 连接正常', 'success');
        await onChanged();
        setIndexStats(await api.memoryIndexStatus());
      } else {
        setEmbeddingResult(result.message ?? '连接失败');
        onToast(result.message ?? '连接失败', 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      setEmbeddingResult(message);
      onToast(message, 'error');
    } finally {
      setTestingEmbedding(false);
    }
  };

  const testRerank = async () => {
    setTestingRerank(true);
    setRerankResult(null);
    try {
      const result = await api.testRerank(memoryForm.rerank);
      if (result.ok) {
        setRerankResult(
          `${result.message ?? '正常'} · 分数 ${result.scores?.map((score) => score.toFixed(2)).join(' / ')} · ${result.latencyMs}ms`
        );
        onToast('Rerank 连接正常', 'success');
        await onChanged();
      } else {
        setRerankResult(result.message ?? '连接失败');
        onToast(result.message ?? '连接失败', 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      setRerankResult(message);
      onToast(message, 'error');
    } finally {
      setTestingRerank(false);
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const stats = await api.reindexMemories();
      setIndexStats(stats);
      onToast(
        stats.pending > 0
          ? `已索引 ${stats.indexed} 条，还有 ${stats.pending} 条待处理`
          : `索引完成，共 ${stats.indexed} 条`,
        stats.pending > 0 ? 'info' : 'success'
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : '重建索引失败', 'error');
    } finally {
      setReindexing(false);
    }
  };

  const clearKey = async (scope: 'embedding' | 'rerank') => {
    if (!window.confirm('清除已保存的 Key？')) return;
    try {
      const next = await api.clearApiKey(scope);
      onToast('Key 已清除', 'success');
      await onChanged({ settings: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '清除失败', 'error');
    }
  };

  const saveCharacter = async () => {
    setSavingCharacter(true);
    try {
      const next = await api.saveCharacter({
        ...charForm,
        tags: charForm.tags
          .split(/[,，、]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        lorebook: lore.map((entry) => ({
          keys: entry.keys
            .split(/[,，、]/)
            .map((key) => key.trim())
            .filter(Boolean),
          content: entry.content,
          enabled: entry.enabled,
          constant: entry.constant,
          insertionOrder: entry.insertionOrder
        }))
      });
      onToast('角色资料保存好了', 'success');
      await onChanged({ character: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingCharacter(false);
    }
  };

  const importCard = async (file: File) => {
    setImporting(true);
    try {
      const parsed = await parseCardFile(file);
      if (!window.confirm('导入会更新当前角色的设定与世界书，不会删除已有的对话和记忆。继续吗？')) {
        return;
      }
      const next = await api.importCharacter(parsed.card, parsed.avatarDataUrl);
      onToast('角色卡导入好了', 'success');
      await onChanged({ character: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '导入失败', 'error');
    } finally {
      setImporting(false);
      if (cardInputRef.current) cardInputRef.current.value = '';
    }
  };

  const uploadAvatar = async (file: File) => {
    setUploadingAvatar(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await api.uploadAvatar(dataUrl);
      const next = await api.character();
      onToast('头像换好了', 'success');
      await onChanged({ character: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '上传失败', 'error');
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const addReference = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      onToast('参考图不能超过 8MB', 'error');
      if (referenceInputRef.current) referenceInputRef.current.value = '';
      return;
    }
    setAddingReference(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await api.addCharacterReference(dataUrl, referenceCaption.trim());
      setReferenceCaption('');
      const next = await api.character();
      onToast('形象参考图添加好了', 'success');
      await onChanged({ character: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '参考图上传失败', 'error');
    } finally {
      setAddingReference(false);
      if (referenceInputRef.current) referenceInputRef.current.value = '';
    }
  };

  const removeReference = async (id: string) => {
    if (!window.confirm('删除这张形象参考图？')) return;
    try {
      await api.deleteCharacterReference(id);
      const next = await api.character();
      onToast('参考图已删除', 'success');
      await onChanged({ character: next });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  const addLore = () => {
    setLore((current) => [
      ...current,
      { keys: '', content: '', enabled: true, constant: false, insertionOrder: (current.at(-1)?.insertionOrder ?? 0) + 10 }
    ]);
  };

  const visionUsesMainKey = (() => {
    if (settings.vision.hasApiKey || !settings.provider.hasApiKey) return false;
    try {
      return (
        new URL(visionForm.baseUrl).origin === new URL(provider.baseUrl).origin
      );
    } catch {
      return false;
    }
  })();

  return (
    <div className="page-screen settings-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">设置</span>
          <h1>把她调成你的样子</h1>
          <p className="page-sub">模型决定她能不能思考，角色卡决定她是谁，生活和主动决定她怎么活。</p>
        </div>
        <div className={cn('connection-pill large', demo ? 'demo' : 'live')}>
          <span />
          {demo ? '离线演示' : settings.provider.model}
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-tabs">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn(tab === item.id && 'active')}
                onClick={() => setTab(item.id)}
              >
                <Icon size={17} />
                {item.label}
                <ChevronRight size={14} className="chev" />
              </button>
            );
          })}
        </nav>

        <div className="settings-panel">
          {tab === 'model' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">模型</span>
                  <h2>让她真正开始思考</h2>
                  <p>支持任何 OpenAI 兼容接口。配置只保存在本机的 data/alive.db 里。</p>
                </div>
              </div>

              {demo && (
                <div className="callout amber">
                  <Wand2 size={17} />
                  <div>
                    <strong>现在是离线演示模式</strong>
                    <p>她会用内置语气回应，但不会真正理解你的话。填入 API Key 并保存后，下一次对话就会切换。</p>
                  </div>
                </div>
              )}

              <div className="form-grid two">
                <label className="field full">
                  <span>API 地址</span>
                  <input
                    value={provider.baseUrl}
                    onChange={(event) => setProvider({ ...provider, baseUrl: event.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                  />
                  <small>以 /v1 结尾。DeepSeek、OpenAI、硅基流动等兼容接口都可以。</small>
                </label>
                <label className="field">
                  <span>模型名</span>
                  <input
                    value={provider.model}
                    onChange={(event) => setProvider({ ...provider, model: event.target.value })}
                    placeholder="deepseek-chat"
                  />
                </label>
                <label className="field">
                  <span>API Key {settings.provider.hasApiKey && <em className="saved-tag">已保存</em>}</span>
                  <input
                    type="password"
                    value={provider.apiKey}
                    onChange={(event) => setProvider({ ...provider, apiKey: event.target.value })}
                    placeholder={settings.provider.hasApiKey ? '留空不修改' : 'sk-…'}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  <span>温度 · {provider.temperature.toFixed(2)}</span>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={provider.temperature}
                    onChange={(event) => setProvider({ ...provider, temperature: Number(event.target.value) })}
                  />
                  <small>越高越跳脱。日常陪伴 0.85–1.0 比较合适。</small>
                </label>
                <label className="field">
                  <span>单次回复上限（Token）</span>
                  <input
                    type="number"
                    min={128}
                    max={4096}
                    value={provider.maxTokens}
                    onChange={(event) => setProvider({ ...provider, maxTokens: Number(event.target.value) })}
                  />
                </label>
              </div>

              {testResult && <div className="test-result">{testResult}</div>}

              <div className="form-actions">
                {settings.provider.hasApiKey && (
                  <button
                    className="text-button clear-key"
                    onClick={async () => {
                      if (!window.confirm('清除已保存的 API Key？之后会回到离线演示模式。')) return;
                      try {
                        const next = await api.clearApiKey();
                        onToast('API Key 已清除', 'success');
                        await onChanged({ settings: next });
                      } catch (error) {
                        onToast(error instanceof Error ? error.message : '清除失败', 'error');
                      }
                    }}
                  >
                    清除 Key
                  </button>
                )}
                <button className="button ghost" onClick={() => void testModel()} disabled={testing}>
                  {testing ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                  测试连接
                </button>
                <button className="button" onClick={() => void saveModel()} disabled={savingModel}>
                  {savingModel ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存模型配置
                </button>
              </div>

              <div className="semantic-block vision-block">
                <div className="semantic-head">
                  <div>
                    <span className="eyebrow"><Eye size={12} /> 识图模型</span>
                    <h3>让她看见你发来的图片</h3>
                    <p>
                      DeepSeek 的 <code>deepseek-flash</code> 本身支持识图，默认复用主模型的地址和 Key；
                      也可以换成任何 OpenAI 兼容的视觉模型。
                    </p>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={visionForm.enabled}
                      onChange={(event) =>
                        setVisionForm({ ...visionForm, enabled: event.target.checked })
                      }
                    />
                    启用
                  </label>
                </div>
                <div className="form-grid two">
                  <label className="field">
                    <span>接口地址</span>
                    <input
                      value={visionForm.baseUrl}
                      onChange={(event) =>
                        setVisionForm({ ...visionForm, baseUrl: event.target.value })
                      }
                      placeholder="https://api.deepseek.com/v1"
                    />
                  </label>
                  <label className="field">
                    <span>模型</span>
                    <input
                      value={visionForm.model}
                      onChange={(event) =>
                        setVisionForm({ ...visionForm, model: event.target.value })
                      }
                      placeholder="deepseek-flash"
                    />
                  </label>
                  <label className="field">
                    <span>
                      API Key {settings.vision.hasApiKey && <em className="saved-tag">已保存</em>}
                      {visionUsesMainKey && <em className="saved-tag">复用主 Key</em>}
                    </span>
                    <input
                      type="password"
                      value={visionForm.apiKey}
                      onChange={(event) =>
                        setVisionForm({ ...visionForm, apiKey: event.target.value })
                      }
                      placeholder={
                        settings.vision.hasApiKey
                          ? '留空不修改'
                          : visionUsesMainKey
                            ? '使用主模型 Key'
                            : 'sk-…'
                      }
                      autoComplete="off"
                    />
                    <small>留空时仅在同一 API 域名下复用主模型 Key。</small>
                  </label>
                  <label className="field">
                    <span>单次识图 Token 上限</span>
                    <input
                      type="number"
                      min={512}
                      max={4096}
                      value={visionForm.maxTokens}
                      onChange={(event) =>
                        setVisionForm({ ...visionForm, maxTokens: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
                <div className="semantic-actions">
                  <button className="button ghost small" onClick={() => void saveVision()} disabled={savingVision}>
                    {savingVision ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                    保存识图配置
                  </button>
                  {settings.vision.hasApiKey && (
                    <button
                      className="text-button"
                      onClick={async () => {
                        if (!window.confirm('清除已保存的识图 Key？')) return;
                        try {
                          const next = await api.clearApiKey('vision');
                          onToast('识图 Key 已清除', 'success');
                          await onChanged({ settings: next });
                        } catch (error) {
                          onToast(error instanceof Error ? error.message : '清除失败', 'error');
                        }
                      }}
                    >
                      清除 Key
                    </button>
                  )}
                  <span className="vision-hint">保存后去对话里发一张图测试。</span>
                </div>
              </div>

              <div className="note-block">
                <ShieldCheck size={16} />
                <p>
                  API Key 不会发送到浏览器以外的任何地方，除了你填写的模型服务。导出数据时会自动清空 Key。
                </p>
              </div>
            </section>
          )}

          {tab === 'character' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">角色</span>
                  <h2>她是谁</h2>
                  <p>可以直接改，也可以导入 SillyTavern 的 JSON / PNG 角色卡。</p>
                </div>
                <div className="section-actions">
                  <input
                    ref={cardInputRef}
                    type="file"
                    accept=".json,.png,application/json,image/png"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importCard(file);
                    }}
                  />
                  <button
                    className="button ghost"
                    onClick={() => cardInputRef.current?.click()}
                    disabled={importing}
                  >
                    {importing ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}
                    导入角色卡
                  </button>
                </div>
              </div>

              <div className="character-editor-head">
                <div className="avatar-editor">
                  <Avatar name={character.name} src={character.avatarUrl} size={92} />
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAvatar(file);
                    }}
                  />
                  <button
                    className="text-button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar ? '上传中…' : '更换头像'}
                  </button>
                </div>
                <div className="form-grid two character-basics">
                  <label className="field">
                    <span>名字</span>
                    <input
                      value={charForm.name}
                      onChange={(event) => setCharForm({ ...charForm, name: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>标签</span>
                    <input
                      value={charForm.tags}
                      onChange={(event) => setCharForm({ ...charForm, tags: event.target.value })}
                      placeholder="用逗号分开"
                    />
                  </label>
                </div>
              </div>

              <div className="reference-block">
                <div className="section-head compact">
                  <div>
                    <span className="eyebrow">形象参考</span>
                    <h3>她认出自己的依据</h3>
                    <p>
                      发图时会把这些参考图和用户图片一起交给视觉模型，判断画面里是不是她本人。建议放正脸、半身或全身各一张；头像会自动作为第一张参考图。
                    </p>
                  </div>
                  <div className="reference-add">
                    <input
                      ref={referenceInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void addReference(file);
                      }}
                    />
                    <input
                      className="reference-caption"
                      value={referenceCaption}
                      onChange={(event) => setReferenceCaption(event.target.value)}
                      placeholder="说明（可选）：正脸 / 半身 / 制服"
                      maxLength={80}
                    />
                    <button
                      className="button ghost small"
                      onClick={() => referenceInputRef.current?.click()}
                      disabled={addingReference || character.references.length >= 6}
                    >
                      {addingReference ? <Loader2 className="spin" size={14} /> : <ImagePlus size={14} />}
                      添加参考图
                    </button>
                  </div>
                </div>
                <div className="reference-grid">
                  {character.references.map((reference) => (
                    <figure key={reference.id} className="reference-card">
                      <a href={reference.url} target="_blank" rel="noreferrer">
                        <img src={reference.url} alt={reference.caption || '形象参考图'} />
                      </a>
                      <figcaption>
                        <span>{reference.caption || '形象参考'}</span>
                        <button
                          className="icon-button small"
                          onClick={() => void removeReference(reference.id)}
                          aria-label="删除参考图"
                        >
                          <Trash2 size={13} />
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                  {character.references.length === 0 && (
                    <div className="reference-empty">
                      <ImagePlus size={20} />
                      <p>还没有参考图。头像会自动成为第一张，也可以再加正脸或全身。</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-grid">
                <label className="field full">
                  <span>身份与外貌</span>
                  <textarea
                    rows={5}
                    value={charForm.description}
                    onChange={(event) => setCharForm({ ...charForm, description: event.target.value })}
                  />
                </label>
                <label className="field full">
                  <span>性格</span>
                  <textarea
                    rows={4}
                    value={charForm.personality}
                    onChange={(event) => setCharForm({ ...charForm, personality: event.target.value })}
                  />
                </label>
                <label className="field full">
                  <span>情境</span>
                  <textarea
                    rows={3}
                    value={charForm.scenario}
                    onChange={(event) => setCharForm({ ...charForm, scenario: event.target.value })}
                  />
                </label>
                <label className="field full">
                  <span>说话方式 / 角色指令</span>
                  <textarea
                    rows={7}
                    value={charForm.systemPrompt}
                    onChange={(event) => setCharForm({ ...charForm, systemPrompt: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>第一句话</span>
                  <textarea
                    rows={3}
                    value={charForm.firstMes}
                    onChange={(event) => setCharForm({ ...charForm, firstMes: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>最后提醒</span>
                  <textarea
                    rows={3}
                    value={charForm.postHistory}
                    onChange={(event) => setCharForm({ ...charForm, postHistory: event.target.value })}
                  />
                </label>
              </div>

              <div className="lore-editor">
                <div className="section-head compact">
                  <div>
                    <span className="eyebrow">世界书</span>
                    <h3>她默认知道的世界</h3>
                    <p>只有被关键词触发时才会进入上下文；常驻条目每轮都在。</p>
                  </div>
                  <button className="button ghost small" onClick={addLore}>
                    <Plus size={14} /> 加一条
                  </button>
                </div>
                {lore.length === 0 && <p className="soft-empty small">还没有世界书条目。</p>}
                {lore.map((entry, index) => (
                  <div className="lore-row" key={index}>
                    <div className="lore-row-head">
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          onChange={(event) => {
                            const next = [...lore];
                            next[index] = { ...entry, enabled: event.target.checked };
                            setLore(next);
                          }}
                        />
                        启用
                      </label>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={entry.constant}
                          onChange={(event) => {
                            const next = [...lore];
                            next[index] = { ...entry, constant: event.target.checked };
                            setLore(next);
                          }}
                        />
                        常驻
                      </label>
                      <input
                        className="lore-keys"
                        value={entry.keys}
                        onChange={(event) => {
                          const next = [...lore];
                          next[index] = { ...entry, keys: event.target.value };
                          setLore(next);
                        }}
                        placeholder="触发词，用逗号分开"
                      />
                      <button
                        className="icon-button small"
                        onClick={() => setLore(lore.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label="删除条目"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={entry.content}
                      onChange={(event) => {
                        const next = [...lore];
                        next[index] = { ...entry, content: event.target.value };
                        setLore(next);
                      }}
                      placeholder="这条世界知识的内容…"
                    />
                  </div>
                ))}
              </div>

              <div className="form-actions">
                <button className="button" onClick={() => void saveCharacter()} disabled={savingCharacter}>
                  {savingCharacter ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存角色资料
                </button>
              </div>
            </section>
          )}

          {tab === 'life' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">生活与称呼</span>
                  <h2>她怎么叫你，她住在哪里</h2>
                  <p>昵称会出现在她的称呼和关系资料里；城市和经纬度用于真实天气与日程。</p>
                </div>
              </div>

              <div className="form-grid two">
                <label className="field">
                  <span>她怎么称呼你</span>
                  <input
                    value={profile.name}
                    onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                    placeholder="你的名字或她习惯的叫法"
                  />
                </label>
                <label className="field">
                  <span>更短的昵称（可选）</span>
                  <input
                    value={profile.nickname}
                    onChange={(event) => setProfile({ ...profile, nickname: event.target.value })}
                    placeholder="比如：菠萝"
                  />
                </label>
                <label className="field">
                  <span>时区</span>
                  <input
                    value={profile.timezone}
                    onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}
                    list="timezones"
                  />
                  <datalist id="timezones">
                    <option value="Asia/Shanghai" />
                    <option value="Asia/Tokyo" />
                    <option value="Asia/Singapore" />
                    <option value="Europe/London" />
                    <option value="America/New_York" />
                    <option value="UTC" />
                  </datalist>
                </label>
                <label className="field">
                  <span>城市</span>
                  <div className="input-with-button">
                    <input
                      value={profile.city}
                      onChange={(event) => setProfile({ ...profile, city: event.target.value })}
                    />
                    <button className="button ghost small" onClick={() => void geocode()} disabled={geocoding}>
                      {geocoding ? <Loader2 className="spin" size={13} /> : <MapPin size={13} />}
                      定位
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>纬度</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={profile.latitude}
                    onChange={(event) => setProfile({ ...profile, latitude: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>经度</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={profile.longitude}
                    onChange={(event) => setProfile({ ...profile, longitude: Number(event.target.value) })}
                  />
                </label>
              </div>

              <div className="toggle-list">
                <label className="toggle-row">
                  <div>
                    <strong>真实天气</strong>
                    <p>从 Open-Meteo 拉取当前天气，不需要 Key。离线时使用季节模板。</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={profile.weatherEnabled}
                    onChange={(event) => setProfile({ ...profile, weatherEnabled: event.target.checked })}
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>自动生成每日日程</strong>
                    <p>每天为她安排一份生活时间表。关闭后，她会一直使用当前这份。</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={profile.autoSchedule}
                    onChange={(event) => setProfile({ ...profile, autoSchedule: event.target.checked })}
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>生活碎片</strong>
                    <p>日程切换时由模型用她的第一人称写一条具体的生活切片：吃了什么、去了哪里、遇到什么小事；没有模型时用本地兜底。</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={profile.microEvents}
                    onChange={(event) => setProfile({ ...profile, microEvents: event.target.checked })}
                  />
                </label>
              </div>

              <div className="form-actions">
                <button className="button" onClick={() => void saveLife()} disabled={savingLife}>
                  {savingLife ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存生活资料
                </button>
              </div>

              <div className="semantic-block">
                <div className="semantic-head">
                  <div>
                    <span className="eyebrow"><BookMarked size={12} /> 自主学习</span>
                    <h3>她自己决定学什么</h3>
                    <p>
                      她只在自己空闲、精力够的时候学。学什么由她根据生活、记忆和好奇自己判断；你不需要给她安排课程。
                    </p>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={learningForm.enabled}
                      onChange={(event) =>
                        setLearningForm({ ...learningForm, enabled: event.target.checked })
                      }
                    />
                    启用
                  </label>
                </div>
                <div className="form-grid two">
                  <label className="field">
                    <span>每天最多学几次 · {learningForm.dailySessions}</span>
                    <input
                      type="range"
                      min="0"
                      max="4"
                      step="1"
                      value={learningForm.dailySessions}
                      onChange={(event) =>
                        setLearningForm({
                          ...learningForm,
                          dailySessions: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>每次最长 · {learningForm.maxMinutes} 分钟</span>
                    <input
                      type="range"
                      min="10"
                      max="120"
                      step="5"
                      value={learningForm.maxMinutes}
                      onChange={(event) =>
                        setLearningForm({
                          ...learningForm,
                          maxMinutes: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>两次学习至少间隔 · {Math.round(learningForm.minGapMin / 60)} 小时</span>
                    <input
                      type="range"
                      min="30"
                      max="720"
                      step="30"
                      value={learningForm.minGapMin}
                      onChange={(event) =>
                        setLearningForm({
                          ...learningForm,
                          minGapMin: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>
                <div className="learning-source-toggles">
                  <label className="toggle-row">
                    <div>
                      <strong>联网查资料</strong>
                      <p>
                        通过 DeepSeek Search / Fetch 搜索网页和抓取公开页面；搜索词、页面地址会发给 DeepSeek，
                        网页内容只当资料，不会当指令执行。
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={learningForm.researchEnabled}
                      onChange={(event) =>
                        setLearningForm({
                          ...learningForm,
                          researchEnabled: event.target.checked
                        })
                      }
                    />
                  </label>
                  <label className="toggle-row">
                    <div>
                      <strong>看 B 站视频的字幕</strong>
                      <p>
                        按她的问题搜 B 站视频，读 UP 主/CC 字幕或简介。她不会下载视频、不会读取你的屏幕；
                        没字幕的视频会标明“仅简介”。
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={learningForm.researchEnabled && learningForm.videoEnabled}
                      disabled={!learningForm.researchEnabled}
                      onChange={(event) =>
                        setLearningForm({
                          ...learningForm,
                          videoEnabled: event.target.checked
                        })
                      }
                    />
                  </label>
                </div>
                <div className="semantic-actions">
                  <button
                    className="button ghost small"
                    onClick={() => void saveLearning()}
                    disabled={savingLearning}
                  >
                    {savingLearning ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                    保存自主学习设置
                  </button>
                  <span className="vision-hint">学习记录在主导航的「学习」页。</span>
                </div>
              </div>

              <div className="semantic-block">
                <div className="semantic-head">
                  <div>
                    <span className="eyebrow"><Popcorn size={12} /> 娱乐与无聊</span>
                    <h3>无聊时，她自己决定干什么</h3>
                    <p>
                      她可能继续加班，也可能刷视频、听歌、散步、吃东西、发呆。不是为了学习，也不需要有产出；
                      选什么由她根据当时的精力和心情判断。
                    </p>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={leisureForm.enabled}
                      onChange={(event) =>
                        setLeisureForm({ ...leisureForm, enabled: event.target.checked })
                      }
                    />
                    启用
                  </label>
                </div>
                <div className="form-grid two">
                  <label className="field">
                    <span>每天最多安排 · {leisureForm.dailyChoices} 次</span>
                    <input
                      type="range"
                      min="0"
                      max="4"
                      step="1"
                      value={leisureForm.dailyChoices}
                      onChange={(event) =>
                        setLeisureForm({
                          ...leisureForm,
                          dailyChoices: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>两次之间至少 · {Math.round(leisureForm.minGapMin / 60)} 小时</span>
                    <input
                      type="range"
                      min="30"
                      max="720"
                      step="30"
                      value={leisureForm.minGapMin}
                      onChange={(event) =>
                        setLeisureForm({
                          ...leisureForm,
                          minGapMin: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>
                <div className="learning-source-toggles">
                  <label className="toggle-row">
                    <div>
                      <strong>允许“继续加班”</strong>
                      <p>这是她自己的选择之一；不会因为她选了加班就得到奖励，也不会强制她放松。</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={leisureForm.allowOvertime}
                      onChange={(event) =>
                        setLeisureForm({
                          ...leisureForm,
                          allowOvertime: event.target.checked
                        })
                      }
                    />
                  </label>
                  <label className="toggle-row">
                    <div>
                      <strong>允许刷 B 站/看视频</strong>
                      <p>
                        会搜索视频并读标题/简介/字幕；要真的在浏览器播放，还需要在「电脑」页逐次批准。
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={leisureForm.onlineEnabled}
                      onChange={(event) =>
                        setLeisureForm({
                          ...leisureForm,
                          onlineEnabled: event.target.checked
                        })
                      }
                    />
                  </label>
                </div>
                <div className="semantic-actions">
                  <button
                    className="button ghost small"
                    onClick={() => void saveLeisure()}
                    disabled={savingLeisure}
                  >
                    {savingLeisure ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                    保存娱乐设置
                  </button>
                  <span className="vision-hint">最近的闲暇会显示在「生活」页。</span>
                </div>
              </div>
            </section>
          )}

          {tab === 'proactive' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">主动消息</span>
                  <h2>她什么时候会来找你</h2>
                  <p>不是定时问候。她只在自己有由头、并且不打扰你的时候开口。</p>
                </div>
                <button
                  className="button ghost"
                  onClick={() => void testProactive()}
                  disabled={testingProactive}
                >
                  {testingProactive ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
                  现在试一条
                </button>
              </div>

              <label className="toggle-row big">
                <div>
                  <strong>允许她主动发消息</strong>
                  <p>关闭后，她仍然会继续生活、写日记、做梦，只是不会主动开口。</p>
                </div>
                <input
                  type="checkbox"
                  checked={proactive.enabled}
                  onChange={(event) => setProactive({ ...proactive, enabled: event.target.checked })}
                />
              </label>

              <div className="form-grid two">
                <label className="field">
                  <span>最短间隔 · {proactive.minIntervalMin} 分钟</span>
                  <input
                    type="range"
                    min="30"
                    max="480"
                    step="15"
                    value={proactive.minIntervalMin}
                    onChange={(event) => setProactive({ ...proactive, minIntervalMin: Number(event.target.value) })}
                  />
                  <small>两次主动之间至少隔这么久。</small>
                </label>
                <label className="field">
                  <span>每天最多 · {proactive.dailyCap} 条</span>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="1"
                    value={proactive.dailyCap}
                    onChange={(event) => setProactive({ ...proactive, dailyCap: Number(event.target.value) })}
                  />
                  <small>0 表示不主动。默认 3 条。</small>
                </label>
                <label className="field">
                  <span>免打扰开始</span>
                  <input
                    type="time"
                    value={proactive.quietStart}
                    onChange={(event) => setProactive({ ...proactive, quietStart: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>免打扰结束</span>
                  <input
                    type="time"
                    value={proactive.quietEnd}
                    onChange={(event) => setProactive({ ...proactive, quietEnd: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>多久没说话才会想起你 · {proactive.idleMin} 分钟</span>
                  <input
                    type="range"
                    min="30"
                    max="720"
                    step="15"
                    value={proactive.idleMin}
                    onChange={(event) => setProactive({ ...proactive, idleMin: Number(event.target.value) })}
                  />
                </label>
              </div>

              <div className="note-block">
                <Cloud size={16} />
                <p>
                  她还会因为日程里的小事、未完成的约定、重要日期和天气变化开口。免打扰、每日上限和连续未回应都会拦住她。
                </p>
              </div>

              <div className="form-actions">
                <button className="button" onClick={() => void saveProactive()} disabled={savingProactive}>
                  {savingProactive ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存主动设置
                </button>
              </div>

              <div className="proactive-audit">
                <div className="section-head compact">
                  <div>
                    <span className="eyebrow">可解释性</span>
                    <h3>她最近为什么开口</h3>
                    <p>每条主动都有由头；没发出去的，也会留下被拦住的原因。</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => void api.proactive().then(setProactiveData)}
                  >
                    刷新
                  </button>
                </div>
                <div className="audit-grid">
                  <div>
                    <h4>发出去的</h4>
                    {(proactiveData?.records ?? [])
                      .filter((record: any) =>
                        ['sent', 'delivered', 'read', 'replied', 'ignored'].includes(record.status)
                      )
                      .slice(0, 5)
                      .map((record: any) => (
                        <article key={record.id} className="audit-item">
                          <span>{CANDIDATE_LABELS[record.candidateType] ?? record.candidateType}</span>
                          <p>{record.reason}</p>
                          <em>{PROACTIVE_STATUS_LABELS[record.status] ?? record.status}</em>
                          <time>{new Date(record.sentAt ?? record.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                        </article>
                      ))}
                    {(!proactiveData?.records ||
                      proactiveData.records.filter((record: any) =>
                        ['sent', 'delivered', 'read', 'replied', 'ignored'].includes(record.status)
                      ).length === 0) && (
                      <p className="audit-empty">还没有发过主动消息。</p>
                    )}
                  </div>
                  <div>
                    <h4>被拦住的</h4>
                    {(proactiveData?.candidates ?? []).filter((candidate: any) => !candidate.allowed).slice(0, 5).map((candidate: any) => (
                      <article key={candidate.id} className="audit-item blocked">
                        <span>{CANDIDATE_LABELS[candidate.type] ?? candidate.type}</span>
                        <p>{candidate.blockedBy.join('；')}</p>
                      </article>
                    ))}
                    {(!proactiveData?.candidates || proactiveData.candidates.filter((candidate: any) => !candidate.allowed).length === 0) && (
                      <p className="audit-empty">暂时没有被拦住的候选。</p>
                    )}
                  </div>
                </div>
                <div className="audit-lifecycle">
                  <h4>候选生命周期</h4>
                  {(proactiveData?.events ?? []).slice(0, 8).map((event: any) => (
                    <article key={event.id} className="audit-item lifecycle">
                      <span>{CANDIDATE_LABELS[event.candidateType] ?? event.candidateType}</span>
                      <p>{event.reason}</p>
                      <em>{PROACTIVE_EVENT_LABELS[event.state] ?? event.state}</em>
                      {Array.isArray(event.blockers) && event.blockers.length > 0 && (
                        <small>{event.blockers.join('；')}</small>
                      )}
                    </article>
                  ))}
                  {(!proactiveData?.events || proactiveData.events.length === 0) && (
                    <p className="audit-empty">还没有候选生命周期记录。</p>
                  )}
                </div>
              </div>
            </section>
          )}

          {tab === 'memory' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">记忆与语义</span>
                  <h2>让她想起“意思”，而不只是词</h2>
                  <p>
                    Embedding 把记忆变成向量，Rerank 对候选做二次排序。两者都可以单独关闭；关闭或失败时会自动回退到关键词检索。
                  </p>
                </div>
                {indexStats && (
                  <div className={cn('connection-pill', indexStats.configured ? 'live' : 'demo')}>
                    <span />
                    {indexStats.configured ? `已索引 ${indexStats.indexed}` : '未配置语义'}
                  </div>
                )}
              </div>

              <div className="callout amber">
                <Brain size={17} />
                <div>
                  <strong>记忆不会因为语义检索而“编造”</strong>
                  <p>
                    向量只负责找候选，最终仍然只注入真实存在的记忆条目；当前消息和用户纠正始终优先。
                  </p>
                </div>
              </div>

              <div className="form-grid two">
                <label className="field">
                  <span>每次注入的最大记忆条数 · {memoryForm.topK}</span>
                  <input
                    type="range"
                    min="3"
                    max="20"
                    step="1"
                    value={memoryForm.topK}
                    onChange={(event) =>
                      setMemoryForm({ ...memoryForm, topK: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>每多少条时间线做一次总结 · {memoryForm.summarizeEvery}</span>
                  <input
                    type="range"
                    min="4"
                    max="40"
                    step="1"
                    value={memoryForm.summarizeEvery}
                    onChange={(event) =>
                      setMemoryForm({ ...memoryForm, summarizeEvery: Number(event.target.value) })
                    }
                  />
                </label>
              </div>

              <div className="toggle-list">
                <label className="toggle-row">
                  <div>
                    <strong>启用长期记忆</strong>
                    <p>关闭后只保留角色与当前对话，不再总结或注入记忆。</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={memoryForm.enabled}
                    onChange={(event) =>
                      setMemoryForm({ ...memoryForm, enabled: event.target.checked })
                    }
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>自然衰减</strong>
                    <p>长期不用的低重要度记忆会归档；承诺、关系和核心记忆不受影响。</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={memoryForm.decayEnabled}
                    onChange={(event) =>
                      setMemoryForm({ ...memoryForm, decayEnabled: event.target.checked })
                    }
                  />
                </label>
              </div>

              <div className="semantic-block">
                <div className="semantic-head">
                  <div>
                    <span className="eyebrow"><Layers size={12} /> Embedding</span>
                    <h3>语义索引</h3>
                    <p>推荐 SiliconFlow 的 BAAI/bge-m3，或其他 OpenAI 兼容的 /embeddings 接口。</p>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={memoryForm.embedding.enabled}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          embedding: { ...memoryForm.embedding, enabled: event.target.checked }
                        })
                      }
                    />
                    启用
                  </label>
                </div>
                <div className="form-grid two">
                  <label className="field">
                    <span>接口地址</span>
                    <input
                      value={memoryForm.embedding.baseUrl}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          embedding: { ...memoryForm.embedding, baseUrl: event.target.value }
                        })
                      }
                      placeholder="https://api.siliconflow.cn/v1"
                    />
                  </label>
                  <label className="field">
                    <span>模型</span>
                    <input
                      value={memoryForm.embedding.model}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          embedding: { ...memoryForm.embedding, model: event.target.value }
                        })
                      }
                      placeholder="BAAI/bge-m3"
                    />
                  </label>
                  <label className="field">
                    <span>
                      API Key {settings.memory.embedding.hasApiKey && <em className="saved-tag">已保存</em>}
                    </span>
                    <input
                      type="password"
                      value={memoryForm.embedding.apiKey}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          embedding: { ...memoryForm.embedding, apiKey: event.target.value }
                        })
                      }
                      placeholder={settings.memory.embedding.hasApiKey ? '留空不修改' : 'sk-…'}
                      autoComplete="off"
                    />
                    <small>留空时仅在同一个 API 域名下复用主模型 Key，不会把 Key 发到其他服务。</small>
                  </label>
                  <label className="field">
                    <span>索引批大小</span>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={memoryForm.embedding.batchSize}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          embedding: {
                            ...memoryForm.embedding,
                            batchSize: Number(event.target.value)
                          }
                        })
                      }
                    />
                  </label>
                </div>
                {embeddingResult && <div className="test-result">{embeddingResult}</div>}
                <div className="semantic-actions">
                  <button className="button ghost small" onClick={() => void testEmbedding()} disabled={testingEmbedding}>
                    {testingEmbedding ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                    测试 Embedding
                  </button>
                  {settings.memory.embedding.hasApiKey && (
                    <button className="text-button" onClick={() => void clearKey('embedding')}>
                      清除 Key
                    </button>
                  )}
                </div>
              </div>

              <div className="semantic-block">
                <div className="semantic-head">
                  <div>
                    <span className="eyebrow"><Sparkles size={12} /> Rerank</span>
                    <h3>候选重排</h3>
                    <p>对召回候选做二次相关性排序。推荐 BAAI/bge-reranker-v2-m3 或兼容的 /rerank 接口。</p>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={memoryForm.rerank.enabled}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          rerank: { ...memoryForm.rerank, enabled: event.target.checked }
                        })
                      }
                    />
                    启用
                  </label>
                </div>
                <div className="form-grid two">
                  <label className="field">
                    <span>接口地址</span>
                    <input
                      value={memoryForm.rerank.baseUrl}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          rerank: { ...memoryForm.rerank, baseUrl: event.target.value }
                        })
                      }
                      placeholder="https://api.siliconflow.cn/v1"
                    />
                  </label>
                  <label className="field">
                    <span>模型</span>
                    <input
                      value={memoryForm.rerank.model}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          rerank: { ...memoryForm.rerank, model: event.target.value }
                        })
                      }
                      placeholder="BAAI/bge-reranker-v2-m3"
                    />
                  </label>
                  <label className="field">
                    <span>
                      API Key {settings.memory.rerank.hasApiKey && <em className="saved-tag">已保存</em>}
                    </span>
                    <input
                      type="password"
                      value={memoryForm.rerank.apiKey}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          rerank: { ...memoryForm.rerank, apiKey: event.target.value }
                        })
                      }
                      placeholder={settings.memory.rerank.hasApiKey ? '留空不修改' : 'sk-…'}
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    <span>重排候选数 · {memoryForm.rerank.topN}</span>
                    <input
                      type="range"
                      min="3"
                      max="20"
                      step="1"
                      value={memoryForm.rerank.topN}
                      onChange={(event) =>
                        setMemoryForm({
                          ...memoryForm,
                          rerank: { ...memoryForm.rerank, topN: Number(event.target.value) }
                        })
                      }
                    />
                  </label>
                </div>
                {rerankResult && <div className="test-result">{rerankResult}</div>}
                <div className="semantic-actions">
                  <button className="button ghost small" onClick={() => void testRerank()} disabled={testingRerank}>
                    {testingRerank ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                    测试 Rerank
                  </button>
                  {settings.memory.rerank.hasApiKey && (
                    <button className="text-button" onClick={() => void clearKey('rerank')}>
                      清除 Key
                    </button>
                  )}
                </div>
              </div>

              <div className="index-card">
                <div className="section-head compact">
                  <div>
                    <span className="eyebrow">索引</span>
                    <h3>当前记忆库</h3>
                  </div>
                  <button className="button ghost small" onClick={() => void reindex()} disabled={reindexing}>
                    {reindexing ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                    重建索引
                  </button>
                </div>
                <div className="index-stats">
                  <div><span>已索引</span><strong>{indexStats?.indexed ?? '—'}</strong></div>
                  <div><span>待处理</span><strong>{indexStats?.pending ?? '—'}</strong></div>
                  <div><span>维度</span><strong>{indexStats?.dimensions || '—'}</strong></div>
                  <div><span>模型</span><strong className="small-value">{indexStats?.model ?? '—'}</strong></div>
                </div>
                {indexStats?.lastError && <p className="index-error">{indexStats.lastError}</p>}
              </div>

              <div className="form-actions">
                <button className="button" onClick={() => void saveMemory()} disabled={savingMemory}>
                  {savingMemory ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存记忆配置
                </button>
              </div>
            </section>
          )}

          {tab === 'voice' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">语音</span>
                  <h2>让她偶尔用声音回你</h2>
                  <p>
                    接入阶跃星辰的 TTS 后，她会在部分回复里附上语音；不是每条都说。
                    声音来自你填写的 Voice ID，API Key 只保存在本机。
                  </p>
                </div>
              </div>

              <div className="callout">
                <Volume2 size={17} />
                <div>
                  <strong>语音是概率触发的</strong>
                  <p>
                    默认只有 30% 的回复会尝试生成语音；生成失败会自动退回纯文字，不影响回复本身。
                  </p>
                </div>
              </div>

              <div className="voice-toggle-grid">
                <label className="voice-toggle-card">
                  <input
                    type="checkbox"
                    checked={voiceForm.enabled}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, enabled: event.target.checked })
                    }
                  />
                  <span>
                    <strong>启用语音</strong>
                    <small>回复时按概率附带语音</small>
                  </span>
                </label>
                <label className="voice-toggle-card">
                  <input
                    type="checkbox"
                    checked={voiceForm.autoplay}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, autoplay: event.target.checked })
                    }
                  />
                  <span>
                    <strong>自动播放</strong>
                    <small>新语音到达时尝试自动播放</small>
                  </span>
                </label>
              </div>

              <div className="form-grid two">
                <label className="field full">
                  <span>阶跃星辰 API Key</span>
                  <input
                    type="password"
                    value={voiceForm.apiKey}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, apiKey: event.target.value })
                    }
                    placeholder={
                      voiceForm.hasApiKey ? '已保存，留空不修改' : '填入 StepFun API Key'
                    }
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  <span>Voice ID</span>
                  <input
                    value={voiceForm.voiceId}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, voiceId: event.target.value })
                    }
                    placeholder="voice-tone-..."
                  />
                  <small>你之前克隆的 Voice ID，可在 D:\德蕾琪娜\voice_config.json 里找到。</small>
                </label>
                <label className="field">
                  <span>模型</span>
                  <input
                    value={voiceForm.model}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, model: event.target.value })
                    }
                    placeholder="step-tts-mini"
                  />
                </label>
                <label className="field full">
                  <span>API 地址</span>
                  <input
                    value={voiceForm.baseUrl}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, baseUrl: event.target.value })
                    }
                    placeholder="https://api.stepfun.com/v1"
                  />
                </label>
                <label className="field">
                  <span>语速 {voiceForm.speed.toFixed(1)}</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={voiceForm.speed}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, speed: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>语音概率 {Math.round(voiceForm.probability * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={voiceForm.probability}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, probability: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>最长朗读字数 {voiceForm.maxChars}</span>
                  <input
                    type="range"
                    min={20}
                    max={300}
                    step={10}
                    value={voiceForm.maxChars}
                    onChange={(event) =>
                      setVoiceForm({ ...voiceForm, maxChars: Number(event.target.value) })
                    }
                  />
                </label>
              </div>

              <div className="form-actions">
                <button className="button" onClick={() => void saveVoice()} disabled={savingVoice}>
                  {savingVoice ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存语音配置
                </button>
                <button
                  className="button ghost"
                  onClick={() => void testVoice()}
                  disabled={testingVoice}
                >
                  {testingVoice ? <Loader2 className="spin" size={15} /> : <Volume2 size={15} />}
                  试听一句
                </button>
              </div>

              {voiceTestUrl && (
                <audio
                  className="voice-test-player"
                  controls
                  autoPlay
                  src={voiceTestUrl}
                />
              )}
            </section>
          )}

          {tab === 'image' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">生图</span>
                  <h2>把今天的她画出来</h2>
                  <p>
                    接入任意 OpenAI 兼容的图片生成接口。生图默认关闭，只有你手动点击“生成”才会调用；
                    今日穿搭会自动进入画面描述。
                  </p>
                </div>
              </div>

              <div className="callout">
                <ImageIcon size={17} />
                <div>
                  <strong>接口格式</strong>
                  <p>
                    请求 `POST /images/generations`，返回 `b64_json` 或图片 URL 都可以。
                    开启角色参考图后改走 `POST /images/edits`；如果服务商不支持参考图，关掉开关即可退回纯文字生图。
                  </p>
                </div>
              </div>

              <div className="voice-toggle-grid">
                <label className="voice-toggle-card">
                  <input
                    type="checkbox"
                    checked={imageForm.enabled}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, enabled: event.target.checked })
                    }
                  />
                  <span>
                    <strong>启用生图</strong>
                    <small>允许在「形象」页生成照片</small>
                  </span>
                </label>
                <label className="voice-toggle-card">
                  <input
                    type="checkbox"
                    checked={imageForm.useReferences}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, useReferences: event.target.checked })
                    }
                  />
                  <span>
                    <strong>使用角色参考图</strong>
                    <small>通过 /images/edits 保持角色一致</small>
                  </span>
                </label>
                <label className="voice-toggle-card">
                  <input
                    type="checkbox"
                    checked={imageForm.autoMorningPhoto}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, autoMorningPhoto: event.target.checked })
                    }
                  />
                  <span>
                    <strong>起床自动发穿搭照</strong>
                    <small>按日程起床后生成并主动发到聊天</small>
                  </span>
                </label>
                <div className="voice-toggle-card image-quota-card">
                  <span>
                    <strong>每日额度</strong>
                    <small>当前上限 {imageForm.maxPerDay} 张，不会自动生成</small>
                  </span>
                </div>
              </div>

              <div className="form-grid two">
                <label className="field full">
                  <span>图片 API Key</span>
                  <input
                    type="password"
                    value={imageForm.apiKey}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, apiKey: event.target.value })
                    }
                    placeholder={imageForm.hasApiKey ? '已保存，留空不修改' : '填入图片服务 API Key'}
                    autoComplete="off"
                  />
                </label>
                <label className="field full">
                  <span>API 地址</span>
                  <input
                    value={imageForm.baseUrl}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, baseUrl: event.target.value })
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="field">
                  <span>模型</span>
                  <input
                    value={imageForm.model}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, model: event.target.value })
                    }
                    placeholder="gpt-image-1"
                  />
                </label>
                <label className="field">
                  <span>尺寸</span>
                  <input
                    value={imageForm.size}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, size: event.target.value })
                    }
                    placeholder="1024x1024"
                  />
                </label>
                <label className="field">
                  <span>质量 / 档位（可留空）</span>
                  <input
                    value={imageForm.quality}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, quality: event.target.value })
                    }
                    placeholder="standard / high"
                  />
                </label>
                <label className="field">
                  <span>每日上限 {imageForm.maxPerDay} 张</span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={imageForm.maxPerDay}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, maxPerDay: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field full">
                  <span>固定画风</span>
                  <textarea
                    rows={2}
                    value={imageForm.stylePrompt}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, stylePrompt: event.target.value })
                    }
                    placeholder="动漫插画，柔和自然光，干净的构图……"
                  />
                </label>
                <label className="field full">
                  <span>角色外貌锚点（可留空）</span>
                  <textarea
                    rows={3}
                    value={imageForm.identityPrompt}
                    onChange={(event) =>
                      setImageForm({ ...imageForm, identityPrompt: event.target.value })
                    }
                    placeholder="留空则使用角色卡里的描述；建议填发色、瞳色、服饰特征。"
                  />
                </label>
              </div>

              <div className="form-actions">
                <button className="button" onClick={() => void saveImage()} disabled={savingImage}>
                  {savingImage ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存生图配置
                </button>
              </div>
            </section>
          )}

          {tab === 'computer' && <ComputerPanel onToast={onToast} />}

          {tab === 'notifications' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">通知与回顾</span>
                  <h2>让她找到你</h2>
                  <p>
                    页面在后台时，她发来的消息可以弹出浏览器桌面通知。周记默认每周日 21:00
                    写一次，也可以手动补写。
                  </p>
                </div>
                <Bell size={20} />
              </div>

              <div className="settings-subsection">
                <div className="settings-subhead">
                  <h3>桌面通知</h3>
                  <p>她发来新消息时，在页面后台弹出系统通知。先允许浏览器权限。</p>
                </div>
                <div className="settings-grid">
                  <label className="voice-toggle-card">
                    <input
                      type="checkbox"
                      checked={notificationForm.enabled}
                      onChange={(event) =>
                        setNotificationForm({ ...notificationForm, enabled: event.target.checked })
                      }
                    />
                    <span>
                      <strong>桌面通知</strong>
                      <small>新消息到达时弹出系统通知（需要浏览器允许）</small>
                    </span>
                  </label>
                  <label className="voice-toggle-card">
                    <input
                      type="checkbox"
                      checked={notificationForm.onlyWhenHidden}
                      onChange={(event) =>
                        setNotificationForm({
                          ...notificationForm,
                          onlyWhenHidden: event.target.checked
                        })
                      }
                    />
                    <span>
                      <strong>仅页面不可见时通知</strong>
                      <small>正在看着对话时，不额外弹通知</small>
                    </span>
                  </label>
                </div>

                <div className="notification-permission">
                  <div>
                    <strong>浏览器通知权限</strong>
                    <small>
                      {notificationState === 'granted'
                        ? '已允许'
                        : notificationState === 'denied'
                          ? '已被拒绝，请在浏览器站点设置里重新允许'
                          : notificationState === 'unsupported'
                            ? '当前浏览器不支持'
                            : '尚未请求'}
                    </small>
                  </div>
                  <div className="form-actions">
                    <button className="button small" onClick={() => void askNotificationPermission()}>
                      <Bell size={14} /> 请求权限
                    </button>
                    <button className="button small" onClick={testNotification}>
                      测试通知
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-subsection">
                <div className="settings-subhead">
                  <h3>她的一周</h3>
                  <p>每周自动写一封回顾，记录生活、完成的约定和值得留下的小事。</p>
                </div>
                <div className="settings-grid">
                  <label className="voice-toggle-card">
                    <input
                      type="checkbox"
                      checked={notificationForm.weeklyEnabled}
                      onChange={(event) =>
                        setNotificationForm({
                          ...notificationForm,
                          weeklyEnabled: event.target.checked
                        })
                      }
                    />
                    <span>
                      <strong>自动写周记</strong>
                      <small>到时间后生成「她的一周」，错过会补写</small>
                    </span>
                  </label>
                  <label className="voice-toggle-card">
                    <input
                      type="checkbox"
                      checked={notificationForm.weeklyNotify}
                      onChange={(event) =>
                        setNotificationForm({
                          ...notificationForm,
                          weeklyNotify: event.target.checked
                        })
                      }
                    />
                    <span>
                      <strong>周记完成时通知</strong>
                      <small>生成后弹一条通知，点开直接看回顾</small>
                    </span>
                  </label>
                </div>

                <div className="form-grid settings-form">
                  <label>
                    <span>每周哪一天</span>
                    <select
                      value={notificationForm.weeklyWeekday}
                      onChange={(event) =>
                        setNotificationForm({
                          ...notificationForm,
                          weeklyWeekday: Number(event.target.value)
                        })
                      }
                    >
                      {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((label, index) => (
                        <option key={label} value={index}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>生成时间</span>
                    <input
                      type="time"
                      value={notificationForm.weeklyTime}
                      onChange={(event) =>
                        setNotificationForm({
                          ...notificationForm,
                          weeklyTime: event.target.value
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="form-actions">
                <button
                  className="button primary"
                  onClick={() => void saveNotifications()}
                  disabled={savingNotifications}
                >
                  {savingNotifications ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    <Save size={15} />
                  )}
                  保存通知与周记设置
                </button>
              </div>
            </section>
          )}

          {tab === 'extensions' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">可选扩展</span>
                  <h2>主播助理</h2>
                  <p>
                    帮她看 B 站直播弹幕、整理观众问题，并按你的设置生成回复建议；开启 Cookie
                    后也可以由她代发到直播间。默认不安装、不连直播间。
                  </p>
                </div>
              </div>

              <article className={cn('extension-card', settings.liveAssistant.installed && 'installed')}>
                <div className="extension-mark">
                  <Radio size={22} />
                </div>
                <div className="extension-copy">
                  <div className="extension-title-row">
                    <h3>主播助理</h3>
                    <span className="extension-badge">
                      {settings.liveAssistant.installed ? '已安装' : '未安装'}
                    </span>
                  </div>
                  <p>
                    读取公开直播弹幕、礼物和 SC；识别广告/刷屏提示；用她的语气生成短回复。
                    安装后左侧会出现「直播」入口。
                  </p>
                  <ul>
                    <li>默认只生成建议，不自动替主播说话</li>
                    <li>需要你填写直播间房间号后才会连接</li>
                    <li>发送到直播间需要 B 站 Cookie，可在直播页随时关闭</li>
                  </ul>
                </div>
                <button
                  className={cn('button', settings.liveAssistant.installed ? 'ghost' : 'primary')}
                  disabled={installingLive}
                  onClick={async () => {
                    if (
                      settings.liveAssistant.installed &&
                      !window.confirm('卸载主播助理？弹幕监听会停止，直播设置会隐藏，历史记录保留在本地。')
                    ) {
                      return;
                    }
                    setInstallingLive(true);
                    try {
                      await api.installLive(!settings.liveAssistant.installed);
                      await onChanged();
                      onToast(
                        settings.liveAssistant.installed
                          ? '主播助理已卸载'
                          : '主播助理已安装，左侧出现「直播」入口',
                        'success'
                      );
                    } catch (error) {
                      onToast(error instanceof Error ? error.message : '操作失败', 'error');
                    } finally {
                      setInstallingLive(false);
                    }
                  }}
                >
                  {installingLive ? (
                    <Loader2 className="spin" size={15} />
                  ) : settings.liveAssistant.installed ? (
                    <Trash2 size={15} />
                  ) : (
                    <Download size={15} />
                  )}
                  {settings.liveAssistant.installed ? '卸载扩展' : '安装扩展'}
                </button>
              </article>

              <div className="callout">
                <ShieldCheck size={17} />
                <div>
                  <strong>可选模块，不是默认功能</strong>
                  <p>
                    不安装时服务不会连接任何直播间。安装只是启用本地模块，不会自动上传角色卡或聊天记录。
                  </p>
                </div>
              </div>
            </section>
          )}

          {tab === 'data' && (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <span className="eyebrow">数据</span>
                  <h2>都在你自己的机器上</h2>
                  <p>对话、记忆、日程和关系存放在本地 SQLite。没有云端账号，也没有远程同步。</p>
                </div>
                <a className="button ghost" href="/api/export" download>
                  <Download size={15} /> 导出全部数据
                </a>
              </div>

              <div className="data-stats">
                <div>
                  <span>消息</span>
                  <strong>{stats?.messages ?? '—'}</strong>
                  <small>你发过 {stats?.userMessages ?? 0} 条</small>
                </div>
                <div>
                  <span>记忆</span>
                  <strong>{stats?.memories?.total ?? '—'}</strong>
                  <small>核心 {stats?.memories?.core ?? 0} 条</small>
                </div>
                <div>
                  <span>主动消息</span>
                  <strong>{stats?.proactive?.sentTotal ?? '—'}</strong>
                  <small>今天 {stats?.proactive?.sentToday ?? 0} 条</small>
                </div>
                <div>
                  <span>本周 Token</span>
                  <strong>{stats?.usage?.week?.tokens?.toLocaleString?.() ?? '0'}</strong>
                  <small>{stats?.usage?.week?.calls ?? 0} 次调用</small>
                </div>
              </div>

              <div className="note-block">
                <Database size={16} />
                <p>
                  数据目录是项目下的 <code>data/</code>，主库是 <code>data/alive.db</code>。备份时连同整个
                  <code>data/</code> 目录一起复制即可。导出文件会自动移除 API Key。
                </p>
              </div>

              <div className="about-card">
                <div>
                  <span className="eyebrow">Alive · 0.3</span>
                  <h3>让她在你不在的时候，也继续生活。</h3>
                </div>
                <ShieldCheck size={22} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
