import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookHeart,
  Brain,
  CalendarDays,
  Eye,
  GraduationCap,
  Handshake,
  HeartHandshake,
  MessageCircle,
  Radio,
  RefreshCw,
  Settings2,
  Shirt,
  Sparkles
} from 'lucide-react';
import type { Bootstrap, Character, PublicSettings } from '../shared/types';
import { api, connectLive, type LiveEvent } from './api';
import { Avatar } from './components/Avatar';
import { Toast, type ToastKind, type ToastState } from './components/Toast';
import { notificationPermission, showDesktopNotification } from './notifications';
import { ChatPage } from './pages/ChatPage';
import { AgreementsPage } from './pages/AgreementsPage';
import { AppearancePage } from './pages/AppearancePage';
import { LearningPage } from './pages/LearningPage';
import { LifePage } from './pages/LifePage';
import { LiveAssistantPage } from './pages/LiveAssistantPage';
import { MemoryPage } from './pages/MemoryPage';
import { RelationshipPage } from './pages/RelationshipPage';
import { ReviewPage } from './pages/ReviewPage';
import { ScreenPage } from './pages/ScreenPage';
import { SettingsPage } from './pages/SettingsPage';
import { cn } from './utils';

export type Page =
  | 'chat'
  | 'life'
  | 'appearance'
  | 'agreements'
  | 'review'
  | 'screen'
  | 'live'
  | 'learning'
  | 'memory'
  | 'relationship'
  | 'settings';

