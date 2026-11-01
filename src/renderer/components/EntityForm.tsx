import { useEffect, useState } from "react";
import { ENTITIES, type EntityName, type FieldDef, type IssueSource, type Row } from "../../board/model";
import { ENUMS } from "../../board/enums";
import { call } from "../lib";
import { Modal } from "./Modal";

/**
 * 通用的新建/编辑表单，字段完全按 src/board/model.ts 渲染。
 * 待确认问题额外带“来源”编辑器（可多个来源，矛盾时分别记下说法）。
 */
export function EntityForm(props: {
  entity: EntityName;
  /** 编辑时传入已有数据；新建时传入预填值（如所属项目） */
  initial?: Row;
  editId?: number;
  /** 不在表单里显示的字段（比如在项目详情页里新建卷册时，所属项目已定） */
  hidden?: string[];
  onClose: () => void;
  onSaved: (row: Row) => void;
}) {
  const def = ENTITIES[props.entity];
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of def.fields) v[f.key] = props.initial?.[f.key] ?? f.default ?? "";
    if (props.entity === "issue") v.sources = (props.initial as { sources?: IssueSource[] })?.sources ?? [];
    return v;
  });
  const [projects, setProjects] = useState<Row[]>([]);
  const [volumes, setVolumes] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (def.fields.some((f) => f.refEntity === "project")) call(window.api.board.list("project")).then(setProjects);
  }, [def]);
  useEffect(() => {
    if (!def.fields.some((f) => f.refEntity === "volume")) return;
    const pid = Number(values.project_id);
    if (!pid) { setVolumes([]); return; }
    call(window.api.board.list("volume", { project_id: pid })).then(setVolumes);
  }, [def, values.project_id]);

  const set = (k: string, v: unknown) => setValues((old) => {
    const next = { ...old, [k]: v };
    if (k === "project_id") next.volume_id = ""; // 换项目后卷册要重选
    return next;
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const row = props.editId
        ? await call(window.api.board.update(props.entity, props.editId, values))
        : await call(window.api.board.create(props.entity, values));
      props.onSaved(row);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const showConfirmFields = props.entity !== "issue" || values.status === "confirmed";
  const fields = def.fields.filter((f) => !props.hidden?.includes(f.key))
    .filter((f) => showConfirmFields || !["confirmed_by", "confirmed_date", "conclusion"].includes(f.key));

  return (
    <Modal title={`${props.editId ? "编辑" : "新建"}${def.label}`} onClose={props.onClose} wide={props.entity === "issue"}>
      <div className="form">
        {fields.map((f) => (
          <FieldInput key={f.key} f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} projects={projects} volumes={volumes} />
        ))}
        {props.entity === "issue" && (
          <SourcesEditor
            sources={values.sources as IssueSource[]}
            conflict={!!Number(values.has_conflict) || values.has_conflict === true}
            onChange={(s) => set("sources", s)}
          />
        )}
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="modal-actions">
        <button onClick={props.onClose}>取消</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? "保存中……" : "保存"}</button>
      </div>
    </Modal>
  );
}

function FieldInput({ f, value, onChange, projects, volumes }: {
  f: FieldDef; value: unknown; onChange: (v: unknown) => void; projects: Row[]; volumes: Row[];
}) {
  const id = `f-${f.key}`;
  const label = <label htmlFor={id}>{f.label}{f.required && <span className="req">*</span>}</label>;
  let input;
  switch (f.type) {
    case "textarea":
      input = <textarea id={id} rows={3} value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "date":
      input = <input id={id} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "boolean":
      input = (
        <label className="switch">
          <input id={id} type="checkbox" checked={value === true || Number(value) === 1} onChange={(e) => onChange(e.target.checked)} />
          是
        </label>
      );
      break;
    case "enum":
      input = (
        <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {!f.required && <option value="">（不选）</option>}
          {ENUMS[f.enumKey!].map((o) => <option key={o.value} value={o.value} title={o.hint}>{o.label}</option>)}
        </select>
      );
      break;
    case "ref": {
      const opts = f.refEntity === "project" ? projects : volumes;
      input = (
        <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.required ? "请选择" : "（不选）"}</option>
          {opts.map((o) => (
            <option key={String(o.id)} value={String(o.id)}>
              {String(o.name)}{f.refEntity === "volume" && o.drawing_no ? `（${o.drawing_no}）` : ""}
            </option>
          ))}
        </select>
      );
      break;
    }
    default:
      input = <input id={id} type="text" value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="form-row">
      {label}
      <div>
        {input}
        {f.help && <div className="hint">{f.help}</div>}
      </div>
    </div>
  );
}

function SourcesEditor({ sources, conflict, onChange }: { sources: IssueSource[]; conflict: boolean; onChange: (s: IssueSource[]) => void }) {
  const upd = (i: number, k: keyof IssueSource, v: string) => onChange(sources.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  return (
    <div className="form-row">
      <label>来源</label>
      <div>
        <div className="hint">
          {conflict
            ? "有矛盾：至少填两个来源，每个来源分别写明它的说法。不需要选哪边对。"
            : "问题的依据从哪里来。可以填多个。"}
        </div>
        {sources.map((s, i) => (
          <div key={i} className={conflict ? "source-card conflict" : "source-card"}>
            <div className="source-head">
              <strong>来源 {i + 1}</strong>
              <button className="link danger" onClick={() => onChange(sources.filter((_, j) => j !== i))}>删除</button>
            </div>
            <div className="source-grid">
              <select value={s.source_type} onChange={(e) => upd(i, "source_type", e.target.value)} aria-label="来源类型">
                <option value="">来源类型……</option>
                {ENUMS.sourceType.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="text" value={s.reference} placeholder="来源引用：文件名、页码或图号" onChange={(e) => upd(i, "reference", e.target.value)} />
            </div>
            <textarea rows={2} value={s.statement} placeholder={conflict ? "这个来源的说法（必填）" : "这个来源怎么说（可选）"} onChange={(e) => upd(i, "statement", e.target.value)} />
          </div>
        ))}
        <button onClick={() => onChange([...sources, { source_type: "", reference: "", statement: "" }])}>＋ 添加来源</button>
      </div>
    </div>
  );
}
