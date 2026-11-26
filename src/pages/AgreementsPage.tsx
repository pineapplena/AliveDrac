import { useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Clock3,
  Handshake,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import type { Agreement, AgreementsView } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import { Modal } from '../components/Modal';
import type { ToastKind } from '../components/Toast';
import { cn, shortDate } from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

type Tab = 'active' | 'done' | 'archived';

const EMPTY_FORM = { title: '', content: '', due: '' };

function dueDate(agreement: Agreement): string {
  if (!agreement.dueAt) return '没有截止时间';
  const date = new Date(agreement.dueAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function AgreementsPage({ live, onToast }: Props) {
  const [view, setView] = useState<AgreementsView | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agreement | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    try {
      setView(await api.agreements());
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取约定失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (live?.type === 'memory') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (agreement: Agreement) => {
    setEditing(agreement);
    setForm({
      title: agreement.title,
      content: agreement.content,
      due: agreement.dueAt ? new Date(agreement.dueAt).toISOString().slice(0, 10) : ''
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.content.trim()) {
      onToast('先写清楚约定是什么', 'info');
      return;
    }
    setBusy('save');
    try {
      const dueAt = form.due
        ? new Date(`${form.due}T20:00:00`).getTime()
        : null;
      if (editing) {
        await api.updateAgreement(editing.id, {
          title: form.title,
          content: form.content,
          dueAt
        });
        onToast('约定更新好了', 'success');
      } else {
        const result = await api.createAgreement({
          title: form.title,
          content: form.content,
          dueAt
        });
        onToast(
          result.deduplicated ? '已经有一条相似的约定了' : '约定记下了',
          result.deduplicated ? 'info' : 'success'
        );
      }
      setOpen(false);
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const action = async (
    agreement: Agreement,
    name: 'complete' | 'reopen' | 'archive' | 'pause' | 'resume'
  ) => {
    setBusy(`${agreement.id}:${name}`);
    try {
      if (name === 'complete') await api.completeAgreement(agreement.id);
      else if (name === 'reopen') await api.reopenAgreement(agreement.id);
      else if (name === 'archive') await api.archiveAgreement(agreement.id);
      else if (name === 'pause') await api.pauseAgreement(agreement.id, 7);
      else await api.resumeAgreement(agreement.id);
      onToast(
        {
          complete: '约定完成了，记忆里也会同步',
          reopen: '约定重新打开了',
          archive: '约定归档了',
          pause: '接下来 7 天不主动提醒这件事',
          resume: '恢复提醒'
        }[name],
        'success'
      );
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '操作失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const items = view ? view[tab] : [];

  return (
    <div className="page-screen agreements-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">约定板</span>
          <h1>你们说好的事</h1>
          <p>这里和记忆里的“承诺”是同一份记录。在这里完成、编辑，记忆页会同步。</p>
        </div>
        <button className="button primary" onClick={openNew}>
          <Plus size={16} /> 记一条约定
        </button>
      </header>

      <div className="agreement-summary">
        <div>
          <span>还在进行</span>
          <strong>{view?.stats.active ?? 0}</strong>
        </div>
        <div>
          <span>已经完成</span>
          <strong>{view?.stats.done ?? 0}</strong>
        </div>
        <div>
          <span>提醒暂停</span>
          <strong>{view?.stats.paused ?? 0}</strong>
        </div>
      </div>

      <div className="segmented agreement-tabs">
        {([
          ['active', '进行中'],
          ['done', '已完成'],
          ['archived', '已归档']
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} className={cn(tab === id && 'active')} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在翻你们的约定
        </div>
      ) : items.length === 0 ? (
        <div className="empty-card">
          <Handshake size={28} />
          <h2>{tab === 'active' ? '还没有正在进行的约定' : tab === 'done' ? '还没有完成的约定' : '没有归档的约定'}</h2>
          <p>
            {tab === 'active'
              ? '可以手动记一条，也可以等她在聊天里答应你之后自动出现。'
              : '完成一条约定后，它会留在这里。'}
          </p>
        </div>
      ) : (
        <div className="agreement-list">
          {items.map((agreement) => {
            const paused = Boolean(
              agreement.remindersPausedUntil && agreement.remindersPausedUntil > Date.now()
            );
            const itemBusy = busy?.startsWith(`${agreement.id}:`);
            return (
              <article className="agreement-card" key={agreement.id}>
                <div className="agreement-card-main">
                  <div className="agreement-card-top">
                    <span className="agreement-mark">
                      <Handshake size={14} />
                    </span>
                    <span className="agreement-source">
                      {agreement.status === 'done'
                        ? '已完成'
                        : agreement.source === 'agreement-board'
                          ? '手动记录'
                          : '从对话里记下'}
                    </span>
                    {paused && agreement.status === 'active' && (
                      <span className="agreement-paused">提醒暂停</span>
                    )}
                  </div>
                  <h2>{agreement.title || '一条约定'}</h2>
                  <p>{agreement.content}</p>
                  <div className="agreement-meta">
                    <span>
                      <Clock3 size={13} /> {dueDate(agreement)}
                    </span>
                    {agreement.proactiveMentions > 0 && (
                      <span>她主动提过 {agreement.proactiveMentions} 次</span>
                    )}
                    {agreement.status === 'done' && agreement.completedAt && (
                      <span>完成于 {shortDate(agreement.completedAt)}</span>
                    )}
                  </div>
                  {agreement.status === 'done' && agreement.completedReason && (
                    <div className="agreement-completion">
                      <Check size={14} />
                      {agreement.completedReason}
                    </div>
                  )}
                </div>
                <div className="agreement-actions">
                  {agreement.status === 'active' && (
                    <>
                      <button
                        className="button small primary"
                        disabled={itemBusy}
                        onClick={() => void action(agreement, 'complete')}
                      >
                        <Check size={14} /> 完成
                      </button>
                      <button
                        className="button small"
                        disabled={itemBusy}
                        onClick={() => void action(agreement, paused ? 'resume' : 'pause')}
                      >
                        {paused ? <Play size={14} /> : <Pause size={14} />}
                        {paused ? '恢复提醒' : '暂停 7 天'}
                      </button>
                      <button className="icon-button" onClick={() => openEdit(agreement)} aria-label="编辑约定">
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={itemBusy}
                        onClick={() => void action(agreement, 'archive')}
                        aria-label="归档约定"
                      >
                        <Archive size={15} />
                      </button>
                    </>
                  )}
                  {agreement.status !== 'active' && (
                    <button
                      className="button small"
                      disabled={itemBusy}
                      onClick={() => void action(agreement, 'reopen')}
                    >
                      <RotateCcw size={14} /> 重新打开
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="agreement-hint">
        <Sparkles size={14} />
        她不会无限催同一件事：每条约定最多主动提两次，暂停或完成后就不再提醒。
      </div>

      <Modal
        open={open}
        title={editing ? '编辑约定' : '记一条约定'}
        subtitle="它也会出现在记忆页的“承诺”里"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="button primary" onClick={() => void save()} disabled={busy === 'save'}>
              {busy === 'save' ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              保存
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label>
            <span>标题</span>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="比如：周末一起看一部电影"
              maxLength={80}
            />
          </label>
          <label>
            <span>约定内容</span>
            <textarea
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              placeholder="说清楚你们约定了什么，之后她才会自然接上。"
              rows={5}
              maxLength={600}
            />
          </label>
          <label>
            <span>大概什么时候（可选）</span>
            <input
              type="date"
              value={form.due}
              onChange={(event) => setForm({ ...form, due: event.target.value })}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
