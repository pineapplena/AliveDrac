import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Brain,
  Check,
  CheckCheck,
  Download,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react';
import type { Memory, MemoryKind, MemoryStats } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import { Modal } from '../components/Modal';
import type { ToastKind } from '../components/Toast';
import { cn, memoryKind, shortDate } from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'fact', label: '事实' },
  { id: 'preference', label: '偏好' },
  { id: 'event', label: '事件' },
  { id: 'promise', label: '承诺' },
  { id: 'relationship', label: '关系' },
  { id: 'emotion', label: '情绪' },
  { id: 'self', label: '自我' }
];

const EMPTY_FORM = {
  kind: 'fact' as MemoryKind,
  title: '',
  content: '',
  importance: 0.6,
  pinned: false
};

export function MemoryPage({ live, onToast }: Props) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    try {
      const [list, statsData] = await Promise.all([
        api.memories({ query, kind: kind === 'all' ? undefined : kind, status, limit: 150 }),
        api.memoryStats()
      ]);
      setMemories(list.memories);
      setSelected((current) => {
        const next = new Set([...current].filter((id) => list.memories.some((item) => item.id === id)));
        return next;
      });
      setStats(statsData);
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取记忆失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, status]);

  useEffect(() => {
    if (live?.type === 'memory' || live?.type === 'memory_summary') {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (memory: Memory) => {
    setEditing(memory);
    setForm({
      kind: memory.kind,
      title: memory.title,
      content: memory.content,
      importance: memory.importance,
      pinned: memory.pinned
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.content.trim()) {
      onToast('写点内容再保存吧', 'error');
      return;
    }
    setBusy('save');
    try {
      if (editing) {
        await api.updateMemory(editing.id, form);
        onToast('记忆改好了', 'success');
      } else {
        await api.createMemory(form);
        onToast('记住了', 'success');
      }
      setModalOpen(false);
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const quickUpdate = async (memory: Memory, patch: Record<string, unknown>, message: string) => {
    try {
      await api.updateMemory(memory.id, patch);
      onToast(message, 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const markDone = async (memory: Memory) => {
    try {
      await api.completeMemory(memory.id, { by: 'user', reason: '在记忆页手动标记完成' });
      onToast('这件事算完成了', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '标记失败', 'error');
    }
  };

  const reopen = async (memory: Memory) => {
    try {
      await api.reopenMemory(memory.id);
      onToast('又把这件事放回未完成了', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '重新打开失败', 'error');
    }
  };

  const reviewPromises = async () => {
    setBusy('review');
    try {
      const result = await api.reviewPromises();
      if (result.completed.length) {
        onToast(`她确认完成了 ${result.completed.length} 个约定`, 'success');
      } else if (result.reason === 'no-provider') {
        onToast('模型没连上，她没法自己判断', 'info');
      } else if (result.reason === 'memory-disabled') {
        onToast('记忆功能关着，先把记忆打开', 'info');
      } else if (result.reason === 'cooldown') {
        onToast('刚刚才看过，过一会儿再让她想', 'info');
      } else if (result.reason === 'busy') {
        onToast('她正在想，等一下', 'info');
      } else if (result.reason === 'no-dialogue') {
        onToast('最近没有可参考的对话', 'info');
      } else if (result.reason === 'invalid-response') {
        onToast('她这次没想清楚，稍后再试', 'info');
      } else if (result.checked) {
        onToast('这次没有新的约定算完成', 'info');
      } else {
        onToast('现在没有需要复核的约定', 'info');
      }
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '复核失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (memory: Memory) => {
    if (!window.confirm('真的要忘掉这件事吗？这会从她可检索的记忆里移除。')) return;
    try {
      await api.deleteMemory(memory.id);
      onToast('已经淡出她的记忆', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === memories.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(memories.map((memory) => memory.id)));
  };

  const removeSelected = async () => {
    if (!selected.size) return;
    if (!window.confirm(`删除选中的 ${selected.size} 条记忆？这会从她可检索的记忆里移除。`)) return;
    setBusy('bulk-delete');
    try {
      const result = await api.deleteMemories([...selected]);
      onToast(`删除了 ${result.deleted} 条记忆`, 'success');
      setSelected(new Set());
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '批量删除失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as any;
      const count = Array.isArray(parsed)
        ? parsed.length
        : Array.isArray(parsed?.memories)
          ? parsed.memories.length
          : 0;
      if (!count) {
        onToast('这个文件里没有 memories 数组', 'error');
        return;
      }
      if (!window.confirm(`从「${file.name}」导入 ${count} 条记忆？重复内容会跳过。`)) return;
      const result = await api.importMemories(parsed);
      const message = `导入 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.invalid} 条`;
      onToast(message, result.invalid > 0 ? 'info' : 'success');
      if (result.errors.length) {
        console.warn('记忆导入失败项', result.errors);
      }
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '导入失败，文件可能不是有效 JSON', 'error');
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  const summarize = async () => {
    setBusy('summarize');
    try {
      const result = await api.summarize();
      if (!result.result) {
        onToast('还没有足够的新对话可以整理', 'info');
      } else {
        onToast(`整理出了 ${result.result.created} 条记忆`, 'success');
      }
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '整理失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const activeKind = useMemo(() => memoryKind(form.kind), [form.kind]);

  return (
    <div className="page-screen memory-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">长期记忆</span>
          <h1>她记得的事</h1>
          <p className="page-sub">不是聊天记录，是她真正留下来的东西。可以改，也可以让她忘掉。</p>
        </div>
        <div className="page-actions">
          <button
            className="button ghost"
            onClick={() => void reviewPromises()}
            disabled={busy === 'review' || (stats?.promises ?? 0) === 0}
          >
            {busy === 'review' ? <Loader2 className="spin" size={15} /> : <CheckCheck size={15} />}
            复核约定
          </button>
          <button className="button ghost" onClick={() => void summarize()} disabled={busy === 'summarize'}>
            {busy === 'summarize' ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            整理记忆
          </button>
          <button className="button" onClick={openNew}>
            <Plus size={16} /> 写一条
          </button>
        </div>
      </header>

      <section className="memory-stats">
        <div>
          <span>长期记忆</span>
          <strong>{stats?.total ?? 0}</strong>
          <small>还在她心里的</small>
        </div>
        <div>
          <span>核心</span>
          <strong>{stats?.core ?? 0}</strong>
          <small>每一轮都会带着</small>
        </div>
        <div>
          <span>未完成</span>
          <strong>{stats?.promises ?? 0}</strong>
          <small>
            {stats?.completedPromises
              ? `答应过的事 · 已完成 ${stats.completedPromises}`
              : '答应过的事'}
          </small>
        </div>
        <div>
          <span>待沉淀</span>
          <strong>{stats?.timeline ?? 0}</strong>
          <small>还没被整理的对白</small>
        </div>
      </section>

      <section className="memory-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="找一件她可能记得的事…"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="清空搜索">
              ×
            </button>
          )}
        </label>
        <div className="filter-row">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              className={cn('filter-chip', kind === filter.id && 'active')}
              onClick={() => setKind(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="status-switch">
          <button className={cn(status === 'active' && 'active')} onClick={() => setStatus('active')}>
            当前
          </button>
          <button className={cn(status === 'done' && 'active')} onClick={() => setStatus('done')}>
            已完成
          </button>
          <button className={cn(status === 'archived' && 'active')} onClick={() => setStatus('archived')}>
            已淡忘
          </button>
          <button className={cn(status === 'all' && 'active')} onClick={() => setStatus('all')}>
            全部
          </button>
        </div>
        <div className="memory-io">
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <button
            className="button ghost small"
            onClick={() => importRef.current?.click()}
            disabled={importing}
          >
            {importing ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
            导入
          </button>
          <a className="button ghost small" href={api.memoryExportUrl}>
            <Download size={14} /> 导出全部
          </a>
          <button
            className="button ghost small"
            onClick={toggleAll}
            disabled={memories.length === 0}
          >
            {selected.size === memories.length && memories.length > 0 ? '取消全选' : '全选当前'}
          </button>
          <button
            className="button ghost small danger"
            onClick={() => void removeSelected()}
            disabled={!selected.size || busy === 'bulk-delete'}
          >
            {busy === 'bulk-delete' ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
            删除所选{selected.size ? ` (${selected.size})` : ''}
          </button>
        </div>
      </section>

      {loading ? (
        <div className="page-loading centered">
          <Loader2 className="spin" size={18} />
          正在翻她的记忆
        </div>
      ) : memories.length === 0 ? (
        <div className="empty-card">
          <Brain size={26} />
          <h3>{query ? '没有找到相关的事' : '这里还是空的'}</h3>
          <p>
            {query
              ? '换个词试试，或者她还没把这件事记下来。'
              : '聊过一些之后，她会在夜里把值得留下的东西整理到这里。'}
          </p>
          {!query && (
            <button className="button ghost" onClick={() => setQuery('')}>
              看看全部
            </button>
          )}
        </div>
      ) : (
        <div className="memory-grid">
          {memories.map((memory) => {
            const info = memoryKind(memory.kind);
            const doneReason =
              typeof memory.meta.completedReason === 'string' ? memory.meta.completedReason : '';
            return (
              <article
                key={memory.id}
                className={cn(
                  'memory-card',
                  memory.status === 'archived' && 'archived',
                  memory.status === 'done' && 'done'
                )}
              >
                <div className="memory-card-head">
                  <label className="memory-select" title="选择这条记忆">
                    <input
                      type="checkbox"
                      checked={selected.has(memory.id)}
                      onChange={() => toggleSelected(memory.id)}
                    />
                    <span />
                  </label>
                  <span className="memory-kind" style={{ color: info.color, background: `${info.color}18` }}>
                    {info.label}
                  </span>
                  <div className="memory-actions">
                    {memory.kind === 'promise' && memory.status === 'active' && (
                      <button
                        className="icon-button small"
                        onClick={() => void markDone(memory)}
                        title="标记约定完成"
                      >
                        <CheckCheck size={14} />
                      </button>
                    )}
                    {memory.kind === 'promise' && memory.status === 'done' && (
                      <button
                        className="icon-button small"
                        onClick={() => void reopen(memory)}
                        title="重新打开约定"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                    <button
                      className={cn('icon-button small', memory.pinned && 'active')}
                      onClick={() =>
                        void quickUpdate(
                          memory,
                          { pinned: !memory.pinned },
                          memory.pinned ? '不再时刻带着了' : '放进了核心记忆'
                        )
                      }
                      title={memory.pinned ? '取消置顶' : '置顶为核心记忆'}
                    >
                      {memory.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button className="icon-button small" onClick={() => openEdit(memory)} title="编辑">
                      <Pencil size={14} />
                    </button>
                    <button className="icon-button small" onClick={() => void remove(memory)} title="删除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {memory.title && <h3>{memory.title}</h3>}
                <p className="memory-content">{memory.content}</p>
                <div className="memory-card-foot">
                  <span>{shortDate(memory.happenedAt ?? memory.createdAt)}</span>
                  <span className="memory-importance" title={`重要度 ${Math.round(memory.importance * 100)}%`}>
                    {[0.25, 0.5, 0.75, 1].map((threshold, index) => (
                      <i key={index} className={memory.importance >= threshold ? 'on' : ''} />
                    ))}
                  </span>
                  {memory.useCount > 0 && <span>想起过 {memory.useCount} 次</span>}
                  {memory.status === 'done' && (
                    <span className="done-label" title={doneReason || '已完成'}>
                      <CheckCheck size={11} /> 已完成
                    </span>
                  )}
                  {memory.pinned && (
                    <span className="pinned-label"><Check size={11} /> 核心</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        title={editing ? '改一条记忆' : '写一条记忆'}
        subtitle="她会把这里的内容当作真实发生过的事。请写得具体一点。"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="button ghost" onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button className="button" onClick={() => void save()} disabled={busy === 'save'}>
              {busy === 'save' ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
              保存
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field">
            <span>类型</span>
            <select
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as MemoryKind })}
            >
              {['fact', 'preference', 'event', 'promise', 'relationship', 'emotion', 'self', 'core'].map(
                (key) => (
                  <option key={key} value={key}>
                    {memoryKind(key).label}
                  </option>
                )
              )}
            </select>
            <small style={{ color: activeKind.color }}>{activeKind.hint}</small>
          </label>
          <label className="field">
            <span>短标题（可选）</span>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="比如：她答应陪你去看检查"
              maxLength={80}
            />
          </label>
          <label className="field full">
            <span>内容</span>
            <textarea
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              rows={5}
              maxLength={600}
              placeholder="写清楚发生了什么、她当时是什么感受、这件事和你们有什么关系。"
            />
            <small>{form.content.length}/600</small>
          </label>
          <label className="field full">
            <span>重要度 · {Math.round(form.importance * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={form.importance}
              onChange={(event) => setForm({ ...form, importance: Number(event.target.value) })}
            />
          </label>
          <label className="checkbox-field full">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(event) => setForm({ ...form, pinned: event.target.checked })}
            />
            <span>放进核心记忆，让她每一轮都带着</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
