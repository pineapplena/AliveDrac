import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { MemoryKind } from '../shared/types.js';
import { DATA_DIR, HOST, PORT, VERSION } from './config.js';
import { bus } from './events.js';
import { HttpError, readJson, sendJson, sendText, serveStatic } from './http.js';
import { buildBootstrap, buildLifeView, markConversationRead, syncConversationProfile } from './bootstrap.js';
import {
  addCharacterReference,
  deleteCharacterReference,
  getCharacter,
  importCard,
  saveAvatar,
  updateCharacter,
  type CharacterPatch
} from './character.js';
import { db } from './db.js';
import {
  ensureSchedule,
  generateCurrentFragment,
  generateDiary,
  generateDream,
  generateSchedule,
  getBlocks,
  getDiary,
  getDreams,
  tickLife
} from './life.js';
import { complete, LLMError } from './llm.js';
import {
  clearScreenObservations,
  deleteScreenObservation,
  getScreenView,
  runScreenPeek,
  updateScreenSettings
} from './screen.js';
import {
  clearLiveHistory,
  clearLiveKnowledge,
  getLiveView,
  installLiveAssistant,
  learnLiveNow,
  replyToLiveEvent,
  sendManualLiveMessage,
  sendStoredReply,
  startLive,
  stopLive,
  updateLiveSettings
} from './live.js';
import {
  addWardrobeItem,
  chooseTodayOutfit,
  generateAppearanceImage,
  getAppearanceView,
  removeGeneratedImage,
  removeWardrobeItem,
  rerollTodayOutfit
} from './appearance.js';
import { getMemoryIndexStats, reindexAll } from './memory-index.js';
import { testVoice, voiceReady } from './voice.js';
import { embedTexts, embeddingConfigured } from './embedding.js';
import { rerankConfigured, rerankDocuments } from './rerank.js';
import { getUpload, saveUpload } from './uploads.js';
import { buildLearningView, runLearningSession } from './learning.js';
import { buildLeisureView, runLeisure } from './leisure.js';
import {
  decideComputerRequest,
  getComputerView,
  updateComputerSettings
} from './computer.js';
import {
  clearConversation,
  completePromise,
  createMemory,
  deleteMemory,
  deleteMemories,
  exportAll,
  exportMemories,
  getConversation,
  getMemory,
  importMemories,
  getMessages,
  listMemories,
  markRead,
  memoryStats,
  reopenPromise,
  summarize,
  unreadCount,
  updateMemory
} from './memory.js';
import { reviewPromises } from './promise.js';
import {
  archiveAgreement,
  completeAgreement,
  createAgreement,
  listAgreements,
  pauseAgreementReminders,
  reopenAgreement,
  resumeAgreementReminders,
  updateAgreement
} from './agreements.js';
import {
  buildWeeklyReviewView,
  generateWeeklyReview
} from './weekly-review.js';
import {
  getCandidateAudit,
  getProactiveEvents,
  getProactiveRecords,
  markLatestProactiveRead,
  markProactiveDelivered,
  proactiveStats,
  refreshWeatherCache,
  runProactive
} from './proactive.js';
import {
  createImportantDate,
  createNote,
  deleteImportantDate,
  deleteNote,
  listImportantDates,
  listNotes,
  updateNote
} from './notes.js';
import {
  EXPLICIT_INTIMACY_THRESHOLD,
  EXPLICIT_SOFT_REFUSAL_THRESHOLD,
  getRelationship,
  getRelationshipEvents,
  relationshipAllowsExplicit,
  updateRelationship
} from './relationship.js';
import { chatStream } from './chat.js';
import { isDemo, llmConfigured, publicSettings, saveSettings } from './settings.js';
import { getStats } from './stats.js';
import { dateKey, nowMs } from './time.js';
import { geocodeCity } from './weather.js';

function isDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function today(): string {
  return dateKey(nowMs(), publicSettings().user.timezone);
}

function numberParam(value: string | null, fallback: number, min = 1, max = 200): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function assertText(text: unknown, label: string, min = 1, max = 4000): string {
  const value = String(text ?? '').trim();
  if (value.length < min) throw new HttpError(400, `${label}不能为空`);
  if (value.length > max) throw new HttpError(400, `${label}太长了`);
  return value;
}

function memoryKind(value: unknown): MemoryKind {
  const allowed: MemoryKind[] = [
    'fact',
    'preference',
    'event',
    'promise',
    'relationship',
    'emotion',
    'self',
    'core',
    'summary'
  ];
  return allowed.includes(value as MemoryKind) ? (value as MemoryKind) : 'event';
}

