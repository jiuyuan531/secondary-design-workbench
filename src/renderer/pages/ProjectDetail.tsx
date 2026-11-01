import { useEffect, useState } from "react";
import type { Row } from "../../board/model";
import { ENUMS } from "../../board/enums";
import { EnumBadge } from "../components/EnumBadge";
import { VolumeTable, TaskTable, IssueList, confirmDelete, useEditor } from "../components/Tables";
import { useList } from "../useList";
import { call } from "../lib";

export function ProjectDetail({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const [project, setProject] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<"unresolved" | "all">("unresolved");
  const volumes = useList("volume", { project_id: projectId });
  const tasks = useList("task", { project_id: projectId });
  const issues = useList("issue", { project_id: projectId });
  const editor = useEditor();

  const loadProject = () => call(window.api.board.get("project", projectId)).then(setProject).catch((e) => setError(e.message));
  useEffect(() => { loadProject(); }, [projectId]);
  const reloadAll = () => { loadProject(); volumes.reload(); tasks.reload(); issues.reload(); };
  const del = async (entity: "volume" | "task" | "issue", r: Row) => {
    try { if (await confirmDelete(entity, r)) reloadAll(); } catch (e) { window.alert((e as Error).message); }
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!project) return <p>加载中……</p>;
  const pid = { project_id: projectId } as Row;
  const shownIssues = issueFilter === "all" ? issues.rows : issues.rows.filter((r) => r.status !== "confirmed");
  const unresolved = issues.rows.filter((r) => r.status !== "confirmed").length;

  return (
    <section>
      <button className="link" onClick={onBack}>← 返回项目列表</button>
      <div className="title-row">
        <h1>{project.name}</h1>
        <EnumBadge k="projectStatus" v={project.status} />
        <span className="spacer" />
        <button onClick={() => editor.open({ entity: "project", row: project })}>编辑项目</button>
        <button className="danger-btn" onClick={async () => {
          try { if (await confirmDelete("project", project)) onBack(); } catch (e) { window.alert((e as Error).message); }
        }}>删除项目</button>
      </div>
      <table className="kv">
        <tbody>
          <tr><th>项目类型</th><td><EnumBadge k="projectType" v={project.project_type} /></td><th>电压等级</th><td>{project.voltage_level}</td></tr>
          <tr><th>开始日期</th><td>{project.start_date}</td><th>截止日期</th><td>{project.due_date}</td></tr>
          <tr><th>本地文件夹</th><td colSpan={3}>
            {project.folder_path ? <><code>{project.folder_path}</code> <button className="link" onClick={async () => {
              const err = await window.api.openPath(String(project.folder_path));
              if (err) window.alert(`无法打开文件夹：${err}`);
            }}>打开</button></> : <span className="muted">未填写</span>}
          </td></tr>
          {project.notes && <tr><th>备注</th><td colSpan={3} className="pre">{project.notes}</td></tr>}
        </tbody>
      </table>

      <div className="section-head">
        <h2>卷册（{volumes.rows.length}）</h2>
        <button className="primary" onClick={() => editor.open({ entity: "volume", initial: pid, hidden: ["project_id"] })}>＋ 新建卷册</button>
      </div>
      <VolumeTable rows={volumes.rows} onEdit={(r) => editor.open({ entity: "volume", row: r, hidden: ["project_id"] })} onDelete={(r) => del("volume", r)} />

      <div className="section-head">
        <h2>任务（未完成 {tasks.rows.filter((t) => t.status !== "done").length} / 共 {tasks.rows.length}）</h2>
        <button className="primary" onClick={() => editor.open({ entity: "task", initial: pid, hidden: ["project_id"] })}>＋ 新建任务</button>
      </div>
      <TaskTable
        rows={tasks.rows} volumes={volumes.rows}
        onEdit={(r) => editor.open({ entity: "task", row: r, hidden: ["project_id"] })}
        onDelete={(r) => del("task", r)}
        onToggle={async (r) => {
          try { await call(window.api.board.update("task", Number(r.id), { status: r.status === "done" ? "todo" : "done" })); tasks.reload(); }
          catch (e) { window.alert((e as Error).message); }
        }}
      />

      <div className="section-head">
        <h2>待确认问题（未解决 {unresolved}）</h2>
        <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value as "unresolved" | "all")} aria-label="筛选">
          <option value="unresolved">只看未解决</option>
          <option value="all">全部（含{ENUMS.issueStatus.find((o) => o.value === "confirmed")!.label}）</option>
        </select>
        <button className="primary" onClick={() => editor.open({ entity: "issue", initial: pid, hidden: ["project_id"] })}>＋ 新建问题</button>
      </div>
      <IssueList rows={shownIssues} volumes={volumes.rows} onEdit={(r) => editor.open({ entity: "issue", row: r, hidden: ["project_id"] })} onDelete={(r) => del("issue", r)} />

      {editor.element(reloadAll)}
    </section>
  );
}
