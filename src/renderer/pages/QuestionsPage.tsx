import { useEffect, useState } from "react";
import type { Question, QType, ReviewStatus } from "../../questions/model";
import { QTYPE_LABEL, STATUS_LABEL, SOURCE_LABEL } from "../../questions/model";
import type { QuestionWithProgress, ImportPreview } from "../../questions/repo";
import { Modal } from "../components/Modal";
import { QuestionForm } from "../questions/QuestionForm";
import { ReviewSession } from "../questions/ReviewSession";
import { call, today } from "../lib";

type Tab = "review" | "bank";

export function QuestionsPage({ initialTab, onOpenSettings, onChanged }: { initialTab?: Tab; onOpenSettings: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "review");
  return (
    <section>
      <h1>题库复习</h1>
      <div className="tabs">
        <button className={tab === "review" ? "tab active" : "tab"} onClick={() => setTab("review")}>今日复习</button>
        <button className={tab === "bank" ? "tab active" : "tab"} onClick={() => setTab("bank")}>题库</button>
      </div>
      {tab === "review" ? <ReviewSession onGoBank={() => setTab("bank")} onOpenSettings={onOpenSettings} onChanged={onChanged} /> : <QuestionBank onChanged={onChanged} />}
    </section>
  );
}

function QuestionBank({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<QuestionWithProgress[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [qtype, setQtype] = useState<QType | "">("");
  const [status, setStatus] = useState<ReviewStatus | "">("");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Question | null | undefined>(undefined);
  const [importing, setImporting] = useState<{ path: string; preview?: ImportPreview; error?: string } | null>(null);

  const load = () => {
    call(window.api.questions.list({ qtype: qtype || undefined, review_status: status || undefined, tag: tag || undefined, search: search || undefined }))
      .then((r) => { setRows(r); setSelected((s) => new Set([...s].filter((id) => r.some((x) => x.id === id)))); })
      .catch((e) => setErr(e.message));
    call(window.api.questions.tags()).then(setTags).catch(() => {});
  };
  useEffect(load, [qtype, status, tag, search]);
  const done = (m: string) => { setMsg(m); setEditing(undefined); load(); onChanged(); };

  const ids = [...selected];
  const allChecked = !!rows?.length && rows.every((r) => selected.has(r.id));
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulkStatus = async (st: ReviewStatus) => {
    try {
      const r = await call(window.api.questions.setStatus(ids, st));
      done(`${r.changed} 道题改为“${STATUS_LABEL[st]}”${r.progressReset ? `，其中 ${r.progressReset} 道原来的复习进度已重置` : ""}。`);
    } catch (e) { setErr((e as Error).message); }
  };
  const bulkDelete = async () => {
    if (!window.confirm(`确定删除选中的 ${ids.length} 道题吗？它们的复习记录也会一起删除，不能恢复。`)) return;
    try { await call(window.api.questions.remove(ids)); setSelected(new Set()); done(`已删除 ${ids.length} 道题。`); } catch (e) { setErr((e as Error).message); }
  };
  const doExport = async (only?: number[]) => {
    try {
      const r = await call(window.api.questions.exportFile(only));
      if (r) setMsg(`已导出 ${r.count} 道题到 ${r.path}`);
    } catch (e) { setErr((e as Error).message); }
  };
  const pickImport = async () => {
    try { const r = await call(window.api.questions.pickImport()); if (r) setImporting(r); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div>
      <div className="toolbar">
        <button className="primary" onClick={() => setEditing(null)}>＋ 新建题目</button>
        <button onClick={pickImport}>从 JSON 导入</button>
        <button onClick={() => doExport()}>导出全部</button>
        <span className="spacer" />
        <select value={qtype} onChange={(e) => setQtype(e.target.value as QType | "")}>
          <option value="">全部题型</option>
          {(Object.keys(QTYPE_LABEL) as QType[]).map((t) => <option key={t} value={t}>{QTYPE_LABEL[t]}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | "")}>
          <option value="">全部状态</option>
          {(Object.keys(STATUS_LABEL) as ReviewStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">全部标签</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="search" placeholder="搜索题干、选项、解析" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {selected.size > 0 && (
        <div className="toolbar bulk-bar">
          <span>已选 {selected.size} 道：</span>
          <button onClick={() => bulkStatus("reviewed")}>标为已审核</button>
          <button onClick={() => bulkStatus("draft")}>改回草稿</button>
          <button onClick={() => doExport(ids)}>导出选中</button>
          <button className="danger" onClick={bulkDelete}>删除</button>
          <span className="muted small">审核状态变化会重置这些题的复习进度。</span>
        </div>
      )}
      {msg && <div className="banner ok small">{msg}</div>}
      {err && <div className="banner error">{err}</div>}
      {rows && rows.length === 0 && <p className="muted">没有符合条件的题目。</p>}
      {rows && rows.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th>#</th><th>题干</th><th>题型</th><th>标签</th><th>状态</th><th>来源</th><th>下次复习</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} onClick={() => setEditing(q)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(q.id)} onChange={() => toggle(q.id)} /></td>
                <td className="muted">{q.id}</td>
                <td className="stem-cell">{q.stem}</td>
                <td>{QTYPE_LABEL[q.qtype]}</td>
                <td>{q.tags.map((t) => <span key={t} className="badge">{t}</span>)}</td>
                <td><span className={q.review_status === "draft" ? "badge draft" : "badge reviewed"}>{STATUS_LABEL[q.review_status]}</span></td>
                <td className="muted small">{SOURCE_LABEL[q.source]}</td>
                <td className="small">{q.progress ? (q.progress.due_date <= today() ? <b>今天</b> : q.progress.due_date) : <span className="muted">未学</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing !== undefined && <QuestionForm question={editing} onClose={() => setEditing(undefined)} onSaved={done} />}
      {importing && (
        <ImportDialog data={importing} onClose={() => setImporting(null)}
          onDone={(m) => { setImporting(null); done(m); }} />
      )}
    </div>
  );
}

function ImportDialog({ data, onClose, onDone }: { data: { path: string; preview?: ImportPreview; error?: string }; onClose: () => void; onDone: (msg: string) => void }) {
  const [update, setUpdate] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = data.preview;
  const run = async () => {
    try {
      const r = await call(window.api.questions.importFile(data.path, update));
      onDone(`导入完成：新增 ${r.added} 道，更新 ${r.updated} 道${r.progressReset ? `（其中 ${r.progressReset} 道复习进度已重置）` : ""}，跳过 ${r.skipped} 道。`);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="导入题目" onClose={onClose}>
      <p className="muted small">{data.path}</p>
      {data.error && <div className="banner error"><pre>{data.error}</pre></div>}
      {p && (
        <>
          <ul>
            <li>文件里共 {p.total} 道题</li>
            <li>新题 <b>{p.fresh}</b> 道，会直接加入题库</li>
            <li>和题库里完全相同 {p.same} 道，跳过</li>
            {p.changed > 0 && <li>题库里已有但内容不同 <b>{p.changed}</b> 道</li>}
            {p.invalid.length > 0 && <li className="err-text">格式有错 {p.invalid.length} 道，会跳过</li>}
          </ul>
          {p.invalid.length > 0 && (
            <div className="banner warn small"><div>{p.invalid.slice(0, 20).map((x) => <div key={x.index}>第 {x.index} 道：{x.error}</div>)}{p.invalid.length > 20 && <div>……</div>}</div></div>
          )}
          {p.changed > 0 && (
            <label className="switch"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />用文件里的内容更新这 {p.changed} 道题（内容有变化的会重置复习进度）</label>
          )}
        </>
      )}
      {err && <div className="banner error">{err}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={run} disabled={!p || (p.fresh === 0 && !(update && p.changed > 0))}>导入</button>
      </div>
    </Modal>
  );
}
