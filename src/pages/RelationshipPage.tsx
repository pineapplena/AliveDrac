import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  HeartHandshake,
  Loader2,
  Save,
  Sparkles,
  UserRound
} from 'lucide-react';
import type { Relationship } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import type { ToastKind } from '../components/Toast';
import { cn, dateTime, stageIndex } from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

interface RelationEvent {
  id: string;
  delta: number;
  reason: string;
  source: string;
  createdAt: number;
}

export function RelationshipPage({ live, onToast }: Props) {
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [events, setEvents] = useState<RelationEvent[]>([]);
  const [stages, setStages] = useState<string[]>(['陌生', '认识', '熟悉', '信任', '亲近', '牵挂']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [affinity, setAffinity] = useState(50);
  const loadSeq = useRef(0);
  const affinityDirtyRef = useRef(false);
  const initializedRef = useRef(false);

  const load = async (syncForm = true) => {
    const seq = ++loadSeq.current;
    try {
      const data = await api.relationship();
      if (seq !== loadSeq.current) return;
      setRelationship(data.relationship);
      setEvents(data.events);
      setStages(data.stages);
      const shouldSyncForm = syncForm || !initializedRef.current;
      if (shouldSyncForm) {
        setNotes(data.relationship.notes);
        setBoundaries(data.relationship.boundaries);
        setAffinity(data.relationship.affinity);
        affinityDirtyRef.current = false;
      } else if (!affinityDirtyRef.current) {
        setAffinity(data.relationship.affinity);
      }
      initializedRef.current = true;
    } catch (error) {
      if (seq === loadSeq.current) {
        onToast(error instanceof Error ? error.message : '读取关系失败', 'error');
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (live?.type !== 'relationship') return;
    setRelationship(live.data as Relationship);
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, 20_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.updateRelationship({ notes, boundaries, affinity });
      loadSeq.current += 1;
      setRelationship(next);
      setAffinity(next.affinity);
      affinityDirtyRef.current = false;
      void load(false);
      onToast('关系资料保存好了', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !relationship) {
    return (
      <div className="page-screen">
        <div className="page-loading">
          <Loader2 className="spin" size={20} />
          正在读你们之间
        </div>
      </div>
    );
  }
  if (!relationship) {
    return (
      <div className="page-screen">
        <div className="page-loading">暂时读不到关系资料。</div>
      </div>
    );
  }

  const currentStage = stageIndex(relationship.stage, stages);
  const ringStyle = {
    background: `conic-gradient(var(--rose) ${relationship.affinity * 3.6}deg, rgba(255,255,255,.07) 0deg)`
  };

  return (
    <div className="page-screen relationship-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">你们之间</span>
          <h1>关系不是分数</h1>
          <p className="page-sub">
            它决定她怎么叫你、愿意靠近到什么程度、会不会答应你。分数可以改，边界不能。
          </p>
        </div>
        <div className="page-actions">
          <button className="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            保存
          </button>
        </div>
      </header>

      <section className="relation-hero">
        <div className="affinity-ring-wrap">
          <div className="affinity-ring" style={ringStyle}>
            <div className="affinity-ring-inner">
              <HeartHandshake size={20} />
              <strong>{Math.round(relationship.affinity)}</strong>
              <span>{relationship.stage}</span>
            </div>
          </div>
        </div>
        <div className="relation-summary">
          <span className="eyebrow">
            <Sparkles size={12} /> 当前关系
          </span>
          <h2>{relationship.peerName} · {relationship.stage}</h2>
          <div className="relation-meters single">
            <div>
              <span>张力</span>
              <div className="stat-track"><i style={{ width: `${relationship.tension}%`, background: 'var(--rose)' }} /></div>
            </div>
          </div>
          <div className="stage-path">
            {stages.map((stage, index) => (
              <div key={stage} className={cn('stage-step', index <= currentStage && 'reached', index === currentStage && 'current')}>
                <i />
                <span>{stage}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="relation-grid">
        <section className="side-card">
          <div className="side-card-head">
            <span><UserRound size={15} /> 她记得的你</span>
            <small>只会进入你们这一对关系</small>
          </div>
          <label className="field">
            <span>关系备注</span>
            <textarea
              rows={5}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="比如：他最近在做复查，怕疼但不太说；答应过周末陪他去一趟。"
            />
          </label>
          <label className="field">
            <span>明确边界</span>
            <textarea
              rows={4}
              value={boundaries}
              onChange={(event) => setBoundaries(event.target.value)}
              placeholder="比如：晚上十二点后不要主动发消息；不想被叫得太亲昵。"
            />
          </label>
          <div className="affinity-editor">
            <div className="side-card-head">
              <span>手动调整好感</span>
              <small>{Math.round(affinity)} / 100</small>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={affinity}
              onChange={(event) => {
                affinityDirtyRef.current = true;
                setAffinity(Number(event.target.value));
              }}
            />
            <p>只在你想修正关系位置时使用。日常互动会自己推动它。</p>
          </div>
        </section>

        <section className="side-card">
          <div className="side-card-head">
            <span>最近的变化</span>
            <small>{events.length} 条</small>
          </div>
          {events.length === 0 ? (
            <div className="soft-empty small">
              <p>还没有明显的关系变化。多聊几句，这里会慢慢有东西。</p>
            </div>
          ) : (
            <div className="relation-events">
              {events.slice(0, 14).map((event) => (
                <article key={event.id}>
                  <span className={cn('delta', event.delta > 0 ? 'up' : event.delta < 0 ? 'down' : 'flat')}>
                    {event.delta > 0 ? <ArrowUpRight size={13} /> : event.delta < 0 ? <ArrowDownRight size={13} /> : '·'}
                    {event.delta > 0 ? '+' : ''}{event.delta.toFixed(1)}
                  </span>
                  <div>
                    <strong>{event.reason}</strong>
                    <time>{dateTime(event.createdAt)}</time>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
