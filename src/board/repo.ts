/**
 * 项目看板的增删改查。只依赖 AppDatabase，不依赖 Electron，便于单元测试。
 * 所有校验错误都抛出 BoardError（中文信息），界面直接显示。
 */
import type { AppDatabase } from "../db/database";
import { ENTITIES, type EntityName, type FieldDef, type IssueRow, type IssueSource, type Row } from "./model";
import { isEnumValue, ENUMS } from "./enums";

export class BoardError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nowIso(): string {
  return new Date().toISOString();
}

export interface ListFilter {
  project_id?: number;
  volume_id?: number;
  status?: string;
}

/** 校验并规范化一行数据。partial=true 时只校验传入的字段（用于更新）。 */
function normalize(db: AppDatabase, entity: EntityName, input: Record<string, unknown>, partial: boolean): Row {
  const def = ENTITIES[entity];
  const out: Row = {};
  for (const f of def.fields) {
    if (partial && !(f.key in input)) continue;
    out[f.key] = normalizeField(db, f, input[f.key]);
  }
  return out;
}

function normalizeField(db: AppDatabase, f: FieldDef, raw: unknown): string | number | null {
  const empty = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
  if (f.type === "boolean") return raw === true || raw === 1 || raw === "1" ? 1 : 0;
  if (empty) {
    if (f.required) throw new BoardError(`“${f.label}”不能为空`);
    return null;
  }
  switch (f.type) {
    case "text":
    case "textarea":
      return String(raw).trim();
    case "date": {
      const s = String(raw).trim();
      if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw new BoardError(`“${f.label}”的日期格式应为 2026-10-31`);
      return s;
    }
    case "enum":
      if (!isEnumValue(f.enumKey!, raw)) throw new BoardError(`“${f.label}”的取值无效：${String(raw)}`);
      return raw as string;
    case "ref": {
      const id = Number(raw);
      const target = ENTITIES[f.refEntity!];
      if (!Number.isInteger(id) || db.all(`SELECT 1 FROM ${target.table} WHERE id = ?`, [id]).length === 0)
        throw new BoardError(`“${f.label}”指向的${target.label}不存在`);
      return id;
    }
  }
}

/** 跨字段校验：卷册必须属于同一项目；问题的确认信息和矛盾来源。 */
function crossCheck(db: AppDatabase, entity: EntityName, row: Row, sources?: IssueSource[]): void {
  if ((entity === "task" || entity === "issue") && row.volume_id != null) {
    const v = db.all<{ project_id: number }>("SELECT project_id FROM volumes WHERE id = ?", [row.volume_id]);
    if (v[0]?.project_id !== row.project_id) throw new BoardError("所选卷册不属于所选项目");
  }
  if (entity === "issue") {
    if (row.status === "confirmed") {
      const missing = [["confirmed_by", "确认人"], ["confirmed_date", "确认日期"], ["conclusion", "结论"]]
        .filter(([k]) => row[k] == null)
        .map(([, l]) => l);
      if (missing.length) throw new BoardError(`状态为“已确认”时必须填写：${missing.join("、")}`);
    }
    const srcs = sources ?? [];
    if (row.has_conflict === 1 && srcs.length < 2)
      throw new BoardError("勾选了“来源之间有矛盾”时，至少要填两个来源，并分别写明各自的说法");
    if (row.has_conflict === 1 && srcs.some((s) => !s.statement.trim()))
      throw new BoardError("有矛盾时，每个来源都要写明它的说法");
  }
}

function normalizeSources(raw: unknown): IssueSource[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new BoardError("来源格式不正确");
  return raw
    .map((s) => ({
      source_type: String(s?.source_type ?? ""),
      reference: String(s?.reference ?? "").trim(),
      statement: String(s?.statement ?? "").trim(),
    }))
    .filter((s) => s.reference || s.statement || s.source_type)
    .map((s, i) => {
      if (!isEnumValue("sourceType", s.source_type))
        throw new BoardError(`第 ${i + 1} 个来源请选择来源类型（${ENUMS.sourceType.map((o) => o.label).join(" / ")}）`);
      if (!s.reference) throw new BoardError(`第 ${i + 1} 个来源请填写来源引用（文件名、页码或图号）`);
      return s;
    });
}

