import { useState } from "react";
import type { EntityName, IssueRow, Row } from "../../board/model";
import { ENTITIES } from "../../board/model";
import { enumLabel } from "../../board/enums";
import { EnumBadge } from "./EnumBadge";
import { EntityForm } from "./EntityForm";
import { call, dueClass } from "../lib";

/** 删除前确认；项目会提示连带删除的内容。 */
export async function confirmDelete(entity: EntityName, row: Row): Promise<boolean> {
  const impact = await call(window.api.board.deleteImpact(entity, Number(row.id)));
  const name = String(row.name ?? row.content ?? row.description ?? "").slice(0, 40);
  const extra = impact.length ? `\n\n将同时删除：${impact.join("、")}。` : "";
  if (!window.confirm(`确定删除${ENTITIES[entity].label}“${name}”吗？${extra}\n\n删除后无法撤销（可以从备份恢复）。`)) return false;
  await call(window.api.board.remove(entity, Number(row.id)));
  return true;
}

function volumeName(volumes: Row[], id: unknown): string {
  if (id == null) return "";
  const v = volumes.find((x) => x.id === id);
  return v ? String(v.name) : "";
}

export function VolumeTable({ rows, onEdit, onDelete }: { rows: Row[]; onEdit: (r: Row) => void; onDelete: (r: Row) => void }) {
  if (!rows.length) return <p className="muted">还没有卷册。</p>;
  return (
    <table className="grid">
      <thead><tr><th>卷册名称</th><th>图号</th><th>版本</th><th>状态</th><th>交付日期</th><th></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.id)}>
            <td>{r.name}</td><td>{r.drawing_no}</td><td>{r.revision}</td>
            <td><EnumBadge k="volumeStatus" v={r.status} /></td>
            <td className={dueClass(r.due_date as string, r.status === "issued")}>{r.due_date}</td>
            <td className="actions"><button className="link" onClick={() => onEdit(r)}>编辑</button><button className="link danger" onClick={() => onDelete(r)}>删除</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TaskTable({ rows, volumes, onEdit, onDelete, onToggle }: {
  rows: Row[]; volumes: Row[]; onEdit: (r: Row) => void; onDelete: (r: Row) => void; onToggle: (r: Row) => void;
}) {
  if (!rows.length) return <p className="muted">还没有任务。</p>;
  return (
    <table className="grid">
      <thead><tr><th style={{ width: 32 }}></th><th>任务内容</th><th>卷册</th><th>优先级</th><th>状态</th><th>截止日期</th><th></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.id)} className={r.status === "done" ? "done" : ""}>
            <td><input type="checkbox" checked={r.status === "done"} onChange={() => onToggle(r)} aria-label="完成" /></td>
            <td className="pre">{r.content}</td>
            <td>{volumeName(volumes, r.volume_id)}</td>
            <td><EnumBadge k="priority" v={r.priority} /></td>
            <td><EnumBadge k="taskStatus" v={r.status} /></td>
            <td className={dueClass(r.due_date as string, r.status === "done")}>{r.due_date}</td>
            <td className="actions"><button className="link" onClick={() => onEdit(r)}>编辑</button><button className="link danger" onClick={() => onDelete(r)}>删除</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function IssueList({ rows, volumes, projects, onEdit, onDelete }: {
  rows: Row[]; volumes: Row[]; projects?: Row[]; onEdit: (r: Row) => void; onDelete: (r: Row) => void;
}) {
  if (!rows.length) return <p className="muted">没有符合条件的问题。</p>;
  return (
    <div className="issue-list">
      {(rows as IssueRow[]).map((r) => (
        <div key={String(r.id)} className={`issue-card status-${r.status}`}>
          <div className="issue-head">
            <EnumBadge k="issueStatus" v={r.status} />
            <EnumBadge k="infoNature" v={r.info_nature} />
            {r.has_conflict === 1 && <span className="badge conflict">来源矛盾</span>}
            {projects && <span className="muted">{String(projects.find((p) => p.id === r.project_id)?.name ?? "")}</span>}
            {r.volume_id != null && <span className="muted">· {volumeName(volumes, r.volume_id)}</span>}
            <span className="spacer" />
            <button className="link" onClick={() => onEdit(r)}>编辑</button>
            <button className="link danger" onClick={() => onDelete(r)}>删除</button>
          </div>
          <div className="pre issue-desc">{r.description}</div>
          {r.sources.length > 0 && (
            <ul className={r.has_conflict === 1 ? "sources conflict" : "sources"}>
              {r.sources.map((s, i) => (
                <li key={i}>
                  <span className="badge source">{enumLabel("sourceType", s.source_type)}</span> {s.reference}
                  {s.statement && <div className="statement">“{s.statement}”</div>}
                </li>
              ))}
            </ul>
          )}
          {r.status === "confirmed" && (
            <div className="conclusion">
              <strong>结论：</strong><span className="pre">{r.conclusion}</span>
              <span className="muted">（{r.confirmed_by}，{r.confirmed_date}）</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 管理表单弹窗状态的小工具 */
export function useEditor() {
  const [state, setState] = useState<{ entity: EntityName; row?: Row; initial?: Row; hidden?: string[] } | null>(null);
  const element = (onSaved: () => void) =>
    state && (
      <EntityForm
        entity={state.entity}
        initial={state.row ?? state.initial}
        editId={state.row ? Number(state.row.id) : undefined}
        hidden={state.hidden}
        onClose={() => setState(null)}
        onSaved={() => { setState(null); onSaved(); }}
      />
    );
  return { open: setState, element };
}
