import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  ComputerRequest,
  ComputerRequestKind,
  ComputerSettings,
  ComputerView
} from '../shared/types.js';
import { db, newId } from './db.js';
import { getSettings, saveSettings } from './settings.js';
import { safePublicUrl } from './research.js';
import { publish } from './events.js';
import { dateKey, nowMs } from './time.js';

type Row = Record<string, any>;

const RISK_VERSION = 1;
const PENDING_TTL_MS = 20 * 60_000;
const BLOCKED_EXE = new Set([
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'wscript.exe',
  'cscript.exe',
  'mshta.exe',
  'regedit.exe',
  'reg.exe',
  'schtasks.exe',
  'rundll32.exe',
  'explorer.exe',
  'taskkill.exe'
]);

function mapRequest(row: Row): ComputerRequest {
  return {
    id: String(row.id),
    kind: row.kind === 'launch_app' ? 'launch_app' : 'open_url',
    target: String(row.target),
    label: String(row.label ?? ''),
    reason: String(row.reason ?? ''),
    risk: String(row.risk ?? ''),
    status: row.status,
    result: String(row.result ?? ''),
    createdAt: Number(row.created_at),
    decidedAt: row.decided_at == null ? null : Number(row.decided_at),
    executedAt: row.executed_at == null ? null : Number(row.executed_at)
  };
}

export function getComputerSettings(): ComputerSettings {
  return structuredClone(getSettings().computer);
}

export function updateComputerSettings(input: {
  enabled?: boolean;
  agreed?: boolean;
  allowOpenUrls?: boolean;
  dailyLimit?: number;
  allowedApps?: { id?: string; label?: string; path: string }[];
}): ComputerSettings {
  const current = getSettings().computer;
  const enabled = input.enabled ?? current.enabled;
  const agreed = input.agreed === true;
  if (enabled && !current.consentAt && !agreed) {
    throw new Error('启用电脑使用前必须阅读并同意风险说明');
  }
  const apps = Array.isArray(input.allowedApps)
    ? input.allowedApps.map((app) => {
        const path = String(app.path ?? '').trim();
        if (!isAbsolute(path) || !path.toLowerCase().endsWith('.exe')) {
          throw new Error('只能添加绝对路径的 .exe 程序');
        }
        if (!existsSync(path)) throw new Error(`找不到程序：${path}`);
        if (BLOCKED_EXE.has(basename(path).toLowerCase())) {
          throw new Error('这个程序属于系统命令/脚本宿主，不能授权');
        }
        return {
          id: String(app.id ?? newId('app')),
          label: String(app.label ?? basename(path)).slice(0, 60),
          path,
          addedAt: nowMs()
        };
      })
    : current.allowedApps;
  const next = saveSettings({
    computer: {
      enabled,
      consentAt: agreed ? nowMs() : current.consentAt,
      consentVersion: agreed ? RISK_VERSION : current.consentVersion,
      allowOpenUrls: input.allowOpenUrls ?? current.allowOpenUrls,
      allowedApps: apps,
      dailyLimit: Math.max(1, Math.min(10, Number(input.dailyLimit ?? current.dailyLimit)))
    }
  });
  return next.computer;
}

function todayActions(): number {
  const tz = getSettings().user.timezone;
  const today = dateKey(nowMs(), tz);
  const rows = db
    .prepare(
      `SELECT executed_at FROM computer_requests
       WHERE status = 'executed' AND executed_at IS NOT NULL`
    )
    .all() as Row[];
  return rows.filter((row) => dateKey(Number(row.executed_at), tz) === today).length;
}

function expireOld(): void {
  db.prepare(
    `UPDATE computer_requests SET status = 'expired', decided_at = ?
     WHERE status = 'pending' AND created_at < ?`
  ).run(nowMs(), nowMs() - PENDING_TTL_MS);
}

export function getComputerView(): ComputerView {
  expireOld();
  const id = 'char-main';
  const pending = (
    db
      .prepare(
        `SELECT * FROM computer_requests WHERE character_id = ? AND status = 'pending'
         ORDER BY created_at ASC LIMIT 10`
      )
      .all(id) as Row[]
  ).map(mapRequest);
  const history = (
    db
      .prepare(
        `SELECT * FROM computer_requests WHERE character_id = ? AND status != 'pending'
         ORDER BY created_at DESC LIMIT 30`
      )
      .all(id) as Row[]
  ).map(mapRequest);
  return {
    settings: getComputerSettings(),
    pending,
    history,
    todayCount: todayActions()
  };
}

export interface ComputerProposal {
  kind: ComputerRequestKind;
  target: string;
  reason: string;
}

