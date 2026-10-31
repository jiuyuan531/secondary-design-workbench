import { useMemo, useState } from "react";
import type { Row } from "../../board/model";
import { ENUMS } from "../../board/enums";
import { EnumBadge } from "../components/EnumBadge";
import { IssueList, confirmDelete, useEditor } from "../components/Tables";
import { ProjectDetail } from "./ProjectDetail";
import { useList } from "../useList";
import { call, dueClass } from "../lib";

type Tab = "projects" | "kanban" | "issues";

export function BoardPage({ projectId, onOpenProject, initialTab }: {
  projectId: number | null; onOpenProject: (id: number | null) => void; initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "projects");
  if (projectId != null) return <ProjectDetail projectId={projectId} onBack={() => onOpenProject(null)} />;
  return (
    <section>
      <h1>项目看板</h1>
      <div className="tabs">
        {([["projects", "项目列表"], ["kanban", "卷册看板"], ["issues", "待确认问题"]] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "projects" && <ProjectList onOpen={onOpenProject} />}
      {tab === "kanban" && <Kanban onOpenProject={onOpenProject} />}
      {tab === "issues" && <IssuesView />}
    </section>
  );
}

function ProjectList({ onOpen }: { onOpen: (id: number) => void }) {
  const projects = useList("project");
  const volumes = useList("volume");
  const issues = useList("issue");
  const editor = useEditor();
  const [showDone, setShowDone] = useState(false);
  const rows = projects.rows.filter((p) => showDone || p.status !== "done");
  const stat = (pid: unknown) => {
    const vs = volumes.rows.filter((v) => v.project_id === pid);
    return {
      volumes: vs.length,
      issued: vs.filter((v) => v.status === "issued").length,
      open: issues.rows.filter((i) => i.project_id === pid && i.status !== "confirmed").length,
    };
  };
  return (
    <>
      <div className="toolbar">
        <button className="primary" onClick={() => editor.open({ entity: "project" })}>＋ 新建项目</button>
        <label className="switch"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />显示已完成的项目</label>
      </div>
      {projects.error && <div className="banner error">{projects.error}</div>}
      {rows.length === 0 ? <p className="muted">还没有项目。点“新建项目”录入第一个。</p> : (
        <table className="grid clickable">
          <thead><tr><th>项目名称</th><th>类型</th><th>电压等级</th><th>状态</th><th>卷册（已出图/总数）</th><th>未解决问题</th><th>截止日期</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const s = stat(p.id);
              return (
                <tr key={String(p.id)} onClick={() => onOpen(Number(p.id))}>
                  <td><strong>{p.name}</strong></td>
                  <td><EnumBadge k="projectType" v={p.project_type} /></td>
                  <td>{p.voltage_level}</td>
                  <td><EnumBadge k="projectStatus" v={p.status} /></td>
                  <td>{s.issued} / {s.volumes}</td>
                  <td>{s.open ? <span className="count-open">{s.open}</span> : 0}</td>
                  <td className={dueClass(p.due_date as string, p.status === "done")}>{p.due_date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editor.element(() => { projects.reload(); })}
    </>
  );
}

function Kanban({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const [projectFilter, setProjectFilter] = useState<string>("");
  const projects = useList("project");
  const volumes = useList("volume", projectFilter ? { project_id: Number(projectFilter) } : {});
  const editor = useEditor();
  const [dragId, setDragId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectName = useMemo(() => new Map(projects.rows.map((p) => [p.id, String(p.name)])), [projects.rows]);
  const activeProjectIds = new Set(projects.rows.filter((p) => p.status !== "done").map((p) => p.id));
  const shown = volumes.rows.filter((v) => projectFilter || activeProjectIds.has(v.project_id));

  const move = async (id: number, status: string) => {
    try { await call(window.api.board.update("volume", id, { status })); setError(null); volumes.reload(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <div className="toolbar">
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="按项目筛选">
          <option value="">全部未完成项目</option>
          {projects.rows.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
        </select>
        <button className="primary" disabled={!projects.rows.length}
          onClick={() => editor.open({ entity: "volume", initial: projectFilter ? { project_id: Number(projectFilter) } : undefined })}>＋ 新建卷册</button>
        <span className="muted">拖动卡片可以改变卷册状态</span>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="kanban">
        {ENUMS.volumeStatus.map((col) => {
          const cards = shown.filter((v) => v.status === col.value);
          return (
            <div key={col.value} className="kanban-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId != null) move(dragId, col.value); setDragId(null); }}>
              <div className="kanban-head">{col.label} <span className="muted">{cards.length}</span></div>
              {cards.map((v) => (
                <div key={String(v.id)} className="kanban-card" draggable onDragStart={() => setDragId(Number(v.id))}
                  onDoubleClick={() => editor.open({ entity: "volume", row: v })}>
                  <div className="kc-title">{v.name}</div>
                  <div className="kc-meta">{[v.drawing_no, v.revision].filter(Boolean).join(" · ")}</div>
                  <button className="link kc-project" onClick={() => onOpenProject(Number(v.project_id))}>{projectName.get(v.project_id)}</button>
                  {v.due_date && <div className={`kc-due ${dueClass(v.due_date as string, v.status === "issued")}`}>交付 {v.due_date}</div>}
                  <select className="kc-move" value={String(v.status)} onChange={(e) => move(Number(v.id), e.target.value)} aria-label="改变状态">
                    {ENUMS.volumeStatus.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {editor.element(() => volumes.reload())}
    </>
  );
}

function IssuesView() {
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("unresolved");
  const [natureFilter, setNatureFilter] = useState("");
  const projects = useList("project");
  const volumes = useList("volume");
  const issues = useList("issue", projectFilter ? { project_id: Number(projectFilter) } : {});
  const editor = useEditor();
  const rows = issues.rows.filter((r) =>
    (statusFilter === "all" || (statusFilter === "unresolved" ? r.status !== "confirmed" : r.status === statusFilter)) &&
    (!natureFilter || r.info_nature === natureFilter));
  const openCounts = projects.rows
    .map((p) => ({ p, n: issues.rows.filter((i) => i.project_id === p.id && i.status !== "confirmed").length }))
    .filter((x) => x.n > 0);

  return (
    <>
      <div className="toolbar">
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="项目">
          <option value="">全部项目</option>
          {projects.rows.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="状态">
          <option value="unresolved">未解决（含已提交）</option>
          {ENUMS.issueStatus.map((o) => <option key={o.value} value={o.value}>只看{o.label}</option>)}
          <option value="all">全部</option>
        </select>
        <select value={natureFilter} onChange={(e) => setNatureFilter(e.target.value)} aria-label="信息性质">
          <option value="">全部信息性质</option>
          {ENUMS.infoNature.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="primary" disabled={!projects.rows.length}
          onClick={() => editor.open({ entity: "issue", initial: projectFilter ? { project_id: Number(projectFilter) } : undefined })}>＋ 新建问题</button>
      </div>
      {!projectFilter && openCounts.length > 0 && (
        <div className="chips">
          {openCounts.map(({ p, n }) => (
            <button key={String(p.id)} className="chip" onClick={() => setProjectFilter(String(p.id))}>{p.name} <strong>{n}</strong></button>
          ))}
        </div>
      )}
      <IssueList rows={rows} volumes={volumes.rows} projects={projects.rows}
        onEdit={(r) => editor.open({ entity: "issue", row: r })}
        onDelete={async (r) => { try { if (await confirmDelete("issue", r)) issues.reload(); } catch (e) { window.alert((e as Error).message); } }} />
      {editor.element(() => issues.reload())}
    </>
  );
}