function loadSources(db: AppDatabase, issueId: number): IssueSource[] {
  return db.all<IssueSource>(
    "SELECT id, source_type, reference, statement FROM issue_sources WHERE issue_id = ? ORDER BY position",
    [issueId],
  );
}

function writeSources(db: AppDatabase, issueId: number, sources: IssueSource[]): void {
  db.runNoPersist("DELETE FROM issue_sources WHERE issue_id = ?", [issueId]);
  sources.forEach((s, i) =>
    db.runNoPersist(
      "INSERT INTO issue_sources (issue_id, position, source_type, reference, statement) VALUES (?, ?, ?, ?, ?)",
      [issueId, i, s.source_type, s.reference, s.statement],
    ),
  );
}

export function list(db: AppDatabase, entity: EntityName, filter: ListFilter = {}): Row[] {
  const def = ENTITIES[entity];
  const where: string[] = [];
  const params: (string | number)[] = [];
  for (const k of ["project_id", "volume_id", "status"] as const) {
    if (filter[k] !== undefined && def.fields.some((f) => f.key === k)) {
      where.push(`${k} = ?`);
      params.push(filter[k]!);
    }
  }
  const rows = db.all<Row>(
    `SELECT * FROM ${def.table} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${def.orderBy}`,
    params,
  );
  if (entity === "issue") return rows.map((r) => ({ ...r, sources: loadSources(db, Number(r.id)) }) as IssueRow);
  return rows;
}

export function get(db: AppDatabase, entity: EntityName, id: number): Row {
  const def = ENTITIES[entity];
  const [row] = db.all<Row>(`SELECT * FROM ${def.table} WHERE id = ?`, [id]);
  if (!row) throw new BoardError(`${def.label}不存在（编号 ${id}）`);
  if (entity === "issue") return { ...row, sources: loadSources(db, id) } as IssueRow;
  return row;
}

export function create(db: AppDatabase, entity: EntityName, input: Record<string, unknown>): Row {
  const def = ENTITIES[entity];
  const row = normalize(db, entity, input, false);
  const sources = entity === "issue" ? normalizeSources(input.sources) : undefined;
  crossCheck(db, entity, row, sources);
  const now = nowIso();
  const cols = [...Object.keys(row), "created_at", "updated_at"];
  let id = 0;
  db.transaction(() => {
    db.runNoPersist(
      `INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      [...Object.values(row), now, now],
    );
    id = Number(db.all<{ id: number }>("SELECT last_insert_rowid() AS id")[0].id);
    if (sources) writeSources(db, id, sources);
  });
  return get(db, entity, id);
}

export function update(db: AppDatabase, entity: EntityName, id: number, input: Record<string, unknown>): Row {
  const def = ENTITIES[entity];
  const current = get(db, entity, id);
  const patch = normalize(db, entity, input, true);
  const merged = { ...current, ...patch } as Row;
  const sources = entity === "issue"
    ? ("sources" in input ? normalizeSources(input.sources) : (current as IssueRow).sources)
    : undefined;
  crossCheck(db, entity, merged, sources);
  db.transaction(() => {
    const keys = Object.keys(patch);
    if (keys.length) {
      db.runNoPersist(
        `UPDATE ${def.table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
        [...Object.values(patch), nowIso(), id],
      );
    } else {
      db.runNoPersist(`UPDATE ${def.table} SET updated_at = ? WHERE id = ?`, [nowIso(), id]);
    }
    if (entity === "issue" && "sources" in input) writeSources(db, id, sources!);
  });
  return get(db, entity, id);
}

