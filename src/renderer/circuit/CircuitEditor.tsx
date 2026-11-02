import { useEffect, useMemo, useRef, useState } from "react";
import { loadCircuit, initialState, step, type Circuit } from "../../engine/index";
import { powerNodes } from "../../engine/validate";
import { CircuitView } from "./CircuitView";
import { call } from "../lib";
import type { ClaudeGenerateResult } from "../../shared/api";
export { blankCircuitText, copyCircuitText } from "./templates";

/**
 * 回路编辑器：左边改 JSON，右边实时预览。
 * 预览图上可以拖动元件和节点改布局坐标（自动对齐 10 的整数倍），双击元件切换横放 / 竖放。
 * 保存时主进程会再校验一次，格式不对不会写入；覆盖前旧文件存到“历史版本”子目录。
 */
export function CircuitEditor({ file, initialText, existingFiles, onClose, onSaved, generated }: {
  /** null 表示新建 */
  file: string | null;
  initialText: string;
  existingFiles: string[];
  onClose: () => void;
  onSaved: (file: string) => void;
  /** 由 Claude 生成的内容：显示它的说明和检查结果，关闭时提醒还没保存 */
  generated?: ClaudeGenerateResult;
}) {
  const [text, setText] = useState(initialText);
  const [fileName, setFileName] = useState(() => file ?? suggestFileName(initialText, existingFiles));
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const parsed = useMemo(() => {
    try {
      const { circuit, migratedFrom } = loadCircuit(text);
      return { circuit, migratedFrom, error: null as string | null };
    } catch (e) {
      return { circuit: null, migratedFrom: [], error: (e as Error).message };
    }
  }, [text]);
  // 文本暂时有错时，预览保留上一次正确的样子
  const lastGood = useRef<Circuit | null>(null);
  if (parsed.circuit) lastGood.current = parsed.circuit;
  const shown = parsed.circuit ?? lastGood.current;

  const sim = useMemo(() => {
    if (!shown) return null;
    try {
      const st = initialState(shown);
      return { state: st, report: step(shown, st, 1).report };
    } catch {
      return null;
    }
  }, [shown]);

  /** 改布局：在原始 JSON 上改坐标后重新格式化 */
  const editLayout = (fn: (layout: Record<string, Record<string, unknown>>, raw: Record<string, unknown>) => void) => {
    if (!parsed.circuit) return;
    const raw = JSON.parse(text) as Record<string, unknown>;
    const layout = (raw.layout ?? {}) as Record<string, Record<string, unknown>>;
    fn(layout, raw);
    raw.layout = layout;
    setText(JSON.stringify(raw, null, 2) + "\n");
  };
  const onMove = (id: string, x: number, y: number) => editLayout((layout, raw) => {
    const isNode = (raw.nodes as string[] | undefined)?.includes(id) && !(raw.components as { id: string }[]).some((c) => c.id === id);
    const old = layout[id] ?? {};
    if (isNode) {
      // 节点：整体平移，包括母线拐点
      const dx = x - Number(old.x ?? 0), dy = y - Number(old.y ?? 0);
      const pts = Array.isArray(old.points) ? (old.points as [number, number][]).map(([px, py]) => [px + dx, py + dy]) : undefined;
      layout[id] = { ...old, x, y, ...(pts ? { points: pts } : {}) };
    } else {
      layout[id] = { ...old, x, y, dir: old.dir ?? "h" };
    }
  });
  const onRotate = (id: string) => editLayout((layout) => {
    const old = layout[id];
    if (!old) return;
    layout[id] = { ...old, dir: old.dir === "v" ? "h" : "v" };
  });

  const save = async () => {
    setSaveErr(null);
    if (parsed.error) { setSaveErr("格式还有错误，改好之后才能保存。"); return; }
    const name = fileName.trim().endsWith(".json") ? fileName.trim() : `${fileName.trim()}.json`;
    if (!/^[^\\/:*?"<>|]+\.json$/.test(name)) { setSaveErr("文件名不能包含 \\ / : * ? \" < > | 这些字符"); return; }
    setSaving(true);
    try {
      await call(window.api.circuits.write(name, text, file === null));
      onSaved(name);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const close = () => {
    if ((text !== initialText || generated) && !window.confirm(generated ? "Claude 生成的回路还没有保存，关闭后就没有了。确定关闭吗？" : "修改还没有保存，确定关闭吗？")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = text.slice(0, a) + "  " + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
  };

  return (
    <div className="editor-overlay" role="dialog" aria-label="回路编辑器">
      <div className="editor-head">
        <h2>{file ? `编辑回路：${file}` : "新建回路"}</h2>
        <label className="file-name">文件名
          <input value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={file !== null} />
        </label>
        <span className="spacer" />
        <button className="link" onClick={() => setShowHelp(!showHelp)}>{showHelp ? "收起速查" : "格式速查"}</button>
        <button className="link" onClick={() => call(window.api.circuits.openFormatDoc()).catch((e) => setSaveErr(e.message))}>完整格式说明</button>
        <button className="primary" onClick={save} disabled={saving || !!parsed.error}>{saving ? "保存中…" : "保存（Ctrl+S）"}</button>
        <button onClick={close}>关闭</button>
      </div>
      {generated && (
        <div className={generated.errors.length ? "banner warn small generated" : "banner info small generated"}>
          <div>
            <b>这是 Claude 生成的草稿</b>（共调用 {generated.attempts} 次{generated.costUsd ? `，约 ${generated.costUsd.toFixed(2)} 美元` : ""}）。
            {generated.errors.length
              ? `自动检查还剩 ${generated.errors.length} 处问题，可以在左边手动改，或关闭后换个说法重新生成：`
              : "格式检查和演示场景试运行都已通过。请对照右边的图核对接法，确认后保存。"}
            {generated.errors.length > 0 && <ul>{generated.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            {generated.notes && <div className="pre claude-notes">{plainText(generated.notes)}</div>}
          </div>
        </div>
      )}
      {saveErr && <div className="banner error small"><pre>{saveErr}</pre></div>}
      <div className="editor-body">
        <div className="editor-left">
          <textarea className="json-edit" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onTab} spellCheck={false} />
          <div className={parsed.error ? "check-result bad" : "check-result ok"}>
            {parsed.error
              ? <pre>{parsed.error}</pre>
              : <>✓ 格式正确{parsed.migratedFrom.length ? `（这是旧版本格式，保存时内容不变，读入时会自动升级）` : ""}。{parsed.circuit?.reviewStatus !== "已审核" && "审核状态是“草稿”。"}</>}
          </div>
        </div>
        <div className="editor-right">
          {showHelp && <FormatHelp />}
          {shown && sim ? (
            <>
              <CircuitView circuit={shown} state={sim.state} preview={sim.report} onToggle={() => {}}
                positive={powerNodes(shown).positive} editing={parsed.circuit ? { onMove, onRotate } : undefined} className="editor-preview" />
              <p className="muted small">
                拖动元件或节点圆点可以移动位置（坐标自动对齐到 10 的整数倍），双击元件切换横放 / 竖放，滚轮缩放。
                {parsed.error && "文本有错误时只显示上一次正确的样子，不能拖动。"}
              </p>
            </>
          ) : <p className="muted">格式改正确后这里会显示回路图。</p>}
        </div>
      </div>
    </div>
  );
}

function FormatHelp() {
  return (
    <div className="format-help">
      <p><b>节点</b>：<code>nodes</code> 里列出所有连接点的名字，默认正电源 <code>+KM</code>、负电源 <code>-KM</code>。</p>
      <p><b>元件</b>（<code>components</code>，每个都要有唯一的 <code>id</code>）：</p>
      <ul>
        <li><code>contact_no</code> 常开接点 / <code>contact_nc</code> 常闭接点：<code>between</code> 写两端节点；手动操作的写 <code>"operable": true</code>，跟随继电器或断路器的写 <code>"controlledBy": "K1"</code></li>
        <li><code>relay</code> 继电器、<code>breaker</code> 断路器：本身不在回路上，由线圈驱动</li>
        <li><code>coil</code> 线圈：<code>between</code>、<code>"drives": "K1"</code>、<code>"impedance": "high" | "low"</code>；驱动断路器时加 <code>"action": "close" | "trip"</code>；可选延时 <code>pickupDelayTicks</code> / <code>dropoutDelayTicks</code></li>
        <li><code>lamp</code> 指示灯、<code>resistor</code> 电阻：<code>between</code>，可写 <code>impedance</code></li>
        <li><code>fault_injection</code> 故障点：<code>target</code> 和 <code>kind</code>（<code>open_circuit</code> 断线 / <code>contact_stuck</code> 接点粘连 / <code>coil_burnt</code> 线圈烧毁）</li>
      </ul>
      <p><b>布局</b>（<code>layout</code>）：可以直接在右边的图上拖动来改，不用手写坐标。</p>
      <p><b>演示场景</b>（<code>scenarios</code>）：每一步是 <code>operate</code>（操作接点或故障）、<code>tick</code>（单步）或 <code>run</code>（运行到稳定），<code>explain</code> 写这一步的讲解。</p>
      <p>自己写或改的回路请保留 <code>"reviewStatus": "草稿"</code>，确认无误后再改成 <code>"已审核"</code>。</p>
    </div>
  );
}

function suggestFileName(text: string, existing: string[]): string {
  let id = "new-circuit";
  try { id = String((JSON.parse(text) as { id?: string }).id || id); } catch { /* 用默认名 */ }
  const base = id.replace(/[\\/:*?"<>|]/g, "_");
  let name = `${base}.json`;
  for (let i = 2; existing.includes(name); i++) name = `${base}-${i}.json`;
  return name;
}

/** 去掉 Claude 说明里常见的 Markdown 记号（加粗、行内代码、标题井号），界面上直接显示纯文字 */
function plainText(md: string): string {
  return md.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#+\s*/gm, "");
}
