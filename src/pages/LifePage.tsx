import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarHeart,
  CloudSun,
  Coffee,
  History,
  Loader2,
  MapPin,
  Moon,
  Popcorn,
  Plus,
  RefreshCw,
  Sparkles,
  StickyNote,
  Sunrise,
  Trash2
} from 'lucide-react';
import type { ImportantDate, LeisureView, LifeView, Note } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import { Modal } from '../components/Modal';
import { StatBar } from '../components/StatBar';
import type { ToastKind } from '../components/Toast';
import {
  categoryInfo,
  clock,
  cn,
  dayLabel,
  energyLabel,
  hm,
  hungerLabel,
  moodLabel,
  pct,
  stressLabel
} from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

function nextOccurrence(date: ImportantDate): { at: Date; days: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let year = today.getFullYear();
  let at = date.year && !date.recurring
    ? new Date(date.year, date.month - 1, date.day)
    : new Date(year, date.month - 1, date.day);
  if (date.recurring && at < today) {
    year += 1;
    at = new Date(year, date.month - 1, date.day);
  }
  return { at, days: Math.round((at.getTime() - today.getTime()) / 86_400_000) };
}

export function LifePage({ live, onToast }: Props) {
  const [life, setLife] = useState<LifeView | null>(null);
  const [dates, setDates] = useState<ImportantDate[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [leisure, setLeisure] = useState<LeisureView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dateModal, setDateModal] = useState(false);
  const [noteModal, setNoteModal] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [dateForm, setDateForm] = useState({
    title: '',
    month: new Date().getMonth() + 1,
    day: new Date().getDate(),
    note: '',
    recurring: true
  });
  const [noteForm, setNoteForm] = useState({ title: '', content: '', due: '' });

  const load = async () => {
    try {
      const [lifeData, dateData, noteData, leisureData] = await Promise.all([
        api.life(),
        api.dates(),
        api.notes(),
        api.leisure()
      ]);
      setLife(lifeData);
      setDates(dateData.dates);
      setNotes(noteData.notes);
      setLeisure(leisureData);
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取生活失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!live) return;
    if (['state', 'schedule', 'life_event', 'leisure', 'diary', 'dream'].includes(live.type)) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const todayEvents = useMemo(() => {
    if (!life) return [];
    return life.events.filter((event) => {
      const date = new Date(event.at);
      const [year, month, day] = life.date.split('-').map(Number);
      return (
        date.getFullYear() === year &&
        date.getMonth() + 1 === month &&
        date.getDate() === day
      );
    });
  }, [life]);

  const regenerate = async () => {
    if (busy) return;
    setBusy('schedule');
    try {
      const result = await api.generateSchedule(life?.date);
      onToast(
        result.source === 'llm' ? '今天重新安排好了' : '模型没接上，先用本地安排了一份',
        result.source === 'llm' ? 'success' : 'info'
      );
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '重新安排失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const chooseLeisure = async () => {
    setBusy('leisure');
    try {
      const result = await api.runLeisure(true);
      if (result.started) {
        onToast(`她自己选了：${result.session?.activity ?? '歇一会儿'}`, 'success');
      } else {
        onToast(`这次没安排：${result.reason}`, 'info');
      }
      if (result.view) setLeisure(result.view);
      else await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '安排失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const writeFragment = async () => {
    if (busy) return;
    setBusy('fragment');
    try {
      await api.fragment();
      onToast('写下了一小段此刻', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '写生活碎片失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const writeDiary = async () => {
    if (busy) return;
    setBusy('diary');
    try {
      await api.generateDiary(life?.date, true);
      onToast('日记写好了', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '写日记失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const dream = async () => {
    if (busy) return;
    setBusy('dream');
    try {
      await api.generateDream();
      onToast('她做了一个梦', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '做梦失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const addDate = async () => {
    if (!dateForm.title.trim()) {
      onToast('先给这个日子起个名字', 'error');
      return;
    }
    setSavingMeta(true);
    try {
      await api.createDate({
        title: dateForm.title,
        month: dateForm.month,
        day: dateForm.day,
        note: dateForm.note,
        recurring: dateForm.recurring
      });
      setDateModal(false);
      setDateForm({
        title: '',
        month: new Date().getMonth() + 1,
        day: new Date().getDate(),
        note: '',
        recurring: true
      });
      onToast('记下这个日子了', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingMeta(false);
    }
  };

  const addNote = async () => {
    if (!noteForm.title.trim()) {
      onToast('便签总得有个标题', 'error');
      return;
    }
    setSavingMeta(true);
    try {
      await api.createNote({
        title: noteForm.title,
        content: noteForm.content,
        dueAt: noteForm.due ? new Date(noteForm.due).getTime() : null
      });
      setNoteModal(false);
      setNoteForm({ title: '', content: '', due: '' });
      onToast('便签写好了', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingMeta(false);
    }
  };

  const toggleNote = async (note: Note) => {
    try {
      await api.updateNote(note.id, { done: !note.done });
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '更新失败', 'error');
    }
  };

  const removeNote = async (note: Note) => {
    try {
      await api.deleteNote(note.id);
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  const removeDate = async (date: ImportantDate) => {
    if (!window.confirm(`删掉「${date.title}」？`)) return;
    try {
      await api.deleteDate(date.id);
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  if (loading && !life) {
    return (
      <div className="page-screen">
        <div className="page-loading">
          <Loader2 className="spin" size={20} />
          正在读她今天的生活
        </div>
      </div>
    );
  }
  if (!life) {
    return (
      <div className="page-screen">
        <div className="page-loading">暂时读不到她的生活。</div>
      </div>
    );
  }

  const state = life.state;
  const current = life.currentBlock;
  const upcomingDates = [...dates]
    .map((date) => ({ date, ...nextOccurrence(date) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 4);
  const openNotes = notes.filter((note) => !note.done).slice(0, 5);

  return (
    <div className="page-screen life-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">她的一天</span>
          <h1>{dayLabel(Date.now())}</h1>
          <p className="page-sub">
            {life.weather.city} · {life.weather.label} {Math.round(life.weather.temperature)}°C
            <span className="dot-sep">·</span>
            她不在等你，她在过自己的生活
          </p>
        </div>
        <div className="page-actions">
          <button className="button ghost" onClick={() => void load()}>
            <RefreshCw size={15} /> 刷新
          </button>
          <button className="button" onClick={() => void regenerate()} disabled={busy === 'schedule'}>
            {busy === 'schedule' ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            重新安排今天
          </button>
        </div>
      </header>

      <section className="life-hero">
        <div className="life-hero-main">
          <span className="eyebrow">
            <i className="live-dot" /> 现在
          </span>
          <h2>{current?.activity ?? state.currentActivity}</h2>
          <p>{current?.detail ?? '她暂时停下来，什么也没做。'}</p>
          <div className="life-hero-meta">
            <span><MapPin size={14} /> {state.currentLocation}</span>
            <span><CloudSun size={14} /> 体感 {Math.round(life.weather.apparent)}°C</span>
            <span><Coffee size={14} /> {state.currentActivity === '睡着' ? '还在睡' : '醒着'}</span>
          </div>
        </div>
        <div className="life-hero-stats">
          <StatBar label="心情" value={(state.mood + 1) / 2} text={moodLabel(state.mood)} color="var(--rose)" />
          <StatBar label="精力" value={state.energy} text={energyLabel(state.energy)} color="var(--sage)" />
          <StatBar label="饥饿" value={state.hunger} text={hungerLabel(state.hunger)} color="var(--amber)" />
          <StatBar label="压力" value={state.stress} text={stressLabel(state.stress)} color="var(--lilac)" />
          <StatBar
            label="睡眠债"
            value={state.sleepDebt}
            text={state.sleepDebt > 0.6 ? '缺觉' : state.sleepDebt > 0.35 ? '有点缺' : '还好'}
            color="var(--blue)"
          />
          <StatBar
            label="社交电量"
            value={state.social}
            text={state.social < 0.25 ? '想安静' : state.social < 0.5 ? '一般' : '有余量'}
            color="var(--sage)"
          />
          <div className="outfit-line">
            <span>今天穿着</span>
            <p>{state.outfit || '还没换衣服。'}</p>
          </div>
        </div>
      </section>

      {leisure && (
        <section className="life-leisure">
          <div className="life-leisure-head">
            <div>
              <span className="eyebrow"><Popcorn size={12} /> 闲暇</span>
              <h2>{leisure.canChoose ? '她有一点无聊' : '她现在没在无聊'}</h2>
              <p>{leisure.reason}</p>
            </div>
            <button className="button ghost small" onClick={() => void chooseLeisure()} disabled={busy === 'leisure'}>
              {busy === 'leisure' ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}
              让她自己决定
            </button>
          </div>
          <div className="life-leisure-body">
            <div className="boredom-panel">
              <div className="boredom-label">
                <span>无聊程度</span>
                <strong>{Math.round(leisure.boredom * 100)}%</strong>
              </div>
              <div className="boredom-track"><i style={{ width: `${leisure.boredom * 100}%` }} /></div>
              <div className="leisure-stats">
                <span>今天 {leisure.stats.today} 次</span>
                <span>加班 {leisure.stats.overtime} 次</span>
                <span>平均享受 {leisure.stats.averageEnjoyment == null ? '—' : Math.round(leisure.stats.averageEnjoyment * 100) + '%'}</span>
              </div>
              <div className="leisure-candidates">
                {leisure.candidates.slice(0, 4).map((candidate) => (
                  <div key={candidate.id} className={cn(candidate.chosen && 'chosen')}>
                    <i>{candidate.chosen ? '选了' : '没选'}</i>
                    <span>{candidate.activity}</span>
                  </div>
                ))}
                {leisure.candidates.length === 0 && <p>她还没开始想怎么打发时间。</p>}
              </div>
            </div>
            <div className="leisure-latest">
              {leisure.sessions[0] ? (
                <>
                  <span className="leisure-kind">{leisure.sessions[0].kind === 'overtime' ? '加班' : '放松'}</span>
                  <h3>{leisure.sessions[0].activity}</h3>
                  <p>{leisure.sessions[0].reaction}</p>
                  {leisure.sessions[0].sourceUrl && (
                    <a href={leisure.sessions[0].sourceUrl} target="_blank" rel="noreferrer">
                      {leisure.sessions[0].sourceTitle || '看看她刷到的视频'}
                    </a>
                  )}
                  <footer>
                    <span>{new Date(leisure.sessions[0].createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>{leisure.sessions[0].enjoyment > 0.2 ? '有点放松' : leisure.sessions[0].enjoyment < -0.15 ? '不太值' : '说不上来'}</span>
                  </footer>
                </>
              ) : (
                <div className="soft-empty">
                  <Popcorn size={20} />
                  <p>她还没有闲下来做过什么。等有空、无聊的时候，她会自己选。</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="life-grid">
        <section className="timeline-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">日程</span>
              <h2>今天怎么过</h2>
            </div>
            <span className="source-tag">
              {life.blocks[0]?.source === 'llm'
                ? '模型安排'
                : life.blocks[0]?.source === 'carry'
                  ? '沿用昨天'
                  : '本地安排'}
            </span>
          </div>
          <div className="timeline">
            {life.blocks.map((block) => {
              const info = categoryInfo(block.category);
              const active = block.id === current?.id;
              const past = block.endMin <= nowMinutes && !active;
              return (
                <div key={block.id} className={cn('timeline-row', active && 'active', past && 'past')}>
                  <div className="timeline-time">
                    <strong>{hm(block.startMin)}</strong>
                    <span>{hm(block.endMin)}</span>
                  </div>
                  <div className="timeline-rail">
                    <i style={{ background: info.color, boxShadow: active ? `0 0 0 5px ${info.soft}` : undefined }} />
                  </div>
                  <div className="timeline-content">
                    <div className="timeline-title">
                      <h3>{block.activity}</h3>
                      {active && <span className="now-chip">现在</span>}
                      <span className="category-chip" style={{ color: info.color, background: info.soft }}>
                        {info.label}
                      </span>
                    </div>
                    <p className="timeline-location">
                      <MapPin size={12} /> {block.location}
                    </p>
                    {block.detail && <p className="timeline-detail">{block.detail}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="life-side">
          {life.absences?.[0] && (
            <section className="side-card absence-card">
              <div className="side-card-head">
                <span><History size={15} /> 你不在的时候</span>
                <small>{life.absences[0].eventCount} 件小事</small>
              </div>
              <p className="absence-time">
                {new Date(life.absences[0].startAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
                {' — '}
                {new Date(life.absences[0].endAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
              <div className="prose">
                {life.absences[0].summary.split(/\n{2,}/).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </section>
          )}

          <section className="side-card diary-card">
            <div className="side-card-head">
              <span><BookOpen size={15} /> 日记</span>
              <button className="text-button" onClick={() => void writeDiary()} disabled={busy === 'diary'}>
                {busy === 'diary' ? '写着…' : life.diary ? '重写' : '让她写'}
              </button>
            </div>
            {life.diary ? (
              <div className="prose">
                {life.diary.content.split(/\n{2,}/).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            ) : (
              <div className="soft-empty">
                <Moon size={20} />
                <p>她还没写今天的日记。</p>
                <span>通常会在夜里，或者独处的时候写。</span>
              </div>
            )}
          </section>

          <section className="side-card">
            <div className="side-card-head">
              <span><CalendarHeart size={15} /> 重要日子</span>
              <button className="text-button" onClick={() => setDateModal(true)}>
                <Plus size={12} /> 记一个
              </button>
            </div>
            {upcomingDates.length === 0 ? (
              <div className="soft-empty small">
                <p>还没有特别标记的日子。生日、约定、复查，都可以放进来。</p>
              </div>
            ) : (
              <div className="date-list">
                {upcomingDates.map(({ date, at, days }) => (
                  <article key={date.id}>
                    <div className="date-badge">
                      <strong>{date.month}</strong>
                      <span>{date.day}</span>
                    </div>
                    <div>
                      <strong>{date.title}</strong>
                      <p>
                        {days === 0
                          ? '就是今天'
                          : days === 1
                            ? '明天'
                            : days > 0
                              ? `还有 ${days} 天`
                              : `已经过去 ${-days} 天`}
                        {date.note ? ` · ${date.note}` : ''}
                      </p>
                    </div>
                    <button
                      className="icon-button small date-remove"
                      onClick={() => void removeDate(date)}
                      aria-label="删除重要日子"
                    >
                      <Trash2 size={13} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="side-card">
            <div className="side-card-head">
              <span><StickyNote size={15} /> 便签</span>
              <button className="text-button" onClick={() => setNoteModal(true)}>
                <Plus size={12} /> 写一张
              </button>
            </div>
            {openNotes.length === 0 ? (
              <div className="soft-empty small">
                <p>没有悬着的便签。</p>
              </div>
            ) : (
              <div className="note-list">
                {openNotes.map((note) => (
                  <article key={note.id}>
                    <button className="note-check" onClick={() => void toggleNote(note)} aria-label="完成便签" />
                    <div>
                      <strong>{note.title}</strong>
                      {note.content && <p>{note.content}</p>}
                      {note.dueAt && (
                        <time className={note.dueAt < Date.now() ? 'overdue' : ''}>
                          {new Date(note.dueAt).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </time>
                      )}
                    </div>
                    <button
                      className="icon-button small note-remove"
                      onClick={() => void removeNote(note)}
                      aria-label="删除便签"
                    >
                      <Trash2 size={13} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="side-card">
            <div className="side-card-head">
              <span><Sunrise size={15} /> 今天的碎片</span>
              <span className="fragment-actions">
                <small>{todayEvents.length} 件</small>
                <button
                  className="text-button"
                  onClick={() => void writeFragment()}
                  disabled={busy === 'fragment'}
                >
                  {busy === 'fragment' ? '写着…' : '写一条'}
                </button>
              </span>
            </div>
            {todayEvents.length === 0 ? (
              <div className="soft-empty small">
                <p>还没有记录。她动起来之后，这里会出现一些小事。</p>
              </div>
            ) : (
              <div className="event-list">
                {todayEvents.slice(0, 8).map((event) => (
                  <article key={event.id}>
                    <time>{clock(event.at)}</time>
                    <div>
                      <strong>{event.title}</strong>
                      {event.detail && <p>{event.detail}</p>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="side-card">
            <div className="side-card-head">
              <span><Moon size={15} /> 梦</span>
              <button className="text-button" onClick={() => void dream()} disabled={busy === 'dream'}>
                {busy === 'dream' ? '梦着…' : '让她做梦'}
              </button>
            </div>
            {life.dreams.length === 0 ? (
              <div className="soft-empty small">
                <p>她最近没有做梦。深度睡眠时才会有。</p>
              </div>
            ) : (
              <div className="dream-list">
                {life.dreams.slice(0, 2).map((item) => (
                  <article key={item.id}>
                    <span>{new Date(item.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                    <p>{item.content}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={dateModal}
        title="记一个重要的日子"
        subtitle="她会在这一天想起这件事，也可能主动来找你。"
        onClose={() => setDateModal(false)}
        footer={
          <>
            <button className="button ghost" onClick={() => setDateModal(false)}>取消</button>
            <button className="button" onClick={() => void addDate()} disabled={savingMeta}>
              {savingMeta ? <Loader2 className="spin" size={15} /> : <CalendarHeart size={15} />}
              记下来
            </button>
          </>
        }
      >
        <div className="form-grid two">
          <label className="field full">
            <span>是什么日子</span>
            <input
              value={dateForm.title}
              onChange={(event) => setDateForm({ ...dateForm, title: event.target.value })}
              placeholder="比如：复查、生日、约好一起吃饭"
            />
          </label>
          <label className="field">
            <span>月</span>
            <input
              type="number"
              min={1}
              max={12}
              value={dateForm.month}
              onChange={(event) => setDateForm({ ...dateForm, month: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>日</span>
            <input
              type="number"
              min={1}
              max={31}
              value={dateForm.day}
              onChange={(event) => setDateForm({ ...dateForm, day: Number(event.target.value) })}
            />
          </label>
          <label className="field full">
            <span>备注（可选）</span>
            <textarea
              rows={3}
              value={dateForm.note}
              onChange={(event) => setDateForm({ ...dateForm, note: event.target.value })}
              placeholder="她需要记得的细节…"
            />
          </label>
          <label className="checkbox-field full">
            <input
              type="checkbox"
              checked={dateForm.recurring}
              onChange={(event) => setDateForm({ ...dateForm, recurring: event.target.checked })}
            />
            <span>每年都会到这一天</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={noteModal}
        title="写一张便签"
        subtitle="可以是一个提醒，也可以是她想替你记住的小事。"
        onClose={() => setNoteModal(false)}
        footer={
          <>
            <button className="button ghost" onClick={() => setNoteModal(false)}>取消</button>
            <button className="button" onClick={() => void addNote()} disabled={savingMeta}>
              {savingMeta ? <Loader2 className="spin" size={15} /> : <StickyNote size={15} />}
              放好
            </button>
          </>
        }
      >
        <div className="form-grid two">
          <label className="field full">
            <span>便签标题</span>
            <input
              value={noteForm.title}
              onChange={(event) => setNoteForm({ ...noteForm, title: event.target.value })}
              placeholder="比如：提醒他带伞"
            />
          </label>
          <label className="field full">
            <span>内容（可选）</span>
            <textarea
              rows={4}
              value={noteForm.content}
              onChange={(event) => setNoteForm({ ...noteForm, content: event.target.value })}
              placeholder="想让她记住的细节…"
            />
          </label>
          <label className="field full">
            <span>什么时候提醒（可选）</span>
            <input
              type="datetime-local"
              value={noteForm.due}
              onChange={(event) => setNoteForm({ ...noteForm, due: event.target.value })}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
