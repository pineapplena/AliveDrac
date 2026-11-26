import type {
  Attachment,
  ChatDone,
  ChatStreamMeta,
  Message,
  Relationship
} from '../shared/types.js';
import { getCharacter } from './character.js';
import { currentMomentPrompt, getState } from './life.js';
import { LLMError, streamText } from './llm.js';
import {
  buildChatMessages,
  buildSystemPrompt,
  lastUserMessage
} from './prompt.js';
import {
  buildMemoryContext,
  conversationEpoch,
  createMessage,
  getMessages,
  markRead,
  maybeSummarize,
  splitSegments
} from './memory.js';
import {
  checkIntimacyGate,
  containsExplicitContent,
  getRelationship,
  guardIntimateOutput,
  intimacyBoundaryReply,
  reactToUserMessage,
  reflectInteraction
} from './relationship.js';
import { checkUserInput } from './safety.js';
import { getSettings } from './settings.js';
import { partsInZone, nowMs } from './time.js';
import { getWeather, weatherLine } from './weather.js';
import { getLatestAbsence } from './absence.js';
import { analyzeUpload, getUploads } from './uploads.js';
import { visionConfigured } from './vision.js';
import { expressionPosture } from './expression.js';
import { planVoiceReply, synthesizeVoice } from './voice.js';
import { maybeCreateFollowUp } from './followup.js';
import { getLearningPrompt } from './learning.js';
import { getLeisurePrompt } from './leisure.js';
import { reviewPromises } from './promise.js';
import { markLatestProactiveReplied } from './proactive.js';

export type ChatEvent =
  | { type: 'status'; data: { text: string } }
  | { type: 'meta'; data: ChatStreamMeta }
  | { type: 'delta'; data: { text: string } }
  | { type: 'done'; data: ChatDone }
  | { type: 'error'; data: { message: string; detail?: string } };

function safeReplySegments(text: string): string[] {
  return splitSegments(text);
}

function imageContext(attachments: Attachment[]): string {
  return attachments
    .map((attachment, index) => {
      if (!attachment.vision) return '';
      const vision = attachment.vision;
      const text = vision.visibleText ? `；图中文字：${vision.visibleText}` : '';
      const identity =
        vision.identity === 'self' && vision.identityConfidence >= 0.6
          ? `；画面里的人看起来像你本人（${vision.identityEvidence || '特征吻合'}）`
          : vision.identity === 'other' && vision.identityConfidence >= 0.6
            ? '；画面里的人不是你'
            : '；你不太确定画面里的人是不是自己';
      return `图片${index + 1}：${vision.summary}${text}${identity}`;
    })
    .filter(Boolean)
    .join('\n');
}

async function* sendFixedReply(
  userMessage: Message,
  reply: string,
  kind = 'chat'
): AsyncGenerator<ChatEvent> {
  const assistant = createMessage({
    role: 'assistant',
    content: reply,
    segments: safeReplySegments(reply),
    kind,
    meta: { imageFallback: true },
    capture: false
  });
  yield {
    type: 'meta',
    data: { userMessage, memoryIds: [], memoryCount: 0, memoryMode: 'none' }
  };
  yield { type: 'delta', data: { text: reply } };
  yield {
    type: 'done',
    data: { message: assistant, relationship: getRelationship() }
  };
  markRead();
}

function intimacyBoundaryMessage(mode: 'hard' | 'soft' = 'hard'): Message {
  const content = intimacyBoundaryReply(undefined, mode);
  return createMessage({
    role: 'assistant',
    content,
    segments: safeReplySegments(content),
    kind: 'safety',
    meta: { intimacyGuard: true, intimacyMode: mode },
    capture: false
  });
}

