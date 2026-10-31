import { useEffect, useMemo, useState } from "react";
import { visibleSettings, type SettingDef, type SettingValue } from "../../settings/schema";

/** 设置页：完全由 src/settings/schema.ts 驱动，不在这里手写任何说明文字。 */
export function SettingsPage() {
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
    </section>
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
