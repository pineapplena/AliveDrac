import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react';
import type { AllowedApp, ComputerRequest, ComputerView } from '../../shared/types';
import { api } from '../api';
import type { ToastKind } from './Toast';

interface Props {
  onToast: (message: string, kind?: ToastKind) => void;
}

const STATUS_LABEL: Record<string, string> = {
  executed: '已执行',
  denied: '已拒绝',
  expired: '已过期',
  failed: '执行失败',
  approved: '已批准',
  pending: '等待批准'
};

function riskList() {
  return [
    '她会先提出请求，只有你逐次点“允许”之后才会执行；没有“以后都同意”的自动模式。',
    '打开网页会调用你的默认浏览器，网站能看到你的 IP 和浏览器信息；Alive 不会读取你的账号、Cookie、页面内容，也不会替你登录或付款。',
    '启动程序会以你当前 Windows 用户的权限运行，程序可能访问文件或网络；Alive 只会启动它，不会代替你点击、输入或操作键鼠。',
    '这条路只开放“打开网页 / 启动你明确加入白名单的 .exe”，不开放命令行、脚本宿主、任意参数或键鼠控制。',
    '你随时可以关掉总开关；已经发出的请求会过期，不会在后台偷偷执行。'
  ];
}

function RequestCard({
  request,
  onDecide,
  busy
}: {
  request: ComputerRequest;
  onDecide: (approve: boolean) => void;
  busy: boolean;
}) {
  return (
    <article className="computer-request">
      <div className="computer-request-head">
        <span className={`computer-kind ${request.kind}`}>
          {request.kind === 'open_url' ? '打开网页' : '启动程序'}
        </span>
        <strong>{request.label || request.target}</strong>
        <time>{new Date(request.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
      </div>
      <p className="computer-reason">「{request.reason}」</p>
      <code className="computer-target">{request.target}</code>
      <p className="computer-risk"><ShieldAlert size={13} /> {request.risk}</p>
      <div className="computer-actions">
        <button className="button ghost small" onClick={() => onDecide(false)} disabled={busy}>
          <X size={14} /> 拒绝
        </button>
        <button className="button small danger" onClick={() => onDecide(true)} disabled={busy}>
          <Check size={14} /> 允许这一次
        </button>
      </div>
    </article>
  );
}

export function ComputerPanel({ onToast }: Props) {
  const [view, setView] = useState<ComputerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [allowOpenUrls, setAllowOpenUrls] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(3);
  const [apps, setApps] = useState<AllowedApp[]>([]);
  const [appLabel, setAppLabel] = useState('');
  const [appPath, setAppPath] = useState('');

  const apply = (next: ComputerView) => {
    setView(next);
    setEnabled(next.settings.enabled);
    setAllowOpenUrls(next.settings.allowOpenUrls);
    setDailyLimit(next.settings.dailyLimit);
    setApps(next.settings.allowedApps);
  };

  const load = async () => {
    try {
      apply(await api.computer());
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取电脑权限失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (enabled && !view?.settings.consentAt && !agreed) {
      onToast('启用前请先读完风险并勾选同意', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.saveComputer({
        enabled,
        agreed,
        allowOpenUrls,
        dailyLimit,
        allowedApps: apps.map(({ id, label, path }) => ({ id, label, path }))
      });
      setAgreed(false);
      onToast(enabled ? '电脑权限已保存；她还需要你逐次批准' : '电脑使用已关闭', 'success');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const decide = async (request: ComputerRequest, approve: boolean) => {
    setBusy(true);
    try {
      const result = await api.decideComputer(request.id, approve);
      onToast(
        result.status === 'executed'
          ? result.kind === 'open_url'
            ? '已经在浏览器打开'
            : '程序已启动'
          : result.status === 'denied'
            ? '已拒绝这次请求'
            : result.result || '处理完了',
        result.status === 'failed' ? 'error' : 'success'
      );
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '处理失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addApp = () => {
    const path = appPath.trim();
    if (!path) return;
    if (apps.some((app) => app.path.toLowerCase() === path.toLowerCase())) {
      onToast('这个程序已经在列表里了', 'info');
      return;
    }
    setApps((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        label: appLabel.trim() || path.split(/[\\/]/).pop() || '程序',
        path,
        addedAt: Date.now()
      }
    ]);
    setAppLabel('');
    setAppPath('');
  };

  if (loading && !view) {
    return (
      <div className="page-loading">
        <Loader2 className="spin" size={18} /> 正在读电脑权限
      </div>
    );
  }
  if (!view) return <div className="page-loading">读不到电脑权限。</div>;

  return (
    <section className="settings-section computer-section">
      <div className="section-head">
        <div>
          <span className="eyebrow"><Monitor size={12} /> 电脑使用</span>
          <h2>她想用你的电脑时，先问你</h2>
          <p>
            默认关闭。开启后，她只能在“打开资料/视频”或“启动你加入白名单的程序”时提出请求；
            每一次都要你看到具体目标和风险后点允许。不会静默执行，也不开放命令行和键鼠控制。
          </p>
        </div>
        <button className="button ghost" onClick={() => void load()}>
          <RefreshCw size={15} /> 刷新
        </button>
      </div>

      <div className="computer-consent">
        <div className="computer-consent-head">
          <div>
            <strong>总开关</strong>
            <p>{view.settings.consentAt ? '你已经读过风险；仍需逐次批准具体请求。' : '启用前必须阅读并同意下面的风险。'}</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span />
          </label>
        </div>
        <ul className="risk-list">
          {riskList().map((item) => (
            <li key={item}><AlertTriangle size={13} /> {item}</li>
          ))}
        </ul>
        <label className="consent-check">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          我已阅读并理解以上风险，同意她在我逐次批准后打开网页或启动我授权的程序
        </label>
        <div className="computer-consent-grid">
          <label className="toggle-row">
            <div>
              <strong>允许打开资料/视频网页</strong>
              <p>只能打开这次学习资料里出现过的公开链接；视频会在浏览器里播放，她不会读取你的屏幕。</p>
            </div>
            <input type="checkbox" checked={allowOpenUrls} onChange={(event) => setAllowOpenUrls(event.target.checked)} />
          </label>
          <label className="field">
            <span>每天最多执行 · {dailyLimit} 次</span>
            <input type="range" min="1" max="10" step="1" value={dailyLimit} onChange={(event) => setDailyLimit(Number(event.target.value))} />
          </label>
        </div>
      </div>

      <div className="computer-block">
        <div className="computer-block-head">
          <div>
            <strong>允许启动的程序</strong>
            <p>只能填绝对路径的 .exe，不能带参数。命令提示符、PowerShell、脚本宿主和系统工具会被拒绝。</p>
          </div>
          <span className="saved-tag">{apps.length} / 12</span>
        </div>
        <div className="computer-app-add">
          <input value={appLabel} onChange={(event) => setAppLabel(event.target.value)} placeholder="名字，例如：星露谷物语" />
          <input value={appPath} onChange={(event) => setAppPath(event.target.value)} placeholder="C:\Program Files\...\game.exe" />
          <button className="button ghost small" onClick={addApp} disabled={apps.length >= 12 || !appPath.trim()}>
            <Plus size={14} /> 加入
          </button>
        </div>
        <div className="computer-app-list">
          {apps.map((app) => (
            <div key={app.path}>
              <div>
                <strong>{app.label}</strong>
                <code>{app.path}</code>
              </div>
              <button className="icon-button small" onClick={() => setApps((current) => current.filter((item) => item.path !== app.path))} aria-label="移除程序">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {apps.length === 0 && <p className="computer-empty">还没有授权程序。她仍然可以请求打开资料里的网页。</p>}
        </div>
        <div className="computer-actions">
          <button className="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="spin" size={15} /> : <ShieldAlert size={15} />}
            保存电脑权限
          </button>
        </div>
      </div>

      <div className="computer-block">
        <div className="computer-block-head">
          <div>
            <strong>等你的请求</strong>
            <p>只有这里点“允许这一次”才会执行；20 分钟不处理会自动过期。</p>
          </div>
          <span className="saved-tag">{view.pending.length}</span>
        </div>
        {view.pending.length === 0 ? (
          <p className="computer-empty">现在没有待批准的请求。</p>
        ) : (
          <div className="computer-request-list">
            {view.pending.map((request) => (
              <RequestCard key={request.id} request={request} onDecide={(approve) => void decide(request, approve)} busy={busy} />
            ))}
          </div>
        )}
      </div>

      <div className="computer-block">
        <div className="computer-block-head">
          <div>
            <strong>最近的电脑记录</strong>
            <p>每次批准、拒绝、执行失败都会留档。今天已执行 {view.todayCount} / {view.settings.dailyLimit} 次。</p>
          </div>
        </div>
        <div className="computer-history">
          {view.history.slice(0, 12).map((request) => (
            <div key={request.id} className={`history-row ${request.status}`}>
              <span>{STATUS_LABEL[request.status] ?? request.status}</span>
              <div>
                <strong>{request.label || request.target}</strong>
                <small>{request.reason}{request.result ? ` · ${request.result}` : ''}</small>
              </div>
              <time>{new Date(request.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          ))}
          {view.history.length === 0 && <p className="computer-empty">还没有电脑操作记录。</p>}
        </div>
      </div>

      <div className="computer-note">
        <ExternalLink size={14} />
        <p>
          这只是“受控地打开页面/程序”，不是完整的桌面操控。真正的键鼠控制需要更严格的隔离、逐动作确认和紧急停止，
          目前没有开放；这一层先保证不会在你不知情时动你的电脑。
        </p>
      </div>
    </section>
  );
}
