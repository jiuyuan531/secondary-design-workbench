import { useEffect, useMemo, useState } from "react";
import { call } from "../lib";
import { visibleSettings, type SettingDef, type SettingValue } from "../../settings/schema";

/** 设置页：完全由 src/settings/schema.ts 驱动，不在这里手写任何说明文字。 */
export function SettingsPage({ onRestored }: { onRestored: () => void }) {
  const [values, setValues] = useState<Record<string, SettingValue> | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const defs = useMemo(() => visibleSettings(), []);
  const groups = useMemo(() => [...new Set(defs.map((d) => d.group))], [defs]);

  useEffect(() => { window.api.getSettings().then(setValues); }, []);
  if (!values) return <p>加载中……</p>;

  return (
    <section>
      <h1>设置</h1>
      {restartNeeded && (
        <div className="banner warn">
          部分修改需要重启程序才生效。<button className="primary" onClick={() => window.api.relaunch()}>立即重启</button>
        </div>
      )}
      {groups.map((g) => (
        <div key={g} className="setting-group">
          <h2>{g}</h2>
          {defs.filter((d) => d.group === g).map((d) => (
            <SettingRow
              key={d.key}
              def={d}
              value={values[d.key]}
              onSaved={(v, restart) => {
                setValues({ ...values, [d.key]: v });
                if (restart) setRestartNeeded(true);
              }}
            />
          ))}
        </div>
      ))}
      <BackupPanel onRestored={onRestored} />
    </section>
  );
}

function BackupPanel({ onRestored }: { onRestored: () => void }) {
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const backup = async () => {
    setMsg(null);
    try {
      const r = await call(window.api.data.backup());
      if (r) setMsg({ kind: "ok", text: `已备份到 ${r.path}（${r.summary}）` });
    } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
  };
  const restore = async () => {
    setMsg(null);
    try {
      const picked = await call(window.api.data.pickRestore());
      if (!picked) return;
      if (!picked.check.ok) { setMsg({ kind: "error", text: picked.check.error ?? "无法恢复这个文件" }); return; }
      if (!window.confirm(`确定用这个备份替换当前全部数据吗？\n\n${picked.path}\n备份内容：${picked.check.summary}\n\n当前数据会先自动备份一份，万一选错了还能找回。`)) return;
      const r = await call(window.api.data.restore(picked.path));
      window.alert(`恢复完成（${r.summary}）。\n恢复前的数据已自动备份到：\n${r.safetyBackup}`);
      onRestored();
    } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
  };
  return (
    <div className="setting-group">
      <h2>备份与恢复</h2>
      <p className="muted">备份会把整个数据库（项目、卷册、任务、问题、设置）存成一个 .db 文件。建议放在 U 盘或另一块硬盘上。恢复会用备份文件替换当前全部数据，替换前会自动把当前数据再备份一份。</p>
      <div className="setting-input">
        <button className="primary" onClick={backup}>备份数据库…</button>
        <button onClick={restore}>从备份恢复…</button>
      </div>
      {msg && <div className={msg.kind === "ok" ? "msg ok" : "msg error"}>{msg.text}</div>}
    </div>
  );
}

function SettingRow({ def, value, onSaved }: { def: SettingDef; value: SettingValue; onSaved: (v: SettingValue, restart: boolean) => void }) {
  const [draft, setDraft] = useState<string>(String(value));
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { setDraft(String(value)); }, [value]);

  const save = async (raw: unknown) => {
    const r = await window.api.setSetting(def.key, raw);
    if (r.ok) {
      setMsg({ kind: "ok", text: r.note ?? (r.restartRequired ? "已保存，重启后生效" : "已保存") });
      onSaved(r.value, r.restartRequired);
    } else {
      setMsg({ kind: "error", text: r.error });
    }
  };

  const dirty = draft !== String(value);

  return (
    <div className="setting-row">
      <div className="setting-head">
        <label htmlFor={def.key}>{def.label}</label>
        <button className="link" onClick={() => setShowHelp(!showHelp)}>{showHelp ? "收起说明" : "怎么填？"}</button>
      </div>
      <p className="muted">{def.description}</p>
      {showHelp && (
        <dl className="help">
          <dt>怎么填</dt><dd>{def.howToFill}</dd>
          <dt>填错了会怎样</dt><dd>{def.ifWrong}</dd>
          <dt>默认值</dt><dd>{def.default === "" ? "（留空）" : String(def.default)}</dd>
        </dl>
      )}
      <div className="setting-input">
        {def.type === "boolean" ? (
          <label className="switch">
            <input id={def.key} type="checkbox" checked={value === true} onChange={(e) => save(e.target.checked)} />
            {value ? "已开启" : "已关闭"}
          </label>
        ) : (
          <>
            <input
              id={def.key}
              type={def.type === "secret" ? "password" : def.type === "number" ? "number" : "text"}
              value={draft}
              min={def.min}
              max={def.max}
              placeholder={def.type === "path" ? "留空表示使用默认位置" : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && dirty) save(draft); }}
            />
            {def.type === "path" && (
              <button onClick={async () => {
                const p = await window.api.pickPath(def.pathKind ?? "file", draft);
                if (p) setDraft(p);
              }}>浏览…</button>
            )}
            <button className="primary" disabled={!dirty} onClick={() => save(draft)}>保存</button>
            {dirty && <button onClick={() => setDraft(String(value))}>撤销</button>}
          </>
        )}
        {def.restartRequired && <span className="tag">重启生效</span>}
      </div>
      {msg && <div className={msg.kind === "ok" ? "msg ok" : "msg error"}>{msg.text}</div>}
    </div>
  );
}
