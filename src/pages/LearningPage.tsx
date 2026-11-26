import { useEffect, useState } from 'react';
import {
  BookOpenCheck,
  Compass,
  ExternalLink,
  Feather,
  Flame,
  GraduationCap,
  Lightbulb,
  Loader2,
  PlayCircle,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import type { LearningView } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import type { ToastKind } from '../components/Toast';
import { cn, relative, shortDate } from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

function enjoymentLabel(value: number): string {
  if (value > 0.55) return '很喜欢';
  if (value > 0.2) return '有点意思';
  if (value > -0.15) return '说不上来';
  if (value > -0.5) return '不太感冒';
  return '不喜欢';
}

export function LearningPage({ live, onToast }: Props) {
  const [view, setView] = useState<LearningView | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    try {
      setView(await api.learning());
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取学习记录失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (live && ['learning', 'life_event', 'state'].includes(live.type)) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const learnNow = async () => {
    setRunning(true);
    try {
      const result = await api.runLearning(true);
      if (result.started) {
        onToast(`她学了一会儿：${result.session?.topic ?? '新的东西'}`, 'success');
      } else {
        onToast(`这次没学成：${result.reason}`, 'info');
      }
      if (result.view) setView(result.view);
      else await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '学习失败', 'error');
    } finally {
      setRunning(false);
    }
  };

  if (loading && !view) {
    return (
      <div className="page-screen">
        <div className="page-loading">
          <Loader2 className="spin" size={20} />
          正在看她最近在琢磨什么
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="page-screen">
        <div className="page-loading">暂时读不到她的学习记录。</div>
      </div>
    );
  }

  const active = view.interests.filter((interest) => interest.status === 'active');
  const completed = view.interests.filter((interest) => interest.status === 'completed');
  const dropped = view.interests.filter((interest) => interest.status === 'dropped');
  const paused = view.interests.filter(
    (interest) => interest.status !== 'active' && interest.status !== 'completed' && interest.status !== 'dropped'
  );
  const recent = view.sessions.slice(0, 12);
  const considered = view.candidates.slice(0, 10);

  return (
    <div className="page-screen learning-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">自主学习</span>
          <h1>她自己想学的东西</h1>
          <p className="page-sub">
            这不是你给她布置的课程。她在自己的空闲时间里，自己决定好奇什么、喜欢什么、要不要继续。
            笔记来自她自己的知识、记忆与推理，不确定的地方会标成推测，不会假装查过资料。
          </p>
        </div>
        <div className="page-actions">
          <button className="button ghost" onClick={() => void load()}>
            <RefreshCw size={15} /> 刷新
          </button>
          <button className="button" onClick={() => void learnNow()} disabled={running}>
            {running ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            {running ? '她正在学…' : '现在让她学一会儿'}
          </button>
        </div>
      </header>

      <section className="learning-status">
        <div className="learning-status-main">
          <span className="eyebrow"><Compass size={12} /> 此刻</span>
          <h2>{view.canLearn ? '她有自己的时间' : view.reason}</h2>
          <p>
            {view.canLearn
              ? '她可以在这段时间里继续一个兴趣，也可能被生活里的一件小事带到新的方向。'
              : '她不会为了完成指标而学习。等真正有空、有精力、也有好奇的时候再说。'}
          </p>
        </div>
        <div className="learning-stats">
          <div><span>进行中</span><strong>{view.stats.active}</strong></div>
          <div><span>学习次数</span><strong>{view.stats.sessions}</strong></div>
          <div><span>今天</span><strong>{view.stats.studiedToday}</strong></div>
          <div>
            <span>平均享受</span>
            <strong>{view.stats.averageEnjoyment == null ? '—' : enjoymentLabel(view.stats.averageEnjoyment)}</strong>
          </div>
        </div>
      </section>

      <section className="learning-section">
        <div className="section-head compact">
          <div>
            <span className="eyebrow"><Flame size={12} /> 正在着迷</span>
            <h2>她的兴趣不是标签</h2>
            <p>好奇会被继续加深，也会因为“其实没那么喜欢”而停下来。</p>
          </div>
        </div>
        {active.length === 0 ? (
          <div className="empty-card">
            <GraduationCap size={26} />
            <h3>
              {completed.length + paused.length + dropped.length > 0
                ? '现在没有正在继续的兴趣'
                : '还没有形成长期兴趣'}
            </h3>
            <p>
              {completed.length + paused.length + dropped.length > 0
                ? '旧的方向已经放下或学得差不多了。她可以自己决定什么时候重新好奇。'
                : '等她在自己的时间里遇到真正想知道答案的问题，这里才会长出东西。'}
            </p>
            <button className="button ghost" onClick={() => void learnNow()}>
              让她现在想想
            </button>
          </div>
        ) : (
          <div className="interest-grid">
            {active.map((interest) => (
              <article className="interest-card" key={interest.id}>
                <div className="interest-head">
                  <span className="memory-kind">{interest.domain}</span>
                  <span className="interest-level">Lv.{interest.level.toFixed(1)}</span>
                </div>
                <h3>{interest.topic}</h3>
                {interest.studyCount > 1 && (
                  <span className="interest-continued">继续加深 · {interest.studyCount} 次</span>
                )}
                <p className="interest-question">「{interest.question}」</p>
                <p className="interest-summary">{interest.summary}</p>
                <div className="interest-meters">
                  <div>
                    <span>好奇</span>
                    <div className="stat-track"><i style={{ width: `${interest.curiosity * 100}%`, background: 'var(--rose)' }} /></div>
                  </div>
                  <div>
                    <span>胜任</span>
                    <div className="stat-track"><i style={{ width: `${interest.competence * 100}%`, background: 'var(--sage)' }} /></div>
                  </div>
                </div>
                <footer>
                  <span>学过 {interest.studyCount} 次</span>
                  <span>{interest.lastStudiedAt ? relative(interest.lastStudiedAt) : '还没开始'}</span>
                </footer>
              </article>
            ))}
          </div>
        )}
        {completed.length > 0 && (
          <p className="learning-completed">
            她觉得已经学得差不多了：{completed.map((interest) => interest.topic).join('、')}。不是被硬性结课，是她自己觉得这块可以放下了。
          </p>
        )}
        {paused.length > 0 && (
          <p className="learning-paused">
            她暂时放下：{paused.map((interest) => interest.topic).join('、')}。不是因为没学会，而是因为没那么喜欢，或者现在不想继续。
          </p>
        )}
        {dropped.length > 0 && (
          <p className="learning-dropped">
            她不再追：{dropped.map((interest) => interest.topic).join('、')}。很久没有继续，好奇心已经降得很低。
          </p>
        )}
      </section>

      <div className="learning-grid">
        <section className="learning-section">
          <div className="section-head compact">
            <div>
              <span className="eyebrow"><Feather size={12} /> 学习笔记</span>
              <h2>她最近弄明白了什么</h2>
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="soft-empty">
              <p>还没有学习笔记。</p>
            </div>
          ) : (
            <div className="study-list">
              {recent.map((session) => (
                <article className="study-card" key={session.id}>
                  <header>
                    <div>
                      <span>{session.domain}</span>
                      <h3>{session.topic}</h3>
                    </div>
                    <time>{shortDate(session.createdAt)}</time>
                  </header>
                  <p className="study-question">她想弄清楚：{session.question}</p>
                  <p className="study-notes">{session.notes}</p>
                  {session.insight && (
                    <div className="study-insight">
                      <Lightbulb size={14} />
                      <p>{session.insight}</p>
                    </div>
                  )}
                  {session.sources.length > 0 ? (
                    <div className="study-sources">
                      <span className="study-sources-label">这次查的资料</span>
                      {session.sources.map((source) => (
                        <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                          {source.type === 'video' ? <PlayCircle size={13} /> : <ExternalLink size={13} />}
                          <span>{source.title}</span>
                          <small>
                            {source.siteName || (source.type === 'video' ? '视频' : '网页')}
                            {source.type === 'video' ? (source.fetched ? ' · 字幕' : ' · 简介') : ''}
                          </small>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="study-no-sources">这次没有联网资料，笔记来自她自己的知识、记忆和推理。</p>
                  )}
                  <footer>
                    <span className={cn('enjoyment', session.enjoyment > 0.2 && 'positive', session.enjoyment < -0.15 && 'negative')}>
                      {enjoymentLabel(session.enjoyment)}
                    </span>
                    <span>难度 {Math.round(session.difficulty * 100)}%</span>
                    <span>{session.wantMore ? '还想继续' : '暂时够了'}</span>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="learning-side">
          <section className="side-card">
            <div className="side-card-head">
              <span><Compass size={15} /> 她考虑过的方向</span>
              <small>最近 {considered.length} 个</small>
            </div>
            <p className="audit-intro">
              她不是从固定清单里选。她每次都会先冒出几个方向，再选此刻最想弄明白的那个。
            </p>
            <div className="candidate-list">
              {considered.map((candidate) => (
                <article key={candidate.id} className={cn(candidate.chosen && 'chosen')}>
                  <span>{candidate.chosen ? '选了' : '放过了'}</span>
                  <div>
                    <strong>{candidate.topic}</strong>
                    <p>{candidate.reason}</p>
                  </div>
                </article>
              ))}
              {considered.length === 0 && <p className="audit-empty">还没有记录。</p>}
            </div>
          </section>

          <section className="side-card">
            <div className="side-card-head">
              <span><BookOpenCheck size={15} /> 表达只是其中一种</span>
            </div>
            <p className="audit-intro">
              语言和表达只是她可能好奇的领域之一。她会学人类为什么把奶茶点成三分糖，也会学数据里的谐波、龙角的触觉，
              或者某句她喜欢的话为什么好听。学什么由她判断，不由“该怎么说话”的清单决定。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
