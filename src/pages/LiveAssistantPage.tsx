import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Loader2,
  MessageCircle,
  Play,
  Radio,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Square,
  Trash2,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { LiveAssistantView, LiveEventRecord, LiveReply } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import type { ToastKind } from '../components/Toast';
import { cn, dateTime } from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

const EVENT_LABEL: Record<string, string> = {
  danmaku: '弹幕',
  gift: '礼物',
  super_chat: 'SC',
  guard: '上舰',
  enter: '进场',
  follow: '关注',
  system: '直播状态'
};

const STATUS_LABEL: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  error: '连接出错'
};

export function LiveAssistantPage({ live, onToast }: Props) {
  const [view, setView] = useState<LiveAssistantView | null>(null);
  const [roomId, setRoomId] = useState('');
  const [streamerName, setStreamerName] = useState('');
  const [cookieForm, setCookieForm] = useState({
    sessdata: '',
    biliJct: '',
    buvid3: '',
    buvid4: '',
    dedeUserId: '',
    extra: ''
  });
  const [autoReply, setAutoReply] = useState(false);
  const [replyMode, setReplyMode] = useState<'suggest' | 'send'>('suggest');
  const [cooldown, setCooldown] = useState(20);
  const [maxPerMinute, setMaxPerMinute] = useState(6);
  const [maxReplyChars, setMaxReplyChars] = useState(80);
  const [replyToGifts, setReplyToGifts] = useState(true);
  const [moderationHints, setModerationHints] = useState(true);
  const [learnFromDanmaku, setLearnFromDanmaku] = useState(true);
  const [manualText, setManualText] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const initialized = useRef(false);

  const applySettings = useCallback((next: LiveAssistantView) => {
    setView(next);
    setRoomId(next.settings.roomId);
    setStreamerName(next.settings.streamerName);
    setAutoReply(next.settings.autoReply);
    setReplyMode(next.settings.replyMode);
    setCooldown(next.settings.autoReplyCooldownSec);
    setMaxPerMinute(next.settings.maxPerMinute);
    setMaxReplyChars(next.settings.maxReplyChars);
    setReplyToGifts(next.settings.replyToGifts);
    setModerationHints(next.settings.moderationHints);
    setLearnFromDanmaku(next.settings.learnFromDanmaku);
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.live();
      if (!initialized.current) {
        initialized.current = true;
        applySettings(next);
      } else {
        setView(next);
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取主播助理失败', 'error');
    }
  }, [applySettings, onToast]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (
      live?.type === 'live_event' ||
      live?.type === 'live_reply' ||
      live?.type === 'live_status' ||
      live?.type === 'live_knowledge'
    ) {
      void load();
    }
  }, [live, load]);

  const events = useMemo(
    () => view?.events.filter((event) => event.type !== 'system') ?? [],
    [view]
  );
  const replies = view?.replies ?? [];

  const cookiePatch = () => {
    const fields = {
      sessdata: cookieForm.sessdata.trim(),
      biliJct: cookieForm.biliJct.trim(),
      buvid3: cookieForm.buvid3.trim(),
      buvid4: cookieForm.buvid4.trim(),
      dedeUserId: cookieForm.dedeUserId.trim(),
      extra: cookieForm.extra.trim()
    };
    return Object.values(fields).some(Boolean) ? { cookieFields: fields } : {};
  };

  const resetCookieForm = () => {
    setCookieForm({
      sessdata: '',
      biliJct: '',
      buvid3: '',
      buvid4: '',
      dedeUserId: '',
      extra: ''
    });
  };

  const save = async (patch: Parameters<typeof api.saveLive>[0] = {}) => {
    setSaving(true);
    try {
      const next = await api.saveLive({
        roomId,
        streamerName,
        autoReply,
        replyMode,
        autoReplyCooldownSec: cooldown,
        maxPerMinute,
        maxReplyChars,
        replyToGifts,
        moderationHints,
        learnFromDanmaku,
        ...cookiePatch(),
        ...patch
      });
      applySettings(next);
      resetCookieForm();
      onToast('主播助理设置保存好了', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const start = async () => {
    if (!roomId.trim()) {
      onToast('先填写 B 站直播间房间号', 'error');
      return;
    }
    setConnecting(true);
    try {
      await api.saveLive({
        roomId,
        streamerName,
        autoReply,
        replyMode,
        autoReplyCooldownSec: cooldown,
        maxPerMinute,
        maxReplyChars,
        replyToGifts,
        moderationHints,
        learnFromDanmaku,
        ...cookiePatch()
      });
      resetCookieForm();
      const next = await api.startLive(roomId);
      setView(next);
      if (next.status === 'error') onToast(next.error || '连接失败', 'error');
      else onToast('正在连接直播间', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '连接失败', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const stop = async () => {
    try {
      setView(await api.stopLive());
      onToast('已停止监听直播间', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '停止失败', 'error');
    }
  };

  const replyTo = async (event: LiveEventRecord) => {
    setBusy(event.id);
    try {
      await api.replyLiveEvent(event.id);
      await load();
      onToast('她想好怎么回了', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '生成回复失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const sendReply = async (reply: LiveReply) => {
    setBusy(reply.id);
    try {
      await api.sendLiveReply(reply.id);
      await load();
      onToast('已经发到直播间', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '发送失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const sendManual = async () => {
    if (!manualText.trim()) return;
    setBusy('manual');
    try {
      await api.sendLiveText(manualText.trim());
      setManualText('');
      await load();
      onToast('已经发到直播间', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '发送失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const learnNow = async () => {
    setBusy('learning');
    try {
      setView(await api.learnLiveNow());
      onToast('她从最近的弹幕里整理了一遍直播内容', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '整理失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const clearKnowledge = async () => {
    setBusy('knowledge');
    try {
      await api.clearLiveKnowledge();
      await load();
      onToast('已经清空她从弹幕里学到的内容', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '清空失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!view) {
    return (
      <div className="page-screen live-page">
        <div className="boot-card">
          <Loader2 className="spin" size={20} />
          <p>正在看直播间状态……</p>
        </div>
      </div>
    );
  }

  if (!view.installed) {
    return (
      <div className="page-screen live-page">
        <section className="live-install-card">
          <span className="eyebrow">可选扩展</span>
          <h1>主播助理还没有安装</h1>
          <p>安装后她会读取 B 站公开直播弹幕，替你陪观众聊天、回答直播内容的问题，并生成可以直接发到直播间的回复。</p>
          <button
            className="button primary"
            disabled={installing}
            onClick={async () => {
              setInstalling(true);
              try {
                applySettings(await api.installLive(true));
                onToast('主播助理已安装', 'success');
              } catch (error) {
                onToast(error instanceof Error ? error.message : '安装失败', 'error');
              } finally {
                setInstalling(false);
              }
            }}
          >
            {installing ? <Loader2 className="spin" size={15} /> : <Radio size={15} />}
            安装主播助理
          </button>
        </section>
      </div>
    );
  }

  const connected = view.status === 'connected';
  const connectingNow = view.status === 'connecting';

  return (
    <div className="page-screen live-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">可选扩展 · 主播助理</span>
          <h1>让她替你接住弹幕</h1>
          <p className="page-sub">你忙不过来时，她陪观众聊、回答直播内容的问题，也会具体感谢礼物和 SC。</p>
        </div>
        <div className={cn('live-state-pill', view.status)}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {view.status === 'connected' && view.connectionMode === 'history'
            ? '历史轮询'
            : STATUS_LABEL[view.status] ?? view.status}
        </div>
      </header>

      <div className="live-grid">
        <section className="side-card live-connection-card">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">直播间</span>
              <h2>{view.room?.title || '还没有连接'}</h2>
              <p>
                {view.room
                  ? `${view.room.uname || '主播'} · ${view.room.liveStatus === 1 ? '直播中' : '未开播'} · 在线 ${view.room.online}`
                  : '填入 B 站直播间房间号，点开始后才能读弹幕。'}
              </p>
            </div>
          </div>
          <label className="field">
            <span>B站房间号</span>
            <input
              value={roomId}
              onChange={(event) => setRoomId(event.target.value.replace(/\D/g, ''))}
              placeholder="例如 123456"
              inputMode="numeric"
            />
            <small>B站目前通常要求登录 Cookie 才能读取弹幕；发送到直播间也需要它。</small>
          </label>
          <div className="live-actions">
            {connected || connectingNow ? (
              <button className="button ghost" onClick={() => void stop()}>
                <Square size={14} /> 停止监听
              </button>
            ) : (
              <button className="button primary" onClick={() => void start()} disabled={connecting}>
                {connecting ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                开始看弹幕
              </button>
            )}
            <button className="icon-button" title="刷新状态" onClick={() => void load()}>
              <RefreshCw size={15} />
            </button>
          </div>
          {view.error && <p className="live-error">{view.error}</p>}
          {view.notice && <p className="live-notice">{view.notice}</p>}
          {!view.settings.hasCookie && (
            <p className="live-hint">
              还没有 Cookie。B站可能拒绝匿名读取弹幕；先在右侧填入登录 Cookie，再点开始。
            </p>
          )}
        </section>

        <section className="side-card live-settings-card">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">助理行为</span>
              <h2>让她接住弹幕，而不是写提词</h2>
              <p>默认只建议，不自动发送。她会直接和观众说话，不会每句都拐到你身上。</p>
            </div>
          </div>
          <div className="live-toggle-row">
            <label>
              <input
                type="checkbox"
                checked={autoReply}
                onChange={(event) => setAutoReply(event.target.checked)}
              />
              <span>自动生成回复</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={replyToGifts}
                onChange={(event) => setReplyToGifts(event.target.checked)}
              />
              <span>回应礼物和 SC</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={moderationHints}
                onChange={(event) => setModerationHints(event.target.checked)}
              />
              <span>广告/刷屏提示</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={learnFromDanmaku}
                onChange={(event) => setLearnFromDanmaku(event.target.checked)}
              />
              <span>从弹幕学习直播内容</span>
            </label>
          </div>
          <p className="live-learning-note">
            开启后，她会定期从最近的弹幕里整理直播主题、术语、规则和进度；只记直播内容，不记观众隐私。
          </p>
          <label className="field">
            <span>主播称呼</span>
            <input
              value={streamerName}
              onChange={(event) => setStreamerName(event.target.value)}
              placeholder="留空则使用你的昵称"
            />
          </label>
          <label className="field">
            <span>回复方式</span>
            <select
              value={replyMode}
              onChange={(event) => setReplyMode(event.target.value as 'suggest' | 'send')}
            >
              <option value="suggest">只生成建议（推荐）</option>
              <option value="send">生成后直接发到直播间</option>
            </select>
            <small>直接发送需要 Cookie，并且 B 站会把内容截到 20 字。</small>
          </label>
          <div className="live-range-grid">
            <label className="field">
              <span>冷却 {cooldown}s</span>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={cooldown}
                onChange={(event) => setCooldown(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>每分钟上限 {maxPerMinute}</span>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={maxPerMinute}
                onChange={(event) => setMaxPerMinute(Number(event.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span>回复长度上限 {maxReplyChars} 字</span>
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={maxReplyChars}
              onChange={(event) => setMaxReplyChars(Number(event.target.value))}
            />
          </label>
          <div className="live-cookie-head">
            <span>B站 Cookie</span>
            <small>读取通常需要 SESSDATA；代发弹幕还需要 bili_jct。留空表示不修改这一项。</small>
          </div>
          <div className="live-cookie-grid">
            <label className="field">
              <span>
                SESSDATA
                {view.settings.hasSessdata && <em>已保存</em>}
              </span>
              <input
                type="password"
                value={cookieForm.sessdata}
                onChange={(event) =>
                  setCookieForm({ ...cookieForm, sessdata: event.target.value })
                }
                placeholder={view.settings.hasSessdata ? '已保存，留空不修改' : '读取弹幕通常必需'}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>
                bili_jct
                {view.settings.hasBiliJct && <em>已保存</em>}
              </span>
              <input
                type="password"
                value={cookieForm.biliJct}
                onChange={(event) =>
                  setCookieForm({ ...cookieForm, biliJct: event.target.value })
                }
                placeholder={view.settings.hasBiliJct ? '已保存，留空不修改' : '发送弹幕必需'}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>
                buvid3
                {view.settings.hasBuvid3 && <em>已保存</em>}
              </span>
              <input
                type="password"
                value={cookieForm.buvid3}
                onChange={(event) =>
                  setCookieForm({ ...cookieForm, buvid3: event.target.value })
                }
                placeholder={view.settings.hasBuvid3 ? '已保存，留空不修改' : '可选，帮助通过风控'}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>
                buvid4
                {view.settings.hasBuvid4 && <em>已保存</em>}
              </span>
              <input
                type="password"
                value={cookieForm.buvid4}
                onChange={(event) =>
                  setCookieForm({ ...cookieForm, buvid4: event.target.value })
                }
                placeholder={view.settings.hasBuvid4 ? '已保存，留空不修改' : '可选'}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>
                DedeUserID
                {view.settings.hasDedeUserId && <em>已保存</em>}
              </span>
              <input
                type="password"
                value={cookieForm.dedeUserId}
                onChange={(event) =>
                  setCookieForm({ ...cookieForm, dedeUserId: event.target.value })
                }
                placeholder={view.settings.hasDedeUserId ? '已保存，留空不修改' : '可选'}
                autoComplete="off"
              />
            </label>
            <label className="field full">
              <span>其他 Cookie / 完整 Cookie</span>
              <textarea
                value={cookieForm.extra}
                onChange={(event) =>
                  setCookieForm({ ...cookieForm, extra: event.target.value })
                }
                placeholder="name=value; name=value；也可以直接粘贴完整 Cookie，会合并到上面"
                rows={2}
              />
            </label>
          </div>
          <small className="live-cookie-note">
            只保存在本机数据库；公开设置、导出 JSON 和日志都不会包含 Cookie。换账号时先清除全部 Cookie，再填新的。
          </small>
          <div className="live-actions">
            <button className="button" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              保存助理设置
            </button>
            {view.settings.hasCookie && (
              <button
                className="button ghost"
                disabled={saving}
                onClick={() => void save({ clearCookie: true })}
              >
                <Trash2 size={14} /> 清除 Cookie
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="live-section live-knowledge-section">
        <div className="section-head compact">
          <div>
            <span className="eyebrow"><BookOpen size={12} /> 从弹幕学习</span>
            <h2>她现在知道的直播内容</h2>
            <p>
              {view.learning.enabled
                ? view.learning.busy
                  ? '正在从最近的弹幕里整理……'
                  : view.learning.lastAt
                    ? `上次整理：${dateTime(view.learning.lastAt)}`
                    : '再多来一些弹幕，她就会开始整理。'
                : '直播学习已关闭；她只会按当前上下文回应。'}
            </p>
          </div>
          <div className="live-knowledge-actions">
            {connected && (
              <button
                className="button ghost small"
                disabled={busy === 'learning' || view.learning.busy}
                onClick={() => void learnNow()}
              >
                {busy === 'learning' || view.learning.busy ? (
                  <Loader2 className="spin" size={13} />
                ) : (
                  <RefreshCw size={13} />
                )}
                现在整理
              </button>
            )}
            {view.knowledge.length > 0 && (
              <button
                className="button ghost small"
                disabled={busy === 'knowledge'}
                onClick={() => void clearKnowledge()}
              >
                {busy === 'knowledge' ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
                清空学习
              </button>
            )}
          </div>
        </div>
        {view.learning.error && <p className="live-error">学习失败：{view.learning.error}</p>}
        {view.knowledge.length === 0 ? (
          <div className="live-knowledge-empty">
            <span>还没有足够的弹幕。</span>
            <small>她会在聊到直播内容、术语或进度时慢慢记下来，不需要你手动录入。</small>
          </div>
        ) : (
          <div className="live-knowledge-grid">
            {view.knowledge.map((entry) => (
              <article className="live-knowledge-card" key={entry.id}>
                <div className="live-knowledge-card-head">
                  <strong>{entry.topic}</strong>
                  <span>{Math.round(entry.confidence * 100)}%</span>
                </div>
                <p>{entry.content}</p>
                <small>来自 {entry.sourceCount} 次弹幕整理</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="live-stream-grid">
        <section className="live-section">
          <div className="section-head compact">
            <div>
              <span className="eyebrow"><MessageCircle size={12} /> 最近弹幕</span>
              <h2>直播间刚刚在说什么</h2>
            </div>
            <button
              className="icon-button"
              title="清空记录"
              onClick={async () => {
                if (!window.confirm('清空直播弹幕和回复记录？')) return;
                await api.clearLiveHistory();
                await load();
                onToast('直播记录已清空', 'success');
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
          {events.length === 0 ? (
            <div className="soft-empty"><p>还没有收到弹幕。开始监听后，事件会出现在这里。</p></div>
          ) : (
            <div className="live-event-list">
              {events.map((event) => (
                <article className={cn('live-event', event.flags.length > 0 && 'flagged')} key={event.id}>
                  <div className="live-event-head">
                    <span className={cn('live-event-type', event.type)}>
                      {EVENT_LABEL[event.type] ?? event.type}
                    </span>
                    <strong>{event.uname || '匿名观众'}</strong>
                    <span className="live-event-time">{dateTime(event.createdAt)}</span>
                  </div>
                  <p>{event.text || '（没有文字）'}</p>
                  {event.flags.length > 0 && (
                    <div className="live-flags">
                      <ShieldAlert size={13} />
                      {event.flags.map((flag) => <span key={flag}>{flag}</span>)}
                    </div>
                  )}
                  {event.type !== 'system' && event.type !== 'enter' && event.type !== 'follow' && (
                    <button
                      className="button ghost small"
                      disabled={busy === event.id}
                      onClick={() => void replyTo(event)}
                    >
                      {busy === event.id ? <Loader2 className="spin" size={13} /> : <MessageCircle size={13} />}
                      让她回这句
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="live-section">
          <div className="section-head compact">
            <div>
              <span className="eyebrow"><Send size={12} /> 回复</span>
              <h2>她替你说的话</h2>
            </div>
          </div>
          <div className="live-reply-list">
            {replies.length === 0 ? (
              <div className="soft-empty"><p>还没有生成回复。</p></div>
            ) : (
              replies.map((reply) => (
                <article className="live-reply" key={reply.id}>
                  <header>
                    <span>{reply.uname || '手动发送'}</span>
                    <span className={cn('live-reply-state', reply.sent ? 'sent' : reply.error ? 'failed' : 'suggest')}>
                      {reply.sent ? '已发送' : reply.error ? '发送失败' : reply.mode === 'send' ? '未能发送' : '建议'}
                    </span>
                  </header>
                  {reply.eventText && <small>观众：{reply.eventText}</small>}
                  <p>{reply.text}</p>
                  {reply.error && <small className="live-error">{reply.error}</small>}
                  {!reply.sent && view.settings.hasCookie && (
                    <button
                      className="button ghost small"
                      disabled={busy === reply.id}
                      onClick={() => void sendReply(reply)}
                    >
                      {busy === reply.id ? <Loader2 className="spin" size={13} /> : <Send size={13} />}
                      发送到直播间
                    </button>
                  )}
                </article>
              ))
            )}
          </div>
          <div className="live-manual-send">
            <input
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              placeholder="手动发一句话到直播间"
              maxLength={80}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendManual();
              }}
            />
            <button
              className="button"
              disabled={busy === 'manual' || !manualText.trim()}
              onClick={() => void sendManual()}
            >
              {busy === 'manual' ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
