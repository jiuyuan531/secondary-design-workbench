import { useEffect, useState } from "react";
import type { AppInfo, SelfCheckResult } from "../../shared/api";
import type { Dashboard } from "../../board/repo";
import type { ReviewStats } from "../../questions/repo";
import { EnumBadge } from "../components/EnumBadge";
import { call, today, dueText } from "../lib";

export function HomePage({ info, onChanged, onOpenProject, onOpenIssues, onOpenReview }: {
  info: AppInfo | null; onChanged: () => void; onOpenProject: (id: number) => void; onOpenIssues: () => void; onOpenReview: () => void;
}) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [rs, setRs] = useState<ReviewStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (info?.dbVersion == null) return;
    call(window.api.board.dashboard(today())).then(setDash).catch((e) => setErr(e.message));
    call(window.api.review.stats(today())).then(setRs).catch((e) => setErr(e.message));
  }, [info]);

  if (!info) return <p>加载中……</p>;
  return (
    <section>
      <h1>首页</h1>
      {err && <div className="banner error">{err}</div>}
      {dash && (
        <>
          <div className="stats">
            <div className="stat"><div className="stat-num">{dash.totals.activeProjects}</div><div className="stat-label">进行中的项目</div></div>
            <div className="stat"><div className="stat-num">{dash.upcoming.length}</div><div className="stat-label">14 天内到期（含逾期）</div></div>
            <button className="stat clickable" onClick={onOpenIssues}><div className="stat-num">{dash.totals.openIssues}</div><div className="stat-label">未解决的问题</div></button>
            {rs && (
              <button className="stat clickable" onClick={onOpenReview} title={`到期复习 ${rs.todayDue} 道，新题 ${rs.todayFresh} 道；今天已完成 ${rs.doneToday} 道`}>
                <div className="stat-num">{rs.todayDue + rs.todayFresh}</div>
                <div className="stat-label">今日待复习{rs.doneToday ? `（已完成 ${rs.doneToday}）` : ""}</div>
              </button>
            )}
          </div>

          <h2>近期截止</h2>
          {dash.upcoming.length === 0 ? <p className="muted">14 天内没有到期的卷册或任务。</p> : (
            <table className="grid clickable">
              <thead><tr><th>到期</th><th>类型</th><th>内容</th><th>项目</th><th>状态</th></tr></thead>
              <tbody>
                {dash.upcoming.map((u) => (
                  <tr key={`${u.kind}-${u.id}`} onClick={() => onOpenProject(u.project_id)}>
                    <td className={u.days_left < 0 ? "overdue" : u.days_left <= 7 ? "due-soon" : ""}>{u.due_date}<br /><small>{dueText(u.days_left)}</small></td>
                    <td>{u.kind === "volume" ? "卷册" : "任务"}</td>
                    <td className="pre">{u.title}</td>
                    <td>{u.project_name}</td>
                    <td>{u.kind === "volume" ? <EnumBadge k="volumeStatus" v={u.status} /> : <EnumBadge k="taskStatus" v={u.status} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>各项目未解决问题</h2>
          {dash.openIssuesByProject.length === 0 ? <p className="muted">没有未解决的问题。</p> : (
            <table className="grid clickable">
              <thead><tr><th>项目</th><th>未解决</th><th>已提交厂家或设总</th><th>其中来源矛盾</th></tr></thead>
              <tbody>
                {dash.openIssuesByProject.map((r) => (
                  <tr key={r.project_id} onClick={() => onOpenProject(r.project_id)}>
                    <td>{r.project_name}</td>
                    <td>{r.open ? <span className="count-open">{r.open}</span> : 0}</td>
                    <td>{r.submitted}</td>
                    <td>{r.conflicts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">学习进度（今日待复习）将在 M3 加入。</p>
        </>
      )}
      <SystemStatus info={info} onChanged={onChanged} />
    </section>
  );
}

function SystemStatus({ info, onChanged }: { info: AppInfo; onChanged: () => void }) {
  const [open, setOpen] = useState(info.dbVersion === null);
  const [check, setCheck] = useState<SelfCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const runCheck = async () => {
    setErr(null);
    try { setCheck(await window.api.selfCheck()); onChanged(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <details className="system" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>系统状态</summary>
      <table className="kv">
        <tbody>
          <tr><th>数据库文件</th><td><code>{info.dbPath}</code> <button className="link" onClick={() => window.api.openPath(dirname(info.dbPath))}>打开所在文件夹</button></td></tr>
          <tr><th>表结构版本</th><td>{info.dbVersion ?? "未打开"} / 程序支持 {info.latestDbVersion}</td></tr>
          <tr><th>回路数据目录</th><td><code>{info.circuitsDir}</code> <button className="link" onClick={() => window.api.openPath(info.circuitsDir)}>打开</button></td></tr>
          <tr><th>本次启动的迁移</th><td>{info.migrationsApplied.length ? info.migrationsApplied.join("；") : "无（数据库已是最新）"}</td></tr>
          {info.migrationBackupPath && <tr><th>迁移前自动备份</th><td><code>{info.migrationBackupPath}</code></td></tr>}
          <tr><th>运行环境</th><td>Electron {info.electronVersion} · {info.platform}</td></tr>
        </tbody>
      </table>
      <p>
        <button onClick={runCheck} disabled={info.dbVersion === null}>运行读写自检</button>
        <span className="muted"> 往数据库写入一条自检记录，再从磁盘上的文件读出来核对。</span>
      </p>
      {check && (
        <div className={check.ok ? "banner ok" : "banner error"}>
          {check.ok ? "✓ 读写正常" : "✗ 写入的数据没有在磁盘文件里读到"}：累计自检 {check.totalRows} 次，最后一次 {new Date(check.at).toLocaleString("zh-CN")}
        </div>
      )}
      {err && <div className="banner error">自检失败：{err}</div>}
    </details>
  );
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}