/** 删除前统计会被一并删除的内容，供界面提示确认。 */
export function deleteImpact(db: AppDatabase, entity: EntityName, id: number): string[] {
  const out: string[] = [];
  const count = (sql: string) => Number(db.all<{ c: number }>(sql, [id])[0].c);
  if (entity === "project") {
    const v = count("SELECT count(*) AS c FROM volumes WHERE project_id = ?");
    const t = count("SELECT count(*) AS c FROM tasks WHERE project_id = ?");
    const i = count("SELECT count(*) AS c FROM issues WHERE project_id = ?");
    if (v) out.push(`${v} 个卷册`);
    if (t) out.push(`${t} 个任务`);
    if (i) out.push(`${i} 个待确认问题`);
  }
  return out;
}

export function remove(db: AppDatabase, entity: EntityName, id: number): void {
  const def = ENTITIES[entity];
  get(db, entity, id);
  db.run(`DELETE FROM ${def.table} WHERE id = ?`, [id]);
}

// ---------------- 仪表盘 ----------------

export interface DashboardItem {
  kind: "volume" | "task";
  id: number;
  project_id: number;
  project_name: string;
  title: string;
  status: string;
  due_date: string;
  days_left: number;
}

export interface Dashboard {
  upcoming: DashboardItem[];
  openIssuesByProject: { project_id: number; project_name: string; open: number; submitted: number; conflicts: number }[];
  totals: { projects: number; activeProjects: number; openIssues: number };
}

/** 首页简版仪表盘：withinDays 天内到期（含已逾期）且未完成的卷册和任务；各项目未解决问题数。 */
export function dashboard(db: AppDatabase, today: string, withinDays = 14): Dashboard {
  const limit = addDays(today, withinDays);
  const vols = db.all<Omit<DashboardItem, "kind" | "days_left">>(
    `SELECT v.id, v.project_id, p.name AS project_name, v.name AS title, v.status, v.due_date
       FROM volumes v JOIN projects p ON p.id = v.project_id
      WHERE v.due_date IS NOT NULL AND v.due_date <= ? AND v.status != 'issued' AND p.status != 'done'`,
    [limit],
  ).map((r) => ({ ...r, kind: "volume" as const }));
  const tasks = db.all<Omit<DashboardItem, "kind" | "days_left">>(
    `SELECT t.id, t.project_id, p.name AS project_name, t.content AS title, t.status, t.due_date
       FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.due_date IS NOT NULL AND t.due_date <= ? AND t.status != 'done' AND p.status != 'done'`,
    [limit],
  ).map((r) => ({ ...r, kind: "task" as const }));
  const upcoming = [...vols, ...tasks]
    .map((r) => ({ ...r, days_left: daysBetween(today, r.due_date) }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.kind.localeCompare(b.kind));

  const openIssuesByProject = db.all<Dashboard["openIssuesByProject"][number]>(
    `SELECT p.id AS project_id, p.name AS project_name,
            sum(CASE WHEN i.status = 'open' THEN 1 ELSE 0 END) AS open,
            sum(CASE WHEN i.status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
            sum(CASE WHEN i.status != 'confirmed' AND i.has_conflict = 1 THEN 1 ELSE 0 END) AS conflicts
       FROM projects p JOIN issues i ON i.project_id = p.id
      WHERE i.status != 'confirmed'
      GROUP BY p.id ORDER BY open DESC, submitted DESC, p.id`,
  ).map((r) => ({ ...r, open: Number(r.open), submitted: Number(r.submitted), conflicts: Number(r.conflicts) }));

  const [t] = db.all<{ projects: number; active: number; open: number }>(
    `SELECT (SELECT count(*) FROM projects) AS projects,
            (SELECT count(*) FROM projects WHERE status = 'active') AS active,
            (SELECT count(*) FROM issues WHERE status != 'confirmed') AS open`,
  );
  return {
    upcoming,
    openIssuesByProject,
    totals: { projects: Number(t.projects), activeProjects: Number(t.active), openIssues: Number(t.open) },
  };
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}
