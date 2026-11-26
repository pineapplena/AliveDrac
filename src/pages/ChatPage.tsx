import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  CloudSun,
  Coffee,
  Eye,
  ImagePlus,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Shirt,
  Sparkles,
  Square,
  Trash2,
  WifiOff,
  X
} from 'lucide-react';
import type {
  Attachment,
  Character,
  GeneratedImage,
  LifeView,
  Message,
  PublicSettings,
  VoiceAttachment
} from '../../shared/types';
import { api, streamChat, type LiveEvent } from '../api';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { StatBar } from '../components/StatBar';
import type { ToastKind } from '../components/Toast';
import { prepareImage } from '../lib/image';
import {
  categoryInfo,
  clock,
  cn,
  dayLabel,
  energyLabel,
  hm,
  moodLabel,
  segmentsOf
} from '../utils';

interface Props {
  character: Character;
  settings: PublicSettings;
  demo: boolean;
  live: LiveEvent | null;
  unread: number;
  onRead: () => void;
  onOpenSettings: () => void;
  onToast: (message: string, kind?: ToastKind) => void;
  onRefresh: () => Promise<void>;
}

export function ChatPage({
  character,
  settings,
  demo,
  live,
  unread,
  onRead,
  onOpenSettings,
  onToast,
  onRefresh
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [life, setLife] = useState<LifeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [memoryCount, setMemoryCount] = useState(0);
  const [memoryMode, setMemoryMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [voicePending, setVoicePending] = useState(false);
  const [autoplayVoiceId, setAutoplayVoiceId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const silentAbortRef = useRef(false);

  const load = async () => {
    setLoading(true);
    try {
      const [messageData, lifeData] = await Promise.all([
        api.messages(100),
        api.life()
      ]);
      setMessages(messageData.messages);
      setLife(lifeData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取对话失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (unread > 0) onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  useEffect(() => {
    if (!live) return;
    if (live.type === 'messages_cleared') {
      setMessages([]);
      setStreaming('');
      setSending(false);
      setStatusText(null);
      setError(null);
      setLastFailed(null);
      setMemoryCount(0);
      setMemoryMode(null);
      onRead();
    }
    if (live.type === 'message' && live.data?.conversationId === 'conv-main') {
      const message = live.data as Message;
      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) return current;
        return [...current, message];
      });
      if (message.role === 'assistant') {
        onRead();
        if (message.meta?.voice && settings.voice.autoplay) {
          setAutoplayVoiceId(message.id);
        }
      }
    }
    if (live.type === 'message_voice' && live.data?.conversationId === 'conv-main') {
      const message = live.data as Message;
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? message : item))
      );
      if (message.role === 'assistant' && settings.voice.autoplay) {
        setAutoplayVoiceId(message.id);
      }
    }
    if (live.type === 'state') {
      const data = live.data as {
        state: LifeView['state'];
        block: LifeView['currentBlock'];
        next: LifeView['nextBlock'];
        weather: LifeView['weather'];
        date: string;
      };
      setLife((current) => {
        if (!current) return current;
        const block = data.block ?? null;
        return {
          ...current,
          state: data.state ?? current.state,
          date: data.date ?? current.date,
          currentBlock: block,
          nextBlock: data.next ?? null,
          weather: data.weather ?? current.weather,
          blocks: block
            ? current.blocks.map((item) =>
                item.id === block.id ? { ...item, ...block } : item
              )
            : current.blocks
        };
      });
    }
    if (live.type === 'schedule' || live.type === 'outfit_photo') {
      void refreshLife();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming, sending]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(180, Math.max(24, input.scrollHeight))}px`;
  }, [draft]);

  const refreshLife = async () => {
    try {
      setLife(await api.life());
    } catch {
      // best effort
    }
  };

  const attachFile = async (file: File) => {
    if (uploading || sending) return;
    if (attachments.length >= 4) {
      onToast('一次最多带四张图', 'info');
      return;
    }
    setUploading(true);
    try {
      const prepared = await prepareImage(file);
      const attachment = await api.uploadImage({
        dataUrl: prepared.dataUrl,
        name: prepared.name,
        width: prepared.width,
        height: prepared.height
      });
      setAttachments((current) => [...current, attachment].slice(0, 4));
    } catch (error) {
      onToast(error instanceof Error ? error.message : '图片上传失败', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    const pending = attachments;
    if ((!text && !pending.length) || sending || uploading) return;
    setDraft('');
    setAttachments([]);
    setSending(true);
    setStreaming('');
    setVoicePending(false);
    setStatusText(pending.length ? '她正在看图片…' : null);
    setError(null);
    setLastFailed(null);
    setMemoryCount(0);
    setMemoryMode(null);
    const tempId = `local-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      conversationId: 'conv-main',
      role: 'user',
      content: text || '（发来一张图片）',
      segments: [text || '（发来一张图片）'],
      kind: 'chat',
      meta: {},
      attachments: pending,
      createdAt: Date.now()
    };
    setMessages((current) => [...current, optimistic]);
    const controller = new AbortController();
    abortRef.current = controller;
    let completed = false;

    try {
      await streamChat(
        text,
        {
          onStatus: (status) => setStatusText(status),
          onMeta: (data) => {
            setStatusText(null);
            setMessages((current) => {
              const without = current.filter(
                (message) => message.id !== tempId && message.id !== data.userMessage.id
              );
              return [...without, data.userMessage];
            });
            setMemoryCount(data.memoryCount);
            setMemoryMode(data.memoryMode ?? null);
            setVoicePending(Boolean(data.voicePlanned));
          },
          onDelta: (delta) => {
            setStatusText(null);
            setStreaming((current) => current + delta);
          },
          onDone: (data) => {
            completed = true;
            if (data.message.meta?.voice && settings.voice.autoplay) {
              setAutoplayVoiceId(data.message.id);
            }
            setMessages((current) => {
              const existing = current.find((message) => message.id === data.message.id);
              const merged = existing
                ? {
                    ...data.message,
                    meta: { ...data.message.meta, ...existing.meta }
                  }
                : data.message;
              const withoutTemp = current.filter(
                (message) => message.id !== tempId && message.id !== data.message.id
              );
              return [...withoutTemp, merged];
            });
            setStreaming('');
            setSending(false);
            setVoicePending(false);
            setLastFailed(null);
            setStatusText(null);
          },
          onError: (message, detail) => {
            setError(detail ? `${message}（${detail}）` : message);
            setLastFailed(text);
            setSending(false);
            setVoicePending(false);
            setStatusText(null);
          }
        },
        controller.signal,
        pending.map((attachment) => attachment.id)
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        if (!silentAbortRef.current) onToast('已经停下来了', 'info');
      } else {
        const message = err instanceof Error ? err.message : '发送失败';
        setError(message);
        setLastFailed(text);
        onToast(message, 'error');
      }
      setSending(false);
      setStatusText(null);
    } finally {
      abortRef.current = null;
      silentAbortRef.current = false;
      if (!completed) setSending(false);
      setStatusText(null);
      void refreshLife();
      void onRefresh();
    }
  };

  const stop = (silent = false) => {
    silentAbortRef.current = silent;
    abortRef.current?.abort();
    setSending(false);
  };

  const clearHistory = async () => {
    if (clearing) return;
    setClearing(true);
    if (abortRef.current) {
      stop(true);
      abortRef.current = null;
    }
    try {
      const result = await api.clearMessages();
      setMessages([]);
      setStreaming('');
      setSending(false);
      setStatusText(null);
      setError(null);
      setLastFailed(null);
      setMemoryCount(0);
      setMemoryMode(null);
      setConfirmClear(false);
      onRead();
      const removed: string[] = [];
      if (result.messages > 0) removed.push(`${result.messages} 条聊天记录`);
      if (result.uploads > 0) removed.push(`${result.uploads} 张图片`);
      onToast(
        removed.length ? `已经清掉 ${removed.join('、')}` : '对话本来就是空的',
        'success'
      );
      void refreshLife();
      void onRefresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : '清空聊天记录失败', 'error');
    } finally {
      setClearing(false);
    }
  };

  const grouped = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    for (const message of messages) {
      const date = new Date(message.createdAt).toDateString();
      const last = groups.at(-1);
      if (last && last.date === date) last.messages.push(message);
      else groups.push({ date, messages: [message] });
    }
    return groups;
  }, [messages]);

  const draftSegments = streaming ? segmentsOf(streaming) : [];
  const state = life?.state;
  const current = life?.currentBlock;
  const next = life?.nextBlock;
  const weather = life?.weather;
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const recentChat =
    latestAssistant &&
    latestAssistant.kind !== 'greeting' &&
    Date.now() - latestAssistant.createdAt < 3_600_000;
  const outfitPhoto = life?.outfitPhoto ?? null;
  const outfitAvatar = settings.chatAvatarSource === 'outfit' && Boolean(outfitPhoto?.url);
  const chatAvatarUrl = outfitAvatar ? outfitPhoto?.url ?? null : character.avatarUrl;

  const toggleOutfitAvatar = async () => {
    if (!outfitPhoto?.url) {
      onToast('今天的穿搭照还没生成', 'info');
      return;
    }
    try {
      await api.saveSettings({
        chatAvatarSource: outfitAvatar ? 'character' : 'outfit'
      });
      await onRefresh();
      onToast(outfitAvatar ? '聊天头像换回角色头像了' : '聊天头像换成今天的穿搭照了', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '切换头像失败', 'error');
    }
  };

  return (
    <div className="chat-layout">
      <section className="chat-column">
        <header className="chat-head">
          <div className="chat-person">
            <Avatar name={character.name} src={chatAvatarUrl} size={42} online />
            <div>
              <h1>{character.name}</h1>
              <p>
                {sending ? (
                  <span className="typing-label">
                    <i />
                    {statusText ?? '正在输入'}
                  </span>
                ) : recentChat ? (
                  `刚刚还在说话 · ${state?.currentActivity ?? '在忙自己的事'}`
                ) : (
                  state?.currentActivity ?? '在过自己的日子'
                )}
              </p>
            </div>
          </div>
          <div className="chat-head-actions">
            <button
              className="icon-button"
              onClick={() => void load()}
              disabled={loading || clearing}
              aria-label="刷新对话"
              title="刷新对话"
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button danger"
              onClick={() => setConfirmClear(true)}
              disabled={loading || clearing}
              aria-label="清除聊天记录"
              title="清除聊天记录"
            >
              <Trash2 size={17} />
            </button>
          </div>
        </header>

        {demo && (
          <button className="demo-banner" onClick={onOpenSettings}>
            <WifiOff size={16} />
            <span>
              <strong>离线演示</strong>
              现在她使用的是内置语气。填了 API Key 后，她才会真正读你的话、想起旧事。
            </span>
            <em>连接模型 →</em>
          </button>
        )}

        <div className="message-scroll" ref={scrollRef}>
          {loading ? (
            <div className="chat-loading">
              <Loader2 size={18} className="spin" />
              正在把对话取回来
            </div>
          ) : (
            <>
              {grouped.length === 0 && (
                <div className="chat-empty">
                  <Avatar name={character.name} src={chatAvatarUrl} size={64} />
                  <h2>{character.name} 在等你说第一句话</h2>
                  <p>{character.firstMes || '……你来了。'}</p>
                  <div className="greeting-options">
                    {character.alternateGreetings.slice(0, 3).map((greeting) => (
                      <button key={greeting} onClick={() => void send(greeting)} disabled={sending}>
                        {greeting}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {grouped.map((group) => (
                <div key={group.date} className="message-group">
                  <div className="date-divider">
                    <span />
                    {dayLabel(group.messages[0].createdAt)}
                    <span />
                  </div>
                  {group.messages.map((message) => (
                    <MessageBlock
                      key={message.id}
                      message={message}
                      character={character}
                      avatarUrl={chatAvatarUrl}
                      autoplayVoice={autoplayVoiceId === message.id}
                    />
                  ))}
                </div>
              ))}

              {sending && (
                <div className="message-group assistant-group">
                  {draftSegments.length === 0 ? (
                    <div className="message-row assistant">
                      <Avatar name={character.name} src={chatAvatarUrl} size={30} />
                      <div className="bubble assistant typing-bubble">
                        {voicePending ? (
                          <span className="voice-pending-label">她正在用声音回答…</span>
                        ) : (
                          <>
                            <i />
                            <i />
                            <i />
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    draftSegments.map((segment, index) => (
                      <div className="message-row assistant" key={`${index}-${segment.slice(0, 8)}`}>
                        {index === 0 ? (
                          <Avatar name={character.name} src={chatAvatarUrl} size={30} />
                        ) : (
                          <span className="avatar-spacer" />
                        )}
                        <div className="bubble assistant streaming">
                          {segment}
                          {index === draftSegments.length - 1 && <span className="stream-caret" />}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {memoryCount > 0 && !sending && (
                <div className="memory-note">
                  <Brain size={13} />
                  这次她想起了 {memoryCount} 段往事
                  {memoryMode === 'hybrid+rerank'
                    ? '（语义 + 重排）'
                    : memoryMode === 'hybrid'
                      ? '（语义）'
                      : memoryMode === 'rerank'
                        ? '（重排）'
                        : ''}
                </div>
              )}

              {error && (
                <div className="chat-error">
                  <span>{error}</span>
                  {lastFailed && (
                    <button
                      onClick={() => {
                        setError(null);
                        void send(lastFailed);
                      }}
                    >
                      再试一次
                    </button>
                  )}
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <div className="composer-wrap">
          <div className={cn('composer', sending && 'sending')}>
            {attachments.length > 0 && (
              <div className="pending-attachments">
                {attachments.map((attachment) => (
                  <div className="pending-image" key={attachment.id}>
                    <img src={attachment.url} alt="待发送图片" />
                    <button
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((item) => item.id !== attachment.id)
                        )
                      }
                      aria-label="移除图片"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {attachments.length > 0 && !settings.vision.enabled && (
              <div className="vision-warning">
                <Eye size={13} />
                识图模型还没启用，她这次看不清这张图。去设置 → 模型里开启。
              </div>
            )}
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={`和${character.name}说点什么，或发一张图…`}
              rows={1}
              maxLength={4000}
              disabled={sending || uploading}
            />
            <div className="composer-foot">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attachFile(file);
                }}
              />
              <button
                className="icon-button small attach-button"
                onClick={() => fileRef.current?.click()}
                disabled={sending || uploading}
                aria-label="发送图片"
                title="发送图片"
              >
                {uploading ? <Loader2 size={16} className="spin" /> : <ImagePlus size={17} />}
              </button>
              <span>
                {uploading ? (
                  '正在处理图片…'
                ) : sending ? (
                  <>
                    <Sparkles size={13} /> {statusText ?? '她正在想'}
                  </>
                ) : attachments.length ? (
                  `已选 ${attachments.length} 张图 · Enter 发送`
                ) : (
                  'Enter 发送 · Shift + Enter 换行'
                )}
              </span>
              {sending ? (
                <button className="send-button stop" onClick={() => stop()} aria-label="停止生成">
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  onClick={() => void send()}
                  disabled={(!draft.trim() && attachments.length === 0) || uploading}
                  aria-label="发送"
                >
                  <ArrowUp size={18} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </div>
          <p className="composer-note">
            <MessageCircle size={12} />
            她有自己的生活，不一定会立刻回你。
          </p>
        </div>
      </section>

      <aside className="chat-side">
        <section className="chat-outfit-card">
          <div className="chat-outfit-head">
            <span>
              <Shirt size={13} /> 今日穿搭
            </span>
            <small>{life?.date}</small>
          </div>
          {outfitPhoto?.url ? (
            <a
              className="chat-outfit-photo"
              href={outfitPhoto.url}
              target="_blank"
              rel="noreferrer"
            >
              <img src={outfitPhoto.url} alt="今天的穿搭照" />
            </a>
          ) : (
            <div className="chat-outfit-placeholder">
              <Avatar name={character.name} src={character.avatarUrl} size={42} />
              <span>今早的穿搭照还没生成</span>
            </div>
          )}
          <p>{state?.outfit || '今天还没换衣服。'}</p>
          <button
            className="text-button chat-outfit-toggle"
            onClick={() => void toggleOutfitAvatar()}
            disabled={!outfitPhoto?.url}
          >
            {outfitAvatar ? '用回角色头像' : '用这张做聊天头像'}
          </button>
        </section>

        <section className="now-card">
          <div className="now-head">
            <span className="eyebrow">
              <i className="live-dot" /> 此刻
            </span>
            <span>{clock(Date.now())}</span>
          </div>
          <h2>{state?.currentActivity ?? '发呆'}</h2>
          <p className="now-detail">
            {current?.detail ?? '她正安静地待在自己的生活里。'}
          </p>
          <div className="now-meta">
            <span>
              <MapPin size={13} /> {state?.currentLocation ?? '房间'}
            </span>
            {weather && (
              <span>
                <CloudSun size={13} /> {weather.label} {Math.round(weather.temperature)}°
              </span>
            )}
          </div>
          {next && (
            <div className="next-block">
              <Coffee size={14} />
              接下来 {hm(next.startMin)} · {next.activity}
            </div>
          )}
        </section>

        <section className="side-card">
          <div className="side-card-head">
            <span>身体与心情</span>
            <small>{state ? `${moodLabel(state.mood)} · ${energyLabel(state.energy)}` : ''}</small>
          </div>
          <StatBar
            label="心情"
            value={state ? (state.mood + 1) / 2 : 0.5}
            text={state ? moodLabel(state.mood) : ''}
            color="var(--rose)"
          />
          <StatBar
            label="精力"
            value={state?.energy ?? 0.5}
            text={state ? energyLabel(state.energy) : ''}
            color="var(--sage)"
          />
          <StatBar
            label="饥饿"
            value={state?.hunger ?? 0.3}
            text={state ? `${Math.round(state.hunger * 100)}%` : ''}
            color="var(--amber)"
          />
        </section>

        <section className="side-card today-mini">
          <div className="side-card-head">
            <span>今天</span>
            <small>{life?.date}</small>
          </div>
          <div className="mini-timeline">
            {(life?.blocks ?? [])
              .filter((block) => block.endMin >= (current?.startMin ?? 0) - 120)
              .slice(0, 5)
              .map((block) => {
                const info = categoryInfo(block.category);
                const active = block.id === current?.id;
                return (
                  <div key={block.id} className={cn('mini-row', active && 'active')}>
                    <span className="mini-time">{hm(block.startMin)}</span>
                    <i style={{ background: info.color }} />
                    <span className="mini-activity">{block.activity}</span>
                  </div>
                );
              })}
          </div>
        </section>

        <section className="side-card memory-mini">
          <div className="side-card-head">
            <span>她记得</span>
            <small>{life?.memoryStats.total ?? 0} 条</small>
          </div>
          <div className="memory-mini-row">
            <Brain size={16} />
            <p>
              {life?.memoryStats.promises
                ? `还有 ${life.memoryStats.promises} 件答应过你的事没做完。`
                : '目前没有悬着的事。'}
            </p>
          </div>
        </section>
      </aside>

      <Modal
        open={confirmClear}
        title="清除聊天记录"
        subtitle="只清空这段对话，不动她这个人"
        onClose={() => {
          if (!clearing) setConfirmClear(false);
        }}
        footer={
          <>
            <button
              className="button ghost"
              onClick={() => setConfirmClear(false)}
              disabled={clearing}
            >
              先留着
            </button>
            <button
              className="button danger"
              onClick={() => void clearHistory()}
              disabled={clearing}
            >
              {clearing ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Trash2 size={15} />
              )}
              {clearing ? '正在清空…' : '清空聊天记录'}
            </button>
          </>
        }
      >
        <div className="clear-chat-body">
          <p className="clear-chat-warn">
            <AlertTriangle size={15} />
            清空之后没法撤回。
          </p>
          <div className="clear-chat-block">
            <p className="clear-chat-label">会删除</p>
            <ul>
              <li>你们来回的所有消息，包括她主动发来的</li>
              <li>聊天里发过的图片</li>
              <li>还没整理成长期记忆的原始对话</li>
              <li>未读提醒，以及“刚刚还在说话”的状态</li>
            </ul>
          </div>
          <div className="clear-chat-block">
            <p className="clear-chat-label">会保留</p>
            <ul>
              <li>她已经记住的事，以及你们之间的关系</li>
              <li>她的日程、生活状态、日记和梦</li>
            </ul>
          </div>
          <p className="clear-chat-keep">清空以后，她会回到第一句话，重新等你开口。</p>
          {sending && (
            <p className="clear-chat-hint">她正在回你，清空会先停下这一条。</p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function MessageBlock({
  message,
  character,
  avatarUrl,
  autoplayVoice
}: {
  message: Message;
  character: Character;
  avatarUrl: string | null;
  autoplayVoice: boolean;
}) {
  const isUser = message.role === 'user';
  const segments = message.segments?.length ? message.segments : [message.content];
  const voice =
    message.meta?.voice && typeof message.meta.voice === 'object'
      ? (message.meta.voice as VoiceAttachment)
      : null;
  const messageImage =
    message.meta?.image && typeof message.meta.image === 'object'
      ? (message.meta.image as GeneratedImage)
      : null;
  const [showVoiceText, setShowVoiceText] = useState(false);
  const kindLabel =
    message.kind === 'proactive'
      ? '她主动发来的'
      : message.kind === 'outfit'
        ? '她发来的今日穿搭'
        : message.kind === 'crisis'
          ? '她在担心你'
          : null;

  if (isUser) {
    const images = message.attachments ?? [];
    return (
      <div className="message-row user">
        <div className="bubble user">
          {images.length > 0 && (
            <div className={cn('message-images', images.length > 1 && 'multi')}>
              {images.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="message-image"
                >
                  <img src={attachment.url} alt="对方发来的图片" />
                </a>
              ))}
            </div>
          )}
          {segments.map((segment, index) =>
            segment === '（发来一张图片）' && images.length > 0 ? null : (
              <p key={index}>{segment}</p>
            )
          )}
          <time>{clock(message.createdAt)}</time>
        </div>
      </div>
    );
  }

  if (voice?.url) {
    return (
      <div className={cn('message-group assistant-group', kindLabel && 'special')}>
        <div className="message-row assistant">
          <Avatar name={character.name} src={avatarUrl} size={30} />
          <div className={cn('bubble assistant voice-bubble', kindLabel && 'special-bubble')}>
            {kindLabel && <span className="bubble-kind">{kindLabel}</span>}
            <div className="voice-bubble-head">
              <span className="voice-bubble-label">语音回复</span>
              <audio
                className="message-voice"
                controls
                preload="metadata"
                autoPlay={autoplayVoice}
                src={voice.url}
              />
            </div>
            <button
              className="voice-text-toggle"
              onClick={() => setShowVoiceText((value) => !value)}
            >
              {showVoiceText ? '收起文字' : '转文字'}
            </button>
            {showVoiceText && (
              <div className="voice-transcript">
                {segments.map((segment, index) => (
                  <p key={index}>{segment}</p>
                ))}
              </div>
            )}
            <time>{clock(message.createdAt)}</time>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('message-group assistant-group', kindLabel && 'special')}>
      {segments.map((segment, index) => (
        <div className="message-row assistant" key={`${message.id}-${index}`}>
          {index === 0 ? (
            <Avatar name={character.name} src={avatarUrl} size={30} />
          ) : (
            <span className="avatar-spacer" />
          )}
          <div className={cn('bubble assistant', kindLabel && 'special-bubble')}>
            {kindLabel && index === 0 && <span className="bubble-kind">{kindLabel}</span>}
            {index === 0 && messageImage?.url && (
              <a
                className="message-outfit-photo"
                href={messageImage.url}
                target="_blank"
                rel="noreferrer"
              >
                <img src={messageImage.url} alt="她发来的今日穿搭照" />
              </a>
            )}
            <p>{segment}</p>
            {index === segments.length - 1 && <time>{clock(message.createdAt)}</time>}
          </div>
        </div>
      ))}
    </div>
  );
}