async function handleChatStream(
  req: IncomingMessage,
  res: ServerResponse,
  body: Record<string, unknown>
): Promise<void> {
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map(String).slice(0, 6)
    : [];
  const text = String(body.text ?? '').trim();
  if (!text && attachmentIds.length === 0) {
    throw new HttpError(400, '消息不能为空');
  }
  if (text.length > 4000) throw new HttpError(400, '消息太长了');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');

  const controller = new AbortController();
  req.on('close', () => controller.abort());
  let closed = false;
  try {
    for await (const event of chatStream(text, {
      signal: controller.signal,
      attachmentIds
    })) {
      if (closed) break;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败';
    if (!closed) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: '连接断开了', detail: message })}\n\n`
      );
    }
  } finally {
    closed = true;
    if (!res.writableEnded) res.end();
  }
}

function attachEventsStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(`event: hello\ndata: ${JSON.stringify({ at: nowMs(), version: VERSION })}\n\n`);

  const send = (event: { type: string; data: unknown; at: number }) => {
    if (res.writableEnded) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };
  bus.on('event', send);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: ping ${Date.now()}\n\n`);
  }, 20_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off('event', send);
    if (!res.writableEnded) res.end();
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      demo: isDemo(),
      dataDir: DATA_DIR,
      uptime: Math.round(process.uptime())
    });
    return;
  }

  if (method === 'GET' && path === '/api/bootstrap') {
    sendJson(res, 200, await buildBootstrap());
    return;
  }

  if (method === 'GET' && path === '/api/life') {
    const date = url.searchParams.get('date');
    await tickLife();
    sendJson(res, 200, await buildLifeView(isDate(date) ? date : undefined));
    return;
  }

  if (method === 'POST' && path === '/api/life/tick') {
    await tickLife(true);
    sendJson(res, 200, await buildLifeView());
    return;
  }

  if (method === 'POST' && path === '/api/life/fragment') {
    const event = await generateCurrentFragment();
    if (!event) throw new HttpError(400, '现在没有可以记录的日程');
    sendJson(res, 200, event);
    return;
  }

  if (method === 'GET' && path === '/api/schedule') {
    const date = isDate(url.searchParams.get('date')) ? url.searchParams.get('date')! : today();
    sendJson(res, 200, { date, blocks: ensureSchedule(date) });
    return;
  }

  if (method === 'POST' && path === '/api/schedule/generate') {
    const body = await readJson(req);
    const date = isDate(body.date) ? body.date : today();
    const result = await generateSchedule(date);
    sendJson(res, 200, { ...result, date });
    return;
  }

  if (method === 'GET' && path === '/api/messages') {
    const limit = numberParam(url.searchParams.get('limit'), 60, 1, 200);
    const beforeRaw = Number(url.searchParams.get('before'));
    const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;
    sendJson(res, 200, { messages: getMessages('conv-main', limit, before) });
    return;
  }

  if (method === 'POST' && path === '/api/messages/read') {
    markConversationRead();
    markLatestProactiveRead();
    sendJson(res, 200, { ok: true, unread: unreadCount() });
    return;
  }

  if (method === 'POST' && path === '/api/messages/clear') {
    const result = clearConversation('conv-main');
    sendJson(res, 200, { ok: true, ...result, unread: unreadCount() });
    return;
  }

  if (method === 'GET' && path === '/api/conversation') {
    sendJson(res, 200, { conversation: getConversation(), unread: unreadCount() });
    return;
  }

  if (method === 'POST' && path === '/api/uploads') {
    const body = await readJson(req);
    try {
      const attachment = saveUpload({
        dataUrl: assertText(body.dataUrl, '图片', 20, 14_000_000),
        name: body.name == null ? '' : String(body.name).slice(0, 120),
        width: Number.isFinite(Number(body.width)) ? Number(body.width) : null,
        height: Number.isFinite(Number(body.height)) ? Number(body.height) : null
      });
      sendJson(res, 201, attachment);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '图片保存失败');
    }
    return;
  }

  const uploadMatch = path.match(/^\/api\/uploads\/([A-Za-z0-9_]+)$/);
  if (uploadMatch && method === 'GET') {
    const attachment = getUpload(uploadMatch[1]);
    if (!attachment) throw new HttpError(404, '图片不存在');
    sendJson(res, 200, attachment);
    return;
  }

  if (method === 'POST' && path === '/api/chat') {
    const body = await readJson(req);
    await handleChatStream(req, res, body);
    return;
  }

  if (method === 'GET' && path === '/api/learning') {
    sendJson(res, 200, buildLearningView());
    return;
  }

  if (method === 'GET' && path === '/api/leisure') {
    sendJson(res, 200, buildLeisureView());
    return;
  }

  if (method === 'POST' && path === '/api/leisure/run') {
    const body = await readJson(req);
    sendJson(res, 200, await runLeisure({ force: Boolean(body.force) }));
    return;
  }

  if (method === 'GET' && path === '/api/computer') {
    sendJson(res, 200, getComputerView());
    return;
  }

  if (method === 'PUT' && path === '/api/computer') {
    const body = await readJson(req);
    try {
      sendJson(
        res,
        200,
        updateComputerSettings({
          enabled: Boolean(body.enabled),
          agreed: Boolean(body.agreed),
          allowOpenUrls: Boolean(body.allowOpenUrls),
          dailyLimit: Number(body.dailyLimit ?? 3),
          allowedApps: Array.isArray(body.allowedApps) ? body.allowedApps : []
        })
      );
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '保存失败');
    }
    return;
  }

  const computerDecision = path.match(/^\/api\/computer\/requests\/([A-Za-z0-9_]+)\/decide$/);
  if (computerDecision && method === 'POST') {
    const body = await readJson(req);
    try {
      sendJson(res, 200, decideComputerRequest(computerDecision[1], Boolean(body.approve)));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '处理失败');
    }
    return;
  }

  if (method === 'GET' && path === '/api/screen') {
    sendJson(res, 200, getScreenView());
    return;
  }

  if (method === 'PATCH' && path === '/api/screen') {
    const body = await readJson(req);
    try {
      sendJson(
        res,
        200,
        updateScreenSettings({
          enabled: body.enabled == null ? undefined : Boolean(body.enabled),
          consent: Boolean(body.consent),
          intervalMin: body.intervalMin == null ? undefined : Number(body.intervalMin),
          probability: body.probability == null ? undefined : Number(body.probability),
          dailyCap: body.dailyCap == null ? undefined : Number(body.dailyCap),
          allowVision: body.allowVision == null ? undefined : Boolean(body.allowVision)
        })
      );
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '保存失败');
    }
    return;
  }

  if (method === 'POST' && path === '/api/screen/peek') {
    sendJson(res, 200, await runScreenPeek(true));
    return;
  }

  if (method === 'DELETE' && path === '/api/screen/observations') {
    sendJson(res, 200, { cleared: clearScreenObservations() });
    return;
  }

  const screenObservation = path.match(/^\/api\/screen\/observations\/([A-Za-z0-9_]+)$/);
  if (screenObservation && method === 'DELETE') {
    deleteScreenObservation(screenObservation[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path === '/api/live') {
    sendJson(res, 200, getLiveView());
    return;
  }

  if (method === 'POST' && path === '/api/live/install') {
    const body = await readJson(req);
    sendJson(res, 200, installLiveAssistant(Boolean(body.installed)));
    return;
  }

  if (method === 'PATCH' && path === '/api/live') {
    const body = await readJson(req);
    try {
      sendJson(
        res,
        200,
        updateLiveSettings({
          enabled: body.enabled == null ? undefined : Boolean(body.enabled),
          roomId: body.roomId == null ? undefined : String(body.roomId),
          streamerName: body.streamerName == null ? undefined : String(body.streamerName),
          cookie: body.cookie == null ? undefined : String(body.cookie),
          cookieFields:
            body.cookieFields && typeof body.cookieFields === 'object'
              ? {
                  sessdata:
                    body.cookieFields.sessdata == null
                      ? undefined
                      : String(body.cookieFields.sessdata),
                  biliJct:
                    body.cookieFields.biliJct == null
                      ? undefined
                      : String(body.cookieFields.biliJct),
                  buvid3:
                    body.cookieFields.buvid3 == null
                      ? undefined
                      : String(body.cookieFields.buvid3),
                  buvid4:
                    body.cookieFields.buvid4 == null
                      ? undefined
                      : String(body.cookieFields.buvid4),
                  dedeUserId:
                    body.cookieFields.dedeUserId == null
                      ? undefined
                      : String(body.cookieFields.dedeUserId),
                  extra:
                    body.cookieFields.extra == null
                      ? undefined
                      : String(body.cookieFields.extra)
                }
              : undefined,
          clearCookie: Boolean(body.clearCookie),
          autoReply: body.autoReply == null ? undefined : Boolean(body.autoReply),
          replyMode:
            body.replyMode === 'send'
              ? 'send'
              : body.replyMode === 'suggest'
                ? 'suggest'
                : undefined,
          autoReplyCooldownSec:
            body.autoReplyCooldownSec == null ? undefined : Number(body.autoReplyCooldownSec),
          maxPerMinute: body.maxPerMinute == null ? undefined : Number(body.maxPerMinute),
          maxReplyChars: body.maxReplyChars == null ? undefined : Number(body.maxReplyChars),
          replyToGifts: body.replyToGifts == null ? undefined : Boolean(body.replyToGifts),
          moderationHints:
            body.moderationHints == null ? undefined : Boolean(body.moderationHints),
          learnFromDanmaku:
            body.learnFromDanmaku == null ? undefined : Boolean(body.learnFromDanmaku)
        })
      );
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '保存失败');
    }
    return;
  }

  if (method === 'POST' && path === '/api/live/start') {
    const body = await readJson(req);
    try {
      sendJson(res, 200, await startLive(body.roomId == null ? undefined : String(body.roomId)));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '连接失败');
    }
    return;
  }

  if (method === 'POST' && path === '/api/live/stop') {
    sendJson(res, 200, stopLive());
    return;
  }

  const liveEventReply = path.match(/^\/api\/live\/events\/([A-Za-z0-9_]+)\/reply$/);
  if (liveEventReply && method === 'POST') {
    try {
      sendJson(res, 200, await replyToLiveEvent(liveEventReply[1]));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '回复失败');
    }
    return;
  }

  const liveReplySend = path.match(/^\/api\/live\/replies\/([A-Za-z0-9_]+)\/send$/);
  if (liveReplySend && method === 'POST') {
    try {
      sendJson(res, 200, await sendStoredReply(liveReplySend[1]));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '发送失败');
    }
    return;
  }

  if (method === 'POST' && path === '/api/live/send') {
    const body = await readJson(req);
    try {
      sendJson(res, 200, await sendManualLiveMessage(String(body.text ?? '')));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '发送失败');
    }
    return;
  }

  if (method === 'DELETE' && path === '/api/live/history') {
    clearLiveHistory();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'DELETE' && path === '/api/live/knowledge') {
    clearLiveKnowledge();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && path === '/api/live/learn') {
    try {
      sendJson(res, 200, await learnLiveNow());
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '整理失败');
    }
    return;
  }

  if (method === 'GET' && path === '/api/appearance') {
    sendJson(res, 200, await getAppearanceView());
    return;
  }

  if (method === 'POST' && path === '/api/appearance/wardrobe') {
    const body = await readJson(req);
    try {
      const item = await addWardrobeItem({
        name: String(body.name ?? ''),
        description: body.description == null ? '' : String(body.description),
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        imageDataUrl: body.imageDataUrl == null ? '' : String(body.imageDataUrl)
      });
      sendJson(res, 201, item);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '添加衣柜失败');
    }
    return;
  }

  const wardrobeMatch = path.match(/^\/api\/appearance\/wardrobe\/([A-Za-z0-9_]+)$/);
  if (wardrobeMatch && method === 'DELETE') {
    await removeWardrobeItem(wardrobeMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && path === '/api/appearance/outfit/reroll') {
    sendJson(res, 200, await rerollTodayOutfit());
    return;
  }

  if (method === 'POST' && path === '/api/appearance/outfit/select') {
    const body = await readJson(req);
    try {
      sendJson(res, 200, await chooseTodayOutfit(String(body.itemId ?? '')));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '换衣服失败');
    }
    return;
  }

  if (method === 'POST' && path === '/api/appearance/generate') {
    const body = await readJson(req);
    try {
      const image = await generateAppearanceImage({
        prompt: body.prompt == null ? '' : String(body.prompt),
        source: body.source == null ? 'outfit' : String(body.source)
      });
      sendJson(res, 200, { image, view: await getAppearanceView() });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '生图失败');
    }
    return;
  }

  const imageMatch = path.match(/^\/api\/appearance\/images\/([A-Za-z0-9_]+)$/);
  if (imageMatch && method === 'DELETE') {
    sendJson(res, 200, { ok: await removeGeneratedImage(imageMatch[1]) });
    return;
  }

  if (method === 'POST' && path === '/api/learning/run') {
    const body = await readJson(req);
    sendJson(res, 200, await runLearningSession({ force: Boolean(body.force) }));
    return;
  }

  if (method === 'GET' && path === '/api/memories/stats') {
    sendJson(res, 200, memoryStats());
    return;
  }

  if (method === 'GET' && path === '/api/memories/index-status') {
    sendJson(res, 200, getMemoryIndexStats());
    return;
  }

  if (method === 'POST' && path === '/api/memories/reindex') {
    sendJson(res, 200, await reindexAll());
    return;
  }

  if (method === 'GET' && path === '/api/memories') {
    sendJson(
      res,
      200,
      {
        memories: listMemories({
          query: url.searchParams.get('query') ?? undefined,
          kind: url.searchParams.get('kind') ?? undefined,
          status: url.searchParams.get('status') ?? 'active',
          limit: numberParam(url.searchParams.get('limit'), 80, 1, 200)
        })
      }
    );
    return;
  }

  if (method === 'POST' && path === '/api/memories') {
    const body = await readJson(req);
    const content = assertText(body.content, '记忆内容', 2, 600);
    const memory = createMemory({
      kind: memoryKind(body.kind),
      title: String(body.title ?? '').slice(0, 80),
      content,
      importance: body.importance == null ? 0.6 : Number(body.importance),
      confidence: body.confidence == null ? 0.85 : Number(body.confidence),
      valence: body.valence == null ? 0 : Number(body.valence),
      source: 'manual',
      pinned: Boolean(body.pinned),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      happenedAt: Number.isFinite(Number(body.happenedAt)) ? Number(body.happenedAt) : null
    });
    sendJson(res, 201, memory);
    return;
  }

  if (method === 'GET' && path === '/api/memories/export') {
    const data = exportMemories();
    const body = JSON.stringify(data, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="alive-memories-${date}.json"`,
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }

  if (method === 'POST' && path === '/api/memories/import') {
    const body = await readJson(req);
    try {
      sendJson(res, 200, importMemories(body));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '导入失败');
    }
    return;
  }

  if (method === 'POST' && path === '/api/memories/bulk-delete') {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) throw new HttpError(400, '没有选择要删除的记忆');
    sendJson(res, 200, { ok: true, deleted: deleteMemories(ids) });
    return;
  }

  if (method === 'POST' && path === '/api/memories/review-promises') {
    sendJson(res, 200, await reviewPromises({ force: true }));
    return;
  }

  if (method === 'GET' && path === '/api/agreements') {
    sendJson(res, 200, listAgreements());
    return;
  }

  if (method === 'POST' && path === '/api/agreements') {
    const body = await readJson(req);
    try {
      const result = createAgreement({
        title: body.title == null ? undefined : String(body.title),
        content: assertText(body.content, '约定内容', 2, 600),
        dueAt: body.dueAt == null ? null : Number(body.dueAt)
      });
      sendJson(res, 201, result);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '约定保存失败');
    }
    return;
  }

  const agreementMatch = path.match(/^\/api\/agreements\/([A-Za-z0-9_]+)$/);
  if (agreementMatch && method === 'PUT') {
    const body = await readJson(req);
    try {
      sendJson(
        res,
        200,
        updateAgreement(agreementMatch[1], {
          title: body.title == null ? undefined : String(body.title),
          content: assertText(body.content, '约定内容', 2, 600),
          dueAt: body.dueAt == null ? null : Number(body.dueAt)
        })
      );
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '约定保存失败');
    }
    return;
  }

  const agreementAction = path.match(/^\/api\/agreements\/([A-Za-z0-9_]+)\/(complete|reopen|archive|pause|resume)$/);
  if (agreementAction && method === 'POST') {
    const body = await readJson(req);
    try {
      if (agreementAction[2] === 'complete') {
        sendJson(res, 200, completeAgreement(agreementAction[1], String(body.reason ?? '用户在约定板标记完成')));
      } else if (agreementAction[2] === 'reopen') {
        sendJson(res, 200, reopenAgreement(agreementAction[1]));
      } else if (agreementAction[2] === 'archive') {
        sendJson(res, 200, archiveAgreement(agreementAction[1]));
      } else if (agreementAction[2] === 'pause') {
        sendJson(res, 200, pauseAgreementReminders(agreementAction[1], Number(body.days ?? 7)));
      } else {
        sendJson(res, 200, resumeAgreementReminders(agreementAction[1]));
      }
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '约定操作失败');
    }
    return;
  }

  if (method === 'GET' && path === '/api/reviews') {
    sendJson(res, 200, buildWeeklyReviewView());
    return;
  }

  if (method === 'POST' && path === '/api/reviews/generate') {
    const body = await readJson(req);
    try {
      sendJson(
        res,
        200,
        await generateWeeklyReview({
          weekStart: body.weekStart == null ? undefined : String(body.weekStart),
          force: Boolean(body.force)
        })
      );
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '周记生成失败');
    }
    return;
  }

  const promiseComplete = path.match(/^\/api\/memories\/([A-Za-z0-9_]+)\/complete$/);
  if (promiseComplete && method === 'POST') {
    const body = await readJson(req);
    const memory = completePromise(promiseComplete[1], {
      by: body.by === 'user' ? 'user' : 'self',
      reason: body.reason == null ? '' : String(body.reason),
      evidence: body.evidence == null ? '' : String(body.evidence)
    });
    if (!memory) throw new HttpError(404, '这条约定不存在或已经处理过');
    sendJson(res, 200, memory);
    return;
  }

  const promiseReopen = path.match(/^\/api\/memories\/([A-Za-z0-9_]+)\/reopen$/);
  if (promiseReopen && method === 'POST') {
    const memory = reopenPromise(promiseReopen[1]);
    if (!memory) throw new HttpError(404, '这条约定不在已完成状态');
    sendJson(res, 200, memory);
    return;
  }

  const memoryMatch = path.match(/^\/api\/memories\/([A-Za-z0-9_]+)$/);
  if (memoryMatch && method === 'GET') {
    const memory = getMemory(memoryMatch[1]);
    if (!memory) throw new HttpError(404, '记忆不存在');
    sendJson(res, 200, memory);
    return;
  }
  if (memoryMatch && method === 'PATCH') {
    const body = await readJson(req);
    if (body.content != null) {
      assertText(body.content, '记忆内容', 2, 600);
    }
    const memory = updateMemory(memoryMatch[1], {
      content: body.content,
      title: body.title,
      kind: body.kind == null ? undefined : memoryKind(body.kind),
      importance: body.importance == null ? undefined : Number(body.importance),
      confidence: body.confidence == null ? undefined : Number(body.confidence),
      pinned: body.pinned == null ? undefined : Boolean(body.pinned),
      status: body.status === 'archived' || body.status === 'active' ? body.status : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
      meta: body.meta && typeof body.meta === 'object' ? body.meta : undefined
    });
    sendJson(res, 200, memory);
    return;
  }
  if (memoryMatch && method === 'DELETE') {
    deleteMemory(memoryMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && path === '/api/memories/summarize') {
    const result = await summarize('conv-main', true);
    sendJson(res, 200, { ok: true, result });
    return;
  }

  if (method === 'GET' && path === '/api/dates') {
    sendJson(res, 200, { dates: listImportantDates() });
    return;
  }

  if (method === 'POST' && path === '/api/dates') {
    const body = await readJson(req);
    const date = createImportantDate({
      title: assertText(body.title, '标题', 1, 80),
      month: Number(body.month),
      day: Number(body.day),
      year: body.year == null ? null : Number(body.year),
      recurring: body.recurring !== false,
      note: body.note == null ? '' : String(body.note)
    });
    sendJson(res, 201, date);
    return;
  }

  const dateMatch = path.match(/^\/api\/dates\/([A-Za-z0-9_]+)$/);
  if (dateMatch && method === 'DELETE') {
    deleteImportantDate(dateMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path === '/api/notes') {
    sendJson(res, 200, { notes: listNotes() });
    return;
  }

  if (method === 'POST' && path === '/api/notes') {
    const body = await readJson(req);
    const note = createNote({
      title: assertText(body.title, '便签标题', 1, 120),
      content: body.content == null ? '' : String(body.content),
      dueAt: body.dueAt == null ? null : Number(body.dueAt)
    });
    sendJson(res, 201, note);
    return;
  }

  const noteMatch = path.match(/^\/api\/notes\/([A-Za-z0-9_]+)$/);
  if (noteMatch && method === 'PATCH') {
    const body = await readJson(req);
    const note = updateNote(noteMatch[1], {
      title: body.title == null ? undefined : String(body.title),
      content: body.content == null ? undefined : String(body.content),
      dueAt: body.dueAt === undefined ? undefined : body.dueAt == null ? null : Number(body.dueAt),
      done: body.done === undefined ? undefined : Boolean(body.done)
    });
    sendJson(res, 200, note);
    return;
  }
  if (noteMatch && method === 'DELETE') {
    deleteNote(noteMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path === '/api/relationship') {
    const relationship = getRelationship();
    sendJson(res, 200, {
      relationship,
      events: getRelationshipEvents(30),
      stages: ['陌生', '认识', '熟悉', '信任', '亲近', '牵挂'],
      intimacy: {
        explicitThreshold: EXPLICIT_INTIMACY_THRESHOLD,
        softRefusalThreshold: EXPLICIT_SOFT_REFUSAL_THRESHOLD,
        explicitAllowed: relationshipAllowsExplicit(relationship)
      }
    });
    return;
  }

  if (method === 'PATCH' && path === '/api/relationship') {
    const body = await readJson(req);
    const relationship = updateRelationship({
      peerName: body.peerName == null ? undefined : String(body.peerName).slice(0, 40),
      notes: body.notes == null ? undefined : String(body.notes).slice(0, 2000),
      boundaries: body.boundaries == null ? undefined : String(body.boundaries).slice(0, 2000),
      affinity: body.affinity == null ? undefined : Number(body.affinity)
    });
    sendJson(res, 200, relationship);
    return;
  }

  if (method === 'GET' && path === '/api/proactive') {
    sendJson(res, 200, {
      records: getProactiveRecords(30),
      candidates: getCandidateAudit(30),
      events: getProactiveEvents(30),
      stats: proactiveStats()
    });
    return;
  }

  const proactiveDelivered = path.match(/^\/api\/proactive\/([A-Za-z0-9_]+)\/delivered$/);
  if (proactiveDelivered && method === 'POST') {
    sendJson(res, 200, markProactiveDelivered(proactiveDelivered[1]));
    return;
  }

  if (method === 'POST' && path === '/api/proactive/run') {
    const body = await readJson(req);
    await refreshWeatherCache();
    const result = await runProactive({ force: Boolean(body.force) });
    sendJson(res, 200, result);
    return;
  }

  if (method === 'GET' && path === '/api/diary') {
    const date = isDate(url.searchParams.get('date')) ? url.searchParams.get('date')! : today();
    sendJson(res, 200, { date, diary: getDiary(date) });
    return;
  }

  if (method === 'POST' && path === '/api/diary/generate') {
    const body = await readJson(req);
    const date = isDate(body.date) ? body.date : today();
    const diary = await generateDiary(date, Boolean(body.force));
    sendJson(res, 200, diary);
    return;
  }

  if (method === 'GET' && path === '/api/dreams') {
    sendJson(res, 200, { dreams: getDreams(numberParam(url.searchParams.get('limit'), 10, 1, 50)) });
    return;
  }

  if (method === 'POST' && path === '/api/dreams/generate') {
    const dream = await generateDream(true);
    sendJson(res, 200, dream);
    return;
  }

  if (method === 'GET' && path === '/api/settings') {
    sendJson(res, 200, publicSettings());
    return;
  }

  if (method === 'PUT' && path === '/api/settings') {
    const body = await readJson(req);
    if (body.provider && typeof body.provider.apiKey === 'string' && !body.provider.apiKey.trim()) {
      delete body.provider.apiKey;
    }
    if (body.memory?.embedding && typeof body.memory.embedding.apiKey === 'string' && !body.memory.embedding.apiKey.trim()) {
      delete body.memory.embedding.apiKey;
    }
    if (body.memory?.rerank && typeof body.memory.rerank.apiKey === 'string' && !body.memory.rerank.apiKey.trim()) {
      delete body.memory.rerank.apiKey;
    }
    if (body.vision && typeof body.vision.apiKey === 'string' && !body.vision.apiKey.trim()) {
      delete body.vision.apiKey;
    }
    const settings = saveSettings(body);
    syncConversationProfile();
    void refreshWeatherCache();
    sendJson(res, 200, publicSettings());
    void settings;
    return;
  }

  if (method === 'POST' && path === '/api/settings/clear-key') {
    const body = await readJson(req);
    const scope =
      body.scope === 'embedding' ||
      body.scope === 'rerank' ||
      body.scope === 'vision' ||
      body.scope === 'voice' ||
      body.scope === 'image'
        ? body.scope
        : 'provider';
    if (scope === 'embedding') {
      saveSettings({ memory: { embedding: { apiKey: '' } } });
    } else if (scope === 'rerank') {
      saveSettings({ memory: { rerank: { apiKey: '' } } });
    } else if (scope === 'vision') {
      saveSettings({ vision: { apiKey: '' } });
    } else if (scope === 'voice') {
      saveSettings({ voice: { apiKey: '' } });
    } else if (scope === 'image') {
      saveSettings({ image: { apiKey: '' } });
    } else {
      saveSettings({ provider: { apiKey: '' } });
    }
    sendJson(res, 200, publicSettings());
    return;
  }

  if (method === 'POST' && path === '/api/settings/test-embedding') {
    const body = await readJson(req);
    if (body.embedding) {
      if (typeof body.embedding.apiKey === 'string' && !body.embedding.apiKey.trim()) {
        delete body.embedding.apiKey;
      }
      saveSettings({ memory: { embedding: body.embedding } });
    }
    if (!embeddingConfigured()) {
      throw new HttpError(400, '请先启用 Embedding、填写地址和模型，并提供 API Key');
    }
    const started = Date.now();
    try {
      const [vector] = await embedTexts(['Alive 语义记忆连接测试']);
      if (!vector) throw new Error('没有返回向量');
      sendJson(res, 200, {
        ok: true,
        dimensions: vector.length,
        latencyMs: Date.now() - started,
        message: `Embedding 正常，返回 ${vector.length} 维向量`
      });
    } catch (error) {
      throw new HttpError(
        502,
        'Embedding 连接失败',
        error instanceof Error ? error.message : String(error)
      );
    }
    return;
  }

  if (method === 'POST' && path === '/api/settings/test-rerank') {
    const body = await readJson(req);
    if (body.rerank) {
      if (typeof body.rerank.apiKey === 'string' && !body.rerank.apiKey.trim()) {
        delete body.rerank.apiKey;
      }
      saveSettings({ memory: { rerank: body.rerank } });
    }
    if (!rerankConfigured()) {
      throw new HttpError(400, '请先启用 Rerank、填写地址和模型，并提供 API Key');
    }
    const started = Date.now();
    try {
      const scores = await rerankDocuments('他最近在画画', [
        '对方喜欢在晚上画画，进入状态后会忘记时间。',
        '今天食堂的饭有点咸。'
      ]);
      if (!scores.length) throw new Error('没有返回排序结果');
      sendJson(res, 200, {
        ok: true,
        scores,
        latencyMs: Date.now() - started,
        message: 'Rerank 正常'
      });
    } catch (error) {
      throw new HttpError(
        502,
        'Rerank 连接失败',
        error instanceof Error ? error.message : String(error)
      );
    }
    return;
  }

  if (method === 'POST' && path === '/api/settings/test-voice') {
    const body = await readJson(req);
    if (body.voice) {
      if (typeof body.voice.apiKey === 'string' && !body.voice.apiKey.trim()) {
        delete body.voice.apiKey;
      }
      saveSettings({ voice: body.voice });
    }
    if (!voiceReady()) {
      throw new HttpError(400, '请先填写语音 API Key、Voice ID 和模型');
    }
    const started = Date.now();
    try {
      const voice = await testVoice(String(body.text ?? ''));
      sendJson(res, 200, {
        ok: true,
        url: voice.url,
        latencyMs: Date.now() - started,
        message: '语音合成正常'
      });
    } catch (error) {
      throw new HttpError(
        502,
        '语音连接失败',
        error instanceof Error ? error.message : String(error)
      );
    }
    return;
  }

  if (method === 'POST' && path === '/api/settings/test') {
    const body = await readJson(req);
    if (body.provider) {
      if (typeof body.provider.apiKey === 'string' && !body.provider.apiKey.trim()) {
        delete body.provider.apiKey;
      }
      saveSettings({ provider: body.provider });
    }
    if (!llmConfigured()) {
      sendJson(res, 200, {
        ok: false,
        demo: true,
        message: '当前是离线演示模式。填入 API Key 后才能真正连接模型。'
      });
      return;
    }
    const started = Date.now();
    try {
      const result = await complete({
        task: 'test',
        system: '你是一个连接测试。只回复用户要求的内容，不要解释。',
        messages: [{ role: 'user', content: '只回复：连接正常' }],
        temperature: 0,
        maxTokens: 32
      });
      sendJson(res, 200, {
        ok: true,
        demo: false,
        text: result.text.trim(),
        model: result.model,
        latencyMs: Date.now() - started
      });
    } catch (error) {
      throw new HttpError(
        502,
        '模型连接失败',
        error instanceof LLMError ? error.detail || error.message : String(error)
      );
    }
    return;
  }

  if (method === 'POST' && path === '/api/settings/geocode') {
    const body = await readJson(req);
    const city = assertText(body.city, '城市', 1, 40);
    const found = await geocodeCity(city);
    if (!found) throw new HttpError(404, '没有找到这个城市，请手动填写经纬度');
    saveSettings({
      life: { city: found.name, latitude: found.latitude, longitude: found.longitude }
    });
    void refreshWeatherCache();
    sendJson(res, 200, found);
    return;
  }

  if (method === 'POST' && path === '/api/character/references') {
    const body = await readJson(req);
    try {
      const reference = addCharacterReference(
        assertText(body.dataUrl, '参考图', 20, 14_000_000),
        String(body.caption ?? '').slice(0, 200)
      );
      sendJson(res, 201, reference);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '参考图保存失败');
    }
    return;
  }

  const referenceMatch = path.match(/^\/api\/character\/references\/([A-Za-z0-9_]+)$/);
  if (referenceMatch && method === 'DELETE') {
    deleteCharacterReference(referenceMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path === '/api/character') {
    sendJson(res, 200, getCharacter());
    return;
  }

  if (method === 'PUT' && path === '/api/character') {
    const body = await readJson(req);
    const character = updateCharacter(body as CharacterPatch);
    sendJson(res, 200, character);
    return;
  }

  if (method === 'POST' && path === '/api/character/import') {
    const body = await readJson(req);
    const card = body.card && typeof body.card === 'object' ? body.card : body;
    const character = importCard({
      ...card,
      avatarDataUrl: body.avatarDataUrl ?? card.avatarDataUrl
    });
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = 'conv-main'"
    ).run(`和${character.name}的对话`, nowMs());
    const userMessages = db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'conv-main' AND role = 'user'")
      .get() as { n: number };
    if (Number(userMessages.n) === 0 && character.firstMes) {
      const greeting = db
        .prepare("SELECT id FROM messages WHERE conversation_id = 'conv-main' AND kind = 'greeting' LIMIT 1")
        .get() as { id: string } | undefined;
      if (greeting) {
        db.prepare('UPDATE messages SET content = ?, segments = ? WHERE id = ?').run(
          character.firstMes,
          JSON.stringify([character.firstMes]),
          greeting.id
        );
      }
    }
    sendJson(res, 200, character);
    return;
  }

  if (method === 'POST' && path === '/api/character/avatar') {
    const body = await readJson(req);
    const dataUrl = assertText(body.dataUrl, '头像', 20, 8_000_000);
    const url = saveAvatar(dataUrl);
    sendJson(res, 200, { avatarUrl: url });
    return;
  }

  if (method === 'GET' && path === '/api/stats') {
    sendJson(res, 200, getStats());
    return;
  }

  if (method === 'GET' && path === '/api/export') {
    const data = exportAll();
    const settingsRows = (data.settings ?? []) as { key: string; value: string }[];
    data.settings = settingsRows.map((row) => {
      if (row.key !== 'app') return row;
      try {
        const parsed = JSON.parse(row.value);
        if (parsed?.provider) parsed.provider.apiKey = '';
        if (parsed?.memory?.embedding) parsed.memory.embedding.apiKey = '';
        if (parsed?.memory?.rerank) parsed.memory.rerank.apiKey = '';
        if (parsed?.vision) parsed.vision.apiKey = '';
        if (parsed?.voice) parsed.voice.apiKey = '';
        if (parsed?.image) parsed.image.apiKey = '';
        if (parsed?.liveAssistant) parsed.liveAssistant.cookie = '';
        return { ...row, value: JSON.stringify(parsed) };
      } catch {
        return row;
      }
    });
    (data as Record<string, unknown>)._meta = {
      app: 'alive',
      version: VERSION,
      exportedAt: new Date().toISOString()
    };
    const body = JSON.stringify(data, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="alive-export-${today()}.json"`,
      'Cache-Control': 'no-store'
    });
    res.end(body);
    return;
  }

  if (method === 'GET' && path === '/api/events/stream') {
    attachEventsStream(req, res);
    return;
  }

  if (path.startsWith('/api/')) {
    throw new HttpError(404, '接口不存在');
  }

  if (serveStatic(req, res, path)) return;
  sendText(res, 404, 'Not found. 开发模式下请打开 http://127.0.0.1:5173');
}

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message, detail: error.detail });
      return;
    }
    console.error('[http]', error);
    sendJson(res, 500, {
      error: '服务器出了点问题',
      detail: error instanceof Error ? error.message : String(error)
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Alive v${VERSION}`);
  console.log(`  API   http://${HOST}:${PORT}`);
  console.log(`  Data  ${DATA_DIR}\n`);
  void import('./scheduler.js').then(({ startScheduler }) => startScheduler());
});

function shutdown(): void {
  console.log('\n  Alive is going to sleep…');
  void import('./scheduler.js').then(({ stopScheduler }) => stopScheduler());
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