export async function* chatStream(
  rawText: string,
  options: { signal?: AbortSignal; attachmentIds?: string[] } = {}
): AsyncGenerator<ChatEvent> {
  const text = rawText.replace(/\r\n/g, '\n').trim();
  const attachments = getUploads(options.attachmentIds ?? []);
  if (!text && !attachments.length) {
    yield { type: 'error', data: { message: '消息是空的' } };
    return;
  }
  if (text.length > 4000) {
    yield { type: 'error', data: { message: '这条消息太长了，先说重点吧。' } };
    return;
  }
  markLatestProactiveReplied();

  const settings = getSettings();
  const character = getCharacter();
  const safety = checkUserInput(text || '');
  const displayText = text || '（发来一张图片）';

  if (!safety.ok) {
    const userMessage = createMessage({
      role: 'user',
      content: displayText,
      segments: [displayText],
      kind: 'chat',
      meta: { safety: safety.category, attachments },
      capture: false
    });
    yield* sendFixedReply(
      userMessage,
      safety.reply ?? '唔……这个我不接。',
      'crisis'
    );
    return;
  }

  const intimacyGate = checkIntimacyGate(text || '');
  const intimacyText = intimacyGate.directive;
  if (intimacyGate.blocked) {
    const userMessage = createMessage({
      role: 'user',
      content: displayText,
      segments: [displayText],
      kind: 'chat',
      meta: { intimacy: 'blocked', attachments },
      capture: false
    });
    yield* sendFixedReply(
      userMessage,
      intimacyGate.reply ?? intimacyBoundaryReply(undefined, 'hard'),
      'safety'
    );
    return;
  }

  let analyzed = attachments;
  let imageUnavailable = false;
  if (attachments.length) {
    if (!visionConfigured()) {
      imageUnavailable = true;
    } else {
      yield { type: 'status', data: { text: '她正在看图片…' } };
      analyzed = [];
      for (const attachment of attachments) {
        analyzed.push(await analyzeUpload(attachment, text));
      }
      if (!analyzed.some((attachment) => attachment.vision)) {
        imageUnavailable = true;
      }
    }
    if (imageUnavailable && !text) {
      const userMessage = createMessage({
        role: 'user',
        content: displayText,
        segments: [displayText],
        kind: 'chat',
        meta: { attachments: analyzed },
        timelineContent: `${displayText}\n[对方发来图片，但这次没有读出来]`
      });
      yield* sendFixedReply(
        userMessage,
        '唔……图我这边没加载出来。\n---\n你直接讲给我听吧。'
      );
      return;
    }
  }

  const readableImages = analyzed.filter((attachment) => attachment.vision);
  const images = imageContext(readableImages);
  const imageNote = imageUnavailable
    ? '[对方发来了一张图片，但你看不清这张图。不要描述图片内容，可以自然请对方讲给你听。]'
    : '';
  const timelineText = [
    text,
    images ? `[对方发来的图片]\n${images}` : '',
    imageNote
  ]
    .filter(Boolean)
    .join('\n\n');

  const userMessage = createMessage({
    role: 'user',
    content: displayText,
    segments: [displayText],
    kind: 'chat',
    meta: {
      attachments: analyzed,
      ...(intimacyGate.directive ? { intimacy: 'soft' } : {})
    },
    timelineContent: timelineText || displayText
  });
  const epoch = conversationEpoch();

  const relationship = reactToUserMessage(text || '发来一张图片');
  const state = getState();
  const posture = expressionPosture(state, relationship);
  const historyAll = getMessages('conv-main', 30);
  const history = historyAll.filter((message) => message.id !== userMessage.id);
  const previousUser = lastUserMessage(history);
  const gapMs = previousUser ? nowMs() - previousUser.createdAt : 0;
  const weather = await getWeather();
  const realtime = currentMomentPrompt(weather);
  const modelUserText = [
    `[本轮实时状态 · 不是对方说的话；回答前先核对，不要沿用聊天记录里的旧时间]\n${realtime}`,
    text,
    images,
    imageNote
  ]
    .filter(Boolean)
    .join('\n\n');
  const memoryQuery = [text, images].filter(Boolean).join(' ') || displayText;
  const memory = await buildMemoryContext(memoryQuery);
  const latestAbsence = gapMs > 2 * 3_600_000 ? getLatestAbsence() : null;
  const absenceText =
    latestAbsence && nowMs() - latestAbsence.endAt < 6 * 3_600_000
      ? latestAbsence.summary
      : undefined;
  const system = buildSystemPrompt({
    character,
    userText: [text, images].filter(Boolean).join('\n'),
    recentUserTexts: history
      .filter((message) => message.role === 'user')
      .slice(-3)
      .map((message) => message.content),
    weather,
    memoryText: memory.text,
    gapMs,
    absenceText,
    posturePrompt: posture.prompt,
    intimacyText,
    learningText: getLearningPrompt(),
    leisureText: getLeisurePrompt()
  });

  const voicePlanned = planVoiceReply();
  yield {
    type: 'meta',
    data: {
      userMessage,
      memoryIds: memory.selected.map((item) => item.id),
      memoryCount: memory.selected.length + memory.core.length + memory.loops.length,
      memoryMode: memory.mode,
      voicePlanned
    }
  };

  const p = partsInZone(nowMs(), settings.user.timezone);
  const mockContext = {
    characterName: character.name,
    userName: settings.user.nickname || settings.user.name,
    userText: text || '（对方发来一张图片）',
    currentActivity: state.currentActivity,
    currentLocation: state.currentLocation,
    mood: state.mood,
    energy: state.energy,
    hour: p.hour,
    minute: p.minute,
    weekday: p.weekday,
    weatherLabel: weatherLine(weather),
    memories: memory.selected.map((item) => item.title || item.content),
    imageSummary: images || undefined,
    imageIdentity: readableImages.find((item) => item.vision)?.vision?.identity
  };

  let full = '';
  let blockedOutput = false;
  const explicitAllowedAtStart = intimacyGate.mode === 'allow';
  const intimacyFallbackMode: 'hard' | 'soft' =
    intimacyGate.mode === 'hard' ? 'hard' : 'soft';
  const guardController = new AbortController();
  const streamSignal = options.signal
    ? AbortSignal.any([options.signal, guardController.signal])
    : guardController.signal;
  try {
    const generator = streamText({
      task: 'chat',
      system,
      messages: buildChatMessages({ system: '', history, userText: modelUserText }).filter(
        (message) => message.role !== 'system'
      ),
      temperature: settings.provider.temperature,
      maxTokens: Math.min(settings.provider.maxTokens, posture.maxTokens),
      mockContext,
      signal: streamSignal
    });
    let next = await generator.next();
    while (!next.done) {
      const delta = next.value;
      full += delta;
      if (!explicitAllowedAtStart && containsExplicitContent(full)) {
        blockedOutput = true;
        guardController.abort();
        try {
          await generator.return(undefined as any);
        } catch {
          // The stream is already being torn down.
        }
        break;
      }
      if (!voicePlanned) yield { type: 'delta', data: { text: delta } };
      next = await generator.next();
    }
    if (!blockedOutput && next.done && next.value?.text && next.value.text !== full) {
      full = next.value.text;
    }
  } catch (error) {
    if (options.signal?.aborted) return;
    const message =
      error instanceof LLMError
        ? error.message
        : error instanceof Error
          ? error.message
          : '生成回复时出了点问题';
    yield {
      type: 'error',
      data: {
        message: '她这次没接上话。',
        detail: message
      }
    };
    return;
  }

  if (blockedOutput) {
    if (conversationEpoch() !== epoch) return;
    const assistant = intimacyBoundaryMessage(intimacyFallbackMode);
    markRead();
    yield {
      type: 'done',
      data: { message: assistant, relationship: getRelationship() }
    };
    return;
  }

  const rawFinal = full.trim();
  if (!rawFinal) {
    yield { type: 'error', data: { message: '她这次没接上话。', detail: 'empty reply' } };
    return;
  }
  // 这段时间里会话被清空过：这条回复不属于新的对话，直接丢掉。
  if (conversationEpoch() !== epoch) return;
  const guardedOutput = guardIntimateOutput(
    rawFinal,
    intimacyGate.mode === 'allow' ? undefined : intimacyGate.mode
  );
  if (guardedOutput.changed) {
    const fallbackMode: 'hard' | 'soft' = guardedOutput.mode === 'hard' ? 'hard' : 'soft';
    const assistant = intimacyBoundaryMessage(fallbackMode);
    markRead();
    yield {
      type: 'done',
      data: { message: assistant, relationship: getRelationship() }
    };
    return;
  }
  const finalText = guardedOutput.text;
  const allSegments = safeReplySegments(finalText);
  const segments =
    allSegments.length > posture.maxSegments
      ? [
          ...allSegments.slice(0, Math.max(1, posture.maxSegments - 1)),
          allSegments.slice(Math.max(1, posture.maxSegments - 1)).join(' ')
        ]
      : allSegments;
  let voice: Awaited<ReturnType<typeof synthesizeVoice>> | null = null;
  if (voicePlanned) {
    yield { type: 'status', data: { text: '她正在准备声音…' } };
    try {
      voice = await synthesizeVoice(finalText, { timeoutMs: 15_000 });
    } catch (error) {
      console.warn(
        '[voice] planned speech failed, falling back to text:',
        error instanceof Error ? error.message : String(error)
      );
      yield { type: 'delta', data: { text: finalText } };
    }
  }
  if (options.signal?.aborted) return;
  const assistant = createMessage({
    role: 'assistant',
    content: finalText,
    segments,
    kind: 'chat',
    meta: {
      model: settings.provider.model,
      demo: !settings.provider.apiKey,
      memoryIds: memory.selected.map((item) => item.id),
      ...(voice ? { voice } : {})
    }
  });
  maybeSummarize('conv-main');
  void reflectInteraction(text || '发来一张图片', finalText);
  if (text) void maybeCreateFollowUp(text, finalText);
  markRead();
  void reviewPromises({ cueText: text || undefined }).catch(() => undefined);

  const nextRelationship: Relationship = getRelationship();
  yield {
    type: 'done',
    data: { message: assistant, relationship: nextRelationship }
  };
}

export function retryableMessage(message: Message): boolean {
  return message.role === 'user';
}
