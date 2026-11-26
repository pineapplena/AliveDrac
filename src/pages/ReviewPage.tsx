import { useEffect, useState } from 'react';
import { BookHeart, CalendarDays, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { WeeklyReview, WeeklyReviewView } from '../../shared/types';
import { api, type LiveEvent } from '../api';
import type { ToastKind } from '../components/Toast';
import { cn } from '../utils';

interface Props {
  live: LiveEvent | null;
  onToast: (message: string, kind?: ToastKind) => void;
}

function weekLabel(review: WeeklyReview): string {
  return `${review.weekStart.slice(5).replace('-', '.')} — ${review.weekEnd.slice(5).replace('-', '.')}`;
}

export function ReviewPage({ live, onToast }: Props) {
  const [view, setView] = useState<WeeklyReviewView | null>(null);
  const [selected, setSelected] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    try {
      const next = await api.reviews();
      setView(next);
      setSelected((current) => {
        if (current && next.reviews.some((item) => item.id === current.id)) {
          return current;
        }
        return next.reviews[0] ?? null;
      });
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取周记失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (live?.type === 'weekly_review') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const generate = async () => {
    setGenerating(true);
    try {
      const review = await api.generateReview();
      onToast('这一周的回顾写好了', 'success');
      await load();
      setSelected(review);
    } catch (error) {
      onToast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const show = (review: WeeklyReview) => setSelected(review);

  return (
    <div className="page-screen review-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">她的一周</span>
          <h1>她写给你们的回顾</h1>
          <p>不是统计报表，是她自己挑出来的一周里值得留下的小事。</p>
        </div>
        <button className="button primary" onClick={() => void generate()} disabled={generating}>
          {generating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
          {generating ? '正在回想…' : '写这一周'}
        </button>
      </header>

      {loading ? (
        <div className="page-loading">
          <Loader2 size={20} className="spin" /> 正在翻她的一周
        </div>
      ) : !view?.reviews.length ? (
        <div className="empty-card review-empty">
          <BookHeart size={30} />
          <h2>还没有周记</h2>
          <p>等这一周过完，或者现在就让她写一封。</p>
          <button className="button primary" onClick={() => void generate()} disabled={generating}>
            <Sparkles size={15} /> 写这一周
          </button>
        </div>
      ) : (
        <div className="review-layout">
          <div className="review-list">
            {view.reviews.map((review) => (
              <button
                key={review.id}
                className={cn('review-list-item', selected?.id === review.id && 'active')}
                onClick={() => show(review)}
              >
                <span className="review-week">{weekLabel(review)}</span>
                <strong>{review.title}</strong>
                <small>{new Date(review.createdAt).toLocaleDateString('zh-CN')}</small>
              </button>
            ))}
          </div>

          {selected && (
            <article className="review-letter">
              <div className="review-letter-head">
                <span className="eyebrow">
                  <CalendarDays size={13} /> {weekLabel(selected)}
                </span>
                <h2>{selected.title}</h2>
              </div>
              {selected.photoUrl && (
                <div className="review-photo">
                  <img src={selected.photoUrl} alt="这一周留下的照片" />
                </div>
              )}
              <div className="review-content">
                {selected.content.split(/\n+/).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
              {selected.highlights.length > 0 && (
                <div className="review-highlights">
                  <span>这一周值得记住的</span>
                  {selected.highlights.map((highlight, index) => (
                    <em key={index}>{highlight}</em>
                  ))}
                </div>
              )}
            </article>
          )}
        </div>
      )}

      <div className="agreement-hint">
        <RefreshCw size={14} />
        默认每周日 21:00 写一次；错过时间的话，下次打开服务时会补写上一周。
      </div>
    </div>
  );
}