const NAV: { id: Page; label: string; sub: string; icon: typeof MessageCircle }[] = [
  { id: 'chat', label: '对话', sub: '和她说说话', icon: MessageCircle },
  { id: 'life', label: '生活', sub: '她的一天', icon: CalendarDays },
  { id: 'appearance', label: '形象', sub: '穿搭与照片', icon: Shirt },
  { id: 'agreements', label: '约定', sub: '你们说好的事', icon: Handshake },
  { id: 'review', label: '回顾', sub: '她的一周', icon: BookHeart },
  { id: 'screen', label: '窥屏', sub: '她偶尔看看你', icon: Eye },
  { id: 'live', label: '直播', sub: '帮她看弹幕', icon: Radio },
  { id: 'learning', label: '学习', sub: '她自己想学的事', icon: GraduationCap },
  { id: 'memory', label: '记忆', sub: '她记得的事', icon: Brain },
  { id: 'relationship', label: '关系', sub: '你们之间', icon: HeartHandshake },
  { id: 'settings', label: '设置', sub: '模型与角色', icon: Settings2 }
];

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('chat');
  const [live, setLive] = useState<LiveEvent | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [unread, setUnread] = useState(0);
  const pageRef = useRef<Page>('chat');
  pageRef.current = page;
  const bootRef = useRef<Bootstrap | null>(boot);
  bootRef.current = boot;

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      setBoot(data);
      setUnread(data.unread);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法连接本地服务');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const disconnect = connectLive((event) => {
      setLive(event);
      if (event.type === 'state' && event.data?.state) {
        setBoot((current) =>
          current
            ? {
                ...current,
                life: {
                  ...current.life,
                  state: event.data.state,
                  ...(event.data.block !== undefined ? { currentBlock: event.data.block } : {}),
                  ...(event.data.next !== undefined ? { nextBlock: event.data.next } : {}),
                  ...(event.data.weather ? { weather: event.data.weather } : {}),
                  ...(event.data.date ? { date: event.data.date } : {})
                }
              }
            : current
        );
      }
      if (event.type === 'proactive') {
        notify('她刚刚主动发来一条消息', 'info');
      } else if (event.type === 'messages_cleared') {
        setUnread(0);
      } else if (event.type === 'weekly_review') {
        const settings = bootRef.current?.settings;
        if (
          settings?.weeklyReview.notify &&
          notificationPermission() === 'granted' &&
          (!settings.notifications.enabled ||
            !settings.notifications.onlyWhenHidden ||
            document.visibilityState === 'hidden')
        ) {
          showDesktopNotification(
            bootRef.current?.character.name ?? 'Alive',
            '她写下了这一周的回顾。',
            {
              icon: bootRef.current?.character.avatarUrl,
              tag: 'weekly-review',
              onClick: () => setPage('review')
            }
          );
        }
      } else if (event.type === 'computer_request') {
        notify('她想用一下电脑，到「设置 → 电脑」批准', 'info');
      } else if (event.type === 'leisure') {
        notify('她自己打发了一会儿时间', 'info');
      } else if (event.type === 'diary') {
        notify('她写完了今天的日记', 'info');
      } else if (event.type === 'dream') {
        notify('她做了一个梦', 'info');
      } else if (
        event.type === 'message' &&
        event.data?.role === 'assistant' &&
        event.data?.kind !== 'greeting'
      ) {
        if (pageRef.current !== 'chat') {
          setUnread((value) => value + 1);
        }
        const current = bootRef.current;
        const settings = current?.settings;
        if (
          current &&
          settings?.notifications.enabled &&
          (!settings.notifications.onlyWhenHidden ||
            document.visibilityState === 'hidden') &&
          notificationPermission() === 'granted'
        ) {
          showDesktopNotification(current.character.name, String(event.data.content ?? ''), {
            icon: current.character.avatarUrl,
            tag: String(event.data.id ?? ''),
            onClick: () => setPage('chat')
          });
          const proactiveId = event.data.meta?.proactiveId;
          if (proactiveId) {
            void api.markProactiveDelivered(String(proactiveId)).catch(() => undefined);
          }
        }
      }
    });
    return disconnect;
  }, [notify]);

  useEffect(() => {
    if (page === 'live' && boot && !boot.settings.liveAssistant.installed) {
      setPage('settings');
    }
  }, [page, boot]);

  const markRead = useCallback(() => {
    setUnread(0);
    void api.markRead().catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const handleSettingsChanged = useCallback(
    async (next?: { character?: Character; settings?: PublicSettings }) => {
      if (next?.character || next?.settings) {
        setBoot((current) =>
          current
            ? {
                ...current,
                character: next.character ?? current.character,
                settings: next.settings ?? current.settings,
                life: {
                  ...current.life,
                  character: next.character ?? current.life.character
                },
                demo: next.settings
                  ? !next.settings.provider.hasApiKey || next.settings.provider.mock
                  : current.demo,
                llmConfigured: next.settings
                  ? next.settings.provider.hasApiKey && !next.settings.provider.mock
                  : current.llmConfigured
              }
            : current
        );
      }
      await refresh();
    },
    [refresh]
  );

  if (!boot && !error) {
    return (
      <div className="boot-screen">
        <div className="boot-orb">
          <span />
          <i />
        </div>
        <p className="boot-title">她正在醒来</p>
        <p className="boot-sub">把今天的光调暗一点，等她睁开眼</p>
      </div>
    );
  }

  if (!boot && error) {
    return (
      <div className="error-screen">
        <div className="error-card">
          <span className="eyebrow">连接失败</span>
          <h1>没能把她叫醒</h1>
          <p>{error}</p>
          <button className="button primary" onClick={() => void load()}>
            <RefreshCw size={16} /> 再试一次
          </button>
          <small>请确认本地服务已启动：在项目目录运行 `pnpm dev`。</small>
        </div>
      </div>
    );
  }

  const data = boot!;
  const character = data.character;
  const settings = data.settings;
  const state = data.life.state;
  const visibleNav = NAV.filter(
    (item) => item.id !== 'live' || settings.liveAssistant.installed
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" />
          <span>Alive</span>
          <em>v{data.version}</em>
        </div>

        <div className="side-character">
          <Avatar
            name={character.name}
            src={character.avatarUrl}
            size={76}
            online
            className="side-avatar"
          />
          <h1>{character.name}</h1>
          <p>{state.currentActivity}</p>
          <span className="side-location">{state.currentLocation}</span>
        </div>

        <nav className="side-nav" aria-label="主导航">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn('nav-item', page === item.id && 'active')}
                onClick={() => setPage(item.id)}
              >
                <span className="nav-icon">
                  <Icon size={18} strokeWidth={1.8} />
                  {item.id === 'chat' && unread > 0 && <i className="nav-badge">{unread > 9 ? '9+' : unread}</i>}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.sub}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="side-foot">
          <div className={cn('connection-pill', data.demo ? 'demo' : 'live')}>
            <span />
            {data.demo ? '离线演示' : settings.provider.model}
          </div>
          <button className="side-settings" onClick={() => setPage('settings')}>
            <Settings2 size={14} />
            模型与数据
          </button>
        </div>
      </aside>

      <div className="mobile-topbar">
        <Avatar name={character.name} src={character.avatarUrl} size={34} />
        <div>
          <strong>{character.name}</strong>
          <small>{state.currentActivity}</small>
        </div>
        <button className="icon-button" onClick={() => setPage('settings')} aria-label="设置">
          <Settings2 size={17} />
        </button>
      </div>

      <main className={cn('app-main', `page-${page}`)}>
        {page === 'chat' && (
          <ChatPage
            character={character}
            settings={settings}
            demo={data.demo}
            live={live}
            unread={unread}
            onRead={markRead}
            onOpenSettings={() => setPage('settings')}
            onToast={notify}
            onRefresh={refresh}
          />
        )}
        {page === 'life' && <LifePage live={live} onToast={notify} />}
        {page === 'agreements' && <AgreementsPage live={live} onToast={notify} />}
        {page === 'review' && <ReviewPage live={live} onToast={notify} />}
        {page === 'appearance' && (
          <AppearancePage
            character={character}
            settings={settings}
            life={data.life}
            onOpenSettings={() => setPage('settings')}
            onToast={notify}
          />
        )}
        {page === 'screen' && <ScreenPage live={live} onToast={notify} />}
        {page === 'live' && settings.liveAssistant.installed && (
          <LiveAssistantPage live={live} onToast={notify} />
        )}
        {page === 'learning' && <LearningPage live={live} onToast={notify} />}
        {page === 'memory' && <MemoryPage live={live} onToast={notify} />}
        {page === 'relationship' && <RelationshipPage live={live} onToast={notify} />}
        {page === 'settings' && (
          <SettingsPage
            character={character}
            settings={settings}
            demo={data.demo}
            onChanged={handleSettingsChanged}
            onToast={notify}
          />
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={cn(page === item.id && 'active')}
              onClick={() => setPage(item.id)}
            >
              <span>
                <Icon size={20} strokeWidth={1.8} />
                {item.id === 'chat' && unread > 0 && <i className="nav-badge">{unread > 9 ? '9+' : unread}</i>}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