function riskText(kind: ComputerRequestKind, label: string, target: string): string {
  if (kind === 'open_url') {
    return `会调用系统默认浏览器打开 ${target}。该网站会看到你的 IP、浏览器信息和你是否登录了它；Alive 不会读取你的账号、Cookie 或页面内容，也不会替你登录或付款。`;
  }
  return `会启动你授权的程序「${label}」（${target}）。该程序以你当前 Windows 用户的权限运行，可能访问文件或网络；Alive 只会启动它，不会代替你点击、输入或操作键鼠。`;
}

export function createComputerRequest(
  proposal: ComputerProposal,
  options: { allowedUrls?: string[] } = {}
): ComputerRequest {
  const settings = getSettings();
  if (!settings.computer.enabled || !settings.computer.consentAt) {
    throw new Error('电脑使用尚未获得你的同意');
  }
  if (todayActions() >= settings.computer.dailyLimit) {
    throw new Error('今天的电脑操作次数已经用完');
  }
  const pendingCount = Number(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM computer_requests WHERE status = 'pending'")
        .get() as Row
    ).count
  );
  if (pendingCount >= 2) throw new Error('已经有两个请求在等你批准');

  let target = String(proposal.target ?? '').trim();
  let label = '';
  if (proposal.kind === 'open_url') {
    if (!settings.computer.allowOpenUrls) throw new Error('没有开启打开网页的权限');
    const safe = safePublicUrl(target);
    if (!safe) throw new Error('这个网址不能安全打开');
    if (!options.allowedUrls?.length) {
      throw new Error('没有可打开的学习资料');
    }
    const allowed = new Set(options.allowedUrls.map((url) => safePublicUrl(url)).filter(Boolean));
    if (!allowed.has(safe)) throw new Error('只能打开这次学习资料里的网页');
    target = safe;
    label = new URL(safe).hostname;
  } else {
    const app =
      settings.computer.allowedApps.find((item) => item.id === target) ??
      settings.computer.allowedApps.find((item) => item.path === target);
    if (!app) throw new Error('这个程序不在你的授权列表里');
    if (BLOCKED_EXE.has(basename(app.path).toLowerCase())) {
      throw new Error('这个程序不能授权');
    }
    target = app.path;
    label = app.label;
  }
  const reason = String(proposal.reason ?? '').slice(0, 300);
  const id = newId('creq');
  db.prepare(
    `INSERT INTO computer_requests
      (id, character_id, kind, target, label, reason, risk, status, result, created_at)
     VALUES (?, 'char-main', ?, ?, ?, ?, ?, 'pending', '', ?)`
  ).run(
    id,
    proposal.kind,
    target,
    label,
    reason,
    riskText(proposal.kind, label, target),
    nowMs()
  );
  publish('computer_request', { id, kind: proposal.kind, label });
  return mapRequest(db.prepare('SELECT * FROM computer_requests WHERE id = ?').get(id) as Row);
}

function launch(kind: ComputerRequestKind, target: string): void {
  if (process.platform === 'win32') {
    const child =
      kind === 'open_url'
        ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', target], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
        : spawn(target, [], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
            cwd: dirname(target)
          });
    child.unref();
    return;
  }
  if (kind === 'open_url') {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [target], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  throw new Error('当前系统不支持启动程序');
}

export function decideComputerRequest(id: string, approve: boolean): ComputerRequest {
  expireOld();
  const row = db
    .prepare('SELECT * FROM computer_requests WHERE id = ?')
    .get(id) as Row | undefined;
  if (!row) throw new Error('请求不存在');
  if (row.status !== 'pending') throw new Error('这个请求已经处理过了');
  const now = nowMs();
  if (!approve) {
    db.prepare(
      "UPDATE computer_requests SET status = 'denied', decided_at = ? WHERE id = ?"
    ).run(now, id);
    return mapRequest(
      db.prepare('SELECT * FROM computer_requests WHERE id = ?').get(id) as Row
    );
  }
  db.prepare(
    "UPDATE computer_requests SET status = 'approved', decided_at = ? WHERE id = ?"
  ).run(now, id);
  try {
    if (row.kind === 'launch_app') {
      const target = String(row.target);
      if (!existsSync(target) || !target.toLowerCase().endsWith('.exe')) {
        throw new Error('程序文件不存在');
      }
      if (BLOCKED_EXE.has(basename(target).toLowerCase())) {
        throw new Error('这个程序不能授权');
      }
    }
    launch(row.kind === 'launch_app' ? 'launch_app' : 'open_url', String(row.target));
    db.prepare(
      "UPDATE computer_requests SET status = 'executed', executed_at = ?, result = ? WHERE id = ?"
    ).run(nowMs(), '已交给系统打开', id);
  } catch (error) {
    db.prepare(
      "UPDATE computer_requests SET status = 'failed', executed_at = ?, result = ? WHERE id = ?"
    ).run(
      nowMs(),
      error instanceof Error ? error.message.slice(0, 200) : '执行失败',
      id
    );
  }
  return mapRequest(
    db.prepare('SELECT * FROM computer_requests WHERE id = ?').get(id) as Row
  );
}
