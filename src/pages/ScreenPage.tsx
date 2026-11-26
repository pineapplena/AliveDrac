import { useEffect, useState } from 'react';
import {
  Eye,
  Loader2,
  Monitor,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2
} from 'lucide-react';
import type { ScreenObservation, ScreenSettings, ScreenView } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import type { ToastKind } from '../components/Toast';
import { cn, dateTime } from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

const SCENE_LABEL: Record<string, string> = {
  coding: '写代码',
  browsing: '浏览网页',
  video: '看视频',
  game: '游戏',
  work: '工作',
  chat: '聊天',
  design: '设计',
  other: '屏幕'
};

export function ScreenPage({ live, onToast }: Props) {
  const [view, setView] = useState<ScreenView | null>(null);
  const [draft, setDraft] = useState<ScreenSettings | null>(null);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const load = async () => {
    try {
      const data = await api.screen();
      setView(data);
      setDraft((current) => current ?? data.settings);
      setConsent(Boolean(data.settings.consentAt));
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取窥屏状态失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (live?.type === 'screen_observation') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const save = async () => {
    if (!draft || !view) return;
    if (draft.enabled && !view.settings.consentAt && !consent) {
      onToast('先确认下面的隐私说明', 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await api.saveScreen({
        ...draft,
        consent: !view.settings.consentAt && consent
      });
      setView((current) => (current ? { ...current, settings: next } : current));
      setDraft(next);
      setConsent(Boolean(next.consentAt));
      onToast('窥屏设置保存好了', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const peek = async () => {
    setPeeking(true);
    try {
      const result = await api.peekScreen();
      onToast(result.ok ? '她看了一眼你的屏幕' : result.reason, result.ok ? 'success' : 'info');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '这次没看到', 'error');
    } finally {
      setPeeking(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm('清空所有窥屏记录？截图本来就不会保存，这里只会删除文字记录。')) {
      return;
    }
    try {
      const result = await api.clearScreenObservations();
      onToast(`清掉了 ${result.cleared} 条记录`, 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '清空失败', 'error');
    }
  };

  const removeOne = async (observation: ScreenObservation) => {
    try {
      await api.deleteScreenObservation(observation.id);
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  if (loading && !view) {
    return (
      <div className="page-screen">
        <div className="page-loading">
          <Loader2 className="spin" size={20} />
          正在读她的窥屏设置
        </div>
      </div>
    );
  }

  if (!view || !draft) {
    return <div className="page-screen"><div className="page-loading">暂时读不到窥屏状态。</div></div>;
  }

  const capability = view.capabilities;
  const canEnable = Boolean(view.settings.consentAt) || consent;

  return (
    <div className="page-screen screen-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">屏幕窥视</span>
          <h1>她偶尔会看看你在做什么</h1>
          <p className="page-sub">
            不是录屏，也不是持续监控。她按自己的意愿偶尔截一张图，看一眼就放下。
          </p>
        </div>
        <div className="page-actions">
          <button
            className="button"
            onClick={() => void peek()}
            disabled={peeking || !view.settings.enabled || !capability.capture}
          >
            {peeking ? <Loader2 className="spin" size={15} /> : <Eye size={15} />}
            {peeking ? '正在看…' : '让她看一眼'}
          </button>
        </div>
      </header>

      <div className="screen-grid">
        <section className="side-card screen-settings">
          <div className="side-card-head">
            <span><Monitor size={15} /> 窥屏设置</span>
            <span className={cn('screen-state', view.settings.enabled && 'on')}>
              {view.settings.enabled ? '开启' : '关闭'}
            </span>
          </div>

          <p className="screen-privacy">
            截图不会保存。开启视觉模型时，截图会发送给你配置的视觉模型；密码管理器、网银/支付、验证码、私密聊天等敏感窗口会直接跳过，不会送去分析。她不会录屏，也不会读取键盘输入。
          </p>

          {!view.settings.consentAt && (
            <label className="screen-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>我知道她会偶尔截取本机屏幕，并同意在这台电脑上使用。</span>
            </label>
          )}

          <label className="toggle-row">
            <div>
              <strong>允许她窥屏</strong>
              <p>关闭后她不会自动截图，手动按钮也不会绕过隐私边界。</p>
            </div>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!canEnable}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
          </label>

          <label className="field">
            <span>最短间隔 · {draft.intervalMin} 分钟</span>
            <input
              type="range"
              min="10"
              max="120"
              step="5"
              value={draft.intervalMin}
              onChange={(event) => setDraft({ ...draft, intervalMin: Number(event.target.value) })}
            />
          </label>

          <label className="field">
            <span>想看概率 · {Math.round(draft.probability * 100)}%</span>
            <input
              type="range"
              min="5"
              max="90"
              step="5"
              value={Math.round(draft.probability * 100)}
              onChange={(event) =>
                setDraft({ ...draft, probability: Number(event.target.value) / 100 })
              }
            />
          </label>

          <label className="field">
            <span>每天最多 · {draft.dailyCap} 次</span>
            <input
              type="range"
              min="1"
              max="12"
              step="1"
              value={draft.dailyCap}
              onChange={(event) => setDraft({ ...draft, dailyCap: Number(event.target.value) })}
            />
          </label>

          <label className="toggle-row">
            <div>
              <strong>用视觉模型理解截图</strong>
              <p>
                {capability.vision
                  ? '关闭后只记录活动窗口名称，不发送图片。'
                  : '视觉模型未配置，目前只会记录活动窗口名称。'}
              </p>
            </div>
            <input
              type="checkbox"
              checked={draft.allowVision}
              disabled={!capability.vision}
              onChange={(event) => setDraft({ ...draft, allowVision: event.target.checked })}
            />
          </label>

          {!capability.capture && (
            <p className="screen-privacy warning">当前系统不支持截图，窥屏会不可用。</p>
          )}

          <div className="screen-save">
            <button className="button" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              保存设置
            </button>
          </div>
        </section>

        <section className="side-card screen-observations">
          <div className="side-card-head">
            <span><Sparkles size={15} /> 她最近看到的</span>
            <span className="screen-head-actions">
              <small>{view.todayCount} 次今天</small>
              {view.observations.length > 0 && (
                <button className="text-button" onClick={() => void clearAll()}>
                  清空记录
                </button>
              )}
            </span>
          </div>

          {view.observations.length === 0 ? (
            <div className="soft-empty small">
              <p>她还没看过你的屏幕。开启之后，她会按自己的意愿偶尔看一眼。</p>
            </div>
          ) : (
            <div className="screen-observation-list">
              {view.observations.map((observation) => (
                <article
                  key={observation.id}
                  className={cn('screen-observation', observation.sensitive && 'protected')}
                >
                  <div className="screen-observation-head">
                    <span>{dateTime(observation.capturedAt)}</span>
                    <span className="screen-observation-tags">
                      {observation.sensitive ? (
                        <em><ShieldCheck size={11} /> 没有看</em>
                      ) : (
                        <em>{SCENE_LABEL[observation.scene] ?? '屏幕'}</em>
                      )}
                      {observation.commented && <em>已提起</em>}
                      <button
                        className="icon-button small"
                        onClick={() => void removeOne(observation)}
                        aria-label="删除这条窥屏记录"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                  <strong>{observation.sensitive ? '隐私边界' : observation.appLabel || '屏幕'}</strong>
                  {observation.sensitive ? (
                    <p>{observation.skippedReason || '她看到了敏感窗口，选择没有继续看。'}</p>
                  ) : (
                    <>
                      <p>{observation.summary}</p>
                      {observation.windowTitle && (
                        <small className="screen-window">{observation.windowTitle}</small>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
