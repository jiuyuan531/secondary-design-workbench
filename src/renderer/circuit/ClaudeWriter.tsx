import { useEffect, useRef, useState } from "react";
import type { ClaudeGenerateResult } from "../../shared/api";
import { Modal } from "../components/Modal";
import { call } from "../lib";

/**
 * “让 Claude 写回路”对话框：写要求 → 后台调用本机 Claude Code → 结果交给编辑器审核。
 */
export function ClaudeWriter({ enabled, currentFile, currentTitle, onClose, onResult, onOpenSettings }: {
  enabled: boolean;
  currentFile: string | null;
  currentTitle?: string;
  onClose: () => void;
  /** 生成完成：把结果交给编辑器；baseFile 不为空表示是在该回路基础上修改 */
  onResult: (r: ClaudeGenerateResult, baseFile: string | null) => void;
  onOpenSettings: () => void;
}) {
  const [request, setRequest] = useState("");
  const [useBase, setUseBase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const off = window.api.claude.onProgress((t) => setProgress((p) => [...p, t]));
    return () => { alive.current = false; off(); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  const start = async () => {
    setError(null);
    setProgress([]);
    setBusy(true);
    setStartedAt(Date.now());
    setNow(Date.now());
    const base = useBase && currentFile ? currentFile : null;
    try {
      const r = await call(window.api.claude.generate(request, base ?? undefined));
      if (!alive.current) return;
      if (!r.text) { setError(`Claude 没有给出回路文件。${r.notes ? `\n它的回答：${r.notes}` : ""}`); return; }
      onResult(r, base);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const close = () => {
    if (busy) window.api.claude.cancel();
    onClose();
  };

  if (!enabled) {
    return (
      <Modal title="让 Claude 写回路" onClose={onClose}>
        <p>这个功能会在后台调用你电脑上的 Claude Code，根据你写的要求生成回路文件，生成后在编辑器里给你审核。</p>
        <p>使用前需要：</p>
        <ol>
          <li>本机安装 Claude Code，并在命令行里运行一次 <code>claude</code> 完成登录；</li>
          <li>到“设置 → Claude 写回路”里打开开关。</li>
        </ol>
        <p className="muted small">只会发送你在对话框里写的文字（勾选时再加上当前这一个回路），不会读取其他文件。</p>
        <div className="modal-actions">
          <button onClick={onClose}>关闭</button>
          <button className="primary" onClick={onOpenSettings}>去设置</button>
        </div>
      </Modal>
    );
  }

  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <Modal title="让 Claude 写回路" onClose={close} wide>
      <label className="field">
        <span>对回路的要求</span>
        <textarea className="claude-request" rows={7} value={request} onChange={(e) => setRequest(e.target.value)} disabled={busy}
          placeholder={"用文字描述要什么回路、要演示什么，越具体越好。例如：\n断路器控制回路，带弹簧未储能闭锁合闸：弹簧未储能时合闸回路断开，并点亮“弹簧未储能”信号灯。演示场景：储能完成后手合；未储能时手合不动作。"} />
      </label>
      {currentFile && (
        <label className="switch">
          <input type="checkbox" checked={useBase} onChange={(e) => setUseBase(e.target.checked)} disabled={busy} />
          在当前回路“{currentTitle ?? currentFile}”的基础上修改
        </label>
      )}
      <p className="muted small">
        只发送上面这段文字{useBase ? "和当前这一个回路" : ""}，不读取其他文件。生成的回路一律标为“草稿”，拿不准的地方会写“TODO(待沈确认)”。
        程序会自动检查格式、试运行演示场景，有问题让 Claude 自己改，最多 3 次。一般需要一到几分钟。
      </p>
      {busy && (
        <div className="claude-progress">
          {progress.map((p, i) => <div key={i} className={i === progress.length - 1 ? "current" : "done"}>{p}</div>)}
          <div className="muted small">已用时 {Math.floor(secs / 60)} 分 {secs % 60} 秒</div>
        </div>
      )}
      {error && <div className="banner error"><pre>{error}</pre></div>}
      <div className="modal-actions">
        <button onClick={close}>{busy ? "取消" : "关闭"}</button>
        <button className="primary" onClick={start} disabled={busy || !request.trim()}>{busy ? "生成中…" : "开始生成"}</button>
      </div>
    </Modal>
  );
}
