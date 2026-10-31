import { useState } from "react";
import type { AppInfo, SelfCheckResult } from "../../shared/api";

export function HomePage({ info, onChanged }: { info: AppInfo | null; onChanged: () => void }) {
  const [check, setCheck] = useState<SelfCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const runCheck = async () => {
    setErr(null);
    try {
      setCheck(await window.api.selfCheck());
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!info) return <p>加载中……</p>;
  return (
    <section>
      <h1>首页</h1>
      <p className="muted">工作进度和学习进度的仪表盘将在 M1、M3 加入。当前版本（M0）用于确认程序能在本机正常启动并读写数据库。</p>

      <h2>数据库状态</h2>
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

      <h2>读写自检</h2>
      <p className="muted">点击后会往数据库写入一条自检记录，再从磁盘上的文件重新读出来核对。</p>
      <button className="primary" onClick={runCheck} disabled={info.dbVersion === null}>运行读写自检</button>
      {check && (
        <div className={check.ok ? "banner ok" : "banner error"}>
          {check.ok ? "✓ 读写正常" : "✗ 写入的数据没有在磁盘文件里读到"}：累计自检 {check.totalRows} 次，最后一次 {new Date(check.at).toLocaleString("zh-CN")}
        </div>
      )}
      {err && <div className="banner error">自检失败：{err}</div>}
    </section>
  );
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}
