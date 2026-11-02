/**
 * 在后台调用本机的 Claude Code（命令行 claude -p）。只在主进程使用。
 *
 * - 提示词通过标准输入传入，命令行参数里不放任何用户内容；
 * - 关闭 Claude Code 的全部工具（--tools ""）、不加载 MCP 服务器、不保存会话，
 *   所以它不会读写本机文件，只根据提示词回答；
 * - 生成后由程序检查格式和仿真，有问题就把问题发回去让它修正，最多 maxAttempts 次。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { buildCircuitPrompt, checkGeneratedCircuit, extractCircuitJson, type PromptInput } from "./circuitPrompt";

export interface RunnerOptions {
  /** 命令或可执行文件路径，空字符串表示 "claude" */
  command: string;
  model?: string;
  timeoutMs: number;
  /** 运行目录（放一个空目录即可） */
  cwd: string;
  /** 测试用：命令前面额外的参数（比如用 node 运行一个假的 claude 脚本） */
  prefixArgs?: string[];
}

export interface ClaudeAnswer {
  text: string;
  costUsd?: number;
}

export class ClaudeError extends Error {}

/** 正在运行的子进程，用于取消 */
let current: ChildProcess | null = null;
let cancelled = false;

export function cancelClaude(): void {
  cancelled = true;
  killTree(current);
}

function killTree(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    // 经 cmd 启动时要连子进程一起结束
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

/** 拼命令行参数。Windows 上 .cmd / 没写扩展名的命令要经 cmd 启动，空参数要写成 "" 才能传过去。 */
export function commandLine(opts: RunnerOptions): { file: string; args: string[]; shell: boolean } {
  const cmd = opts.command.trim() || "claude";
  const shell = process.platform === "win32" && !/\.exe$/i.test(cmd);
  const empty = shell ? '""' : "";
  const args = [...(opts.prefixArgs ?? []), "-p", "--output-format", "json", "--tools", empty, "--strict-mcp-config", "--no-session-persistence"];
  if (opts.model?.trim()) args.push("--model", opts.model.trim());
  const file = shell && /\s/.test(cmd) && !cmd.startsWith('"') ? `"${cmd}"` : cmd;
  return { file, args, shell };
}

/** 调用一次 Claude Code，返回它的回答文本。 */
export function askClaude(prompt: string, opts: RunnerOptions): Promise<ClaudeAnswer> {
  return new Promise((resolve, reject) => {
    const { file, args, shell } = commandLine(opts);
    // 写的是路径时先检查文件在不在：中文 Windows 的 cmd 报错是 GBK 编码，按 UTF-8 读出来是乱码，没法靠报错文字判断
    const cmd = opts.command.trim();
    if (/[\\/]/.test(cmd) && !fs.existsSync(cmd.replace(/^"|"$/g, ""))) {
      reject(new ClaudeError(notFound(opts, `文件不存在：${cmd}`)));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(file, args, { cwd: opts.cwd, shell, windowsHide: true, env: process.env });
    } catch (e) {
      reject(new ClaudeError(notFound(opts, (e as Error).message)));
      return;
    }
    current = child;
    let out = "", err = "", settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); current = null; fn(); };
    const timer = setTimeout(() => {
      killTree(child);
      done(() => reject(new ClaudeError(`Claude Code 超过 ${Math.round(opts.timeoutMs / 1000)} 秒还没有完成，已停止。可以在“设置 → Claude 写回路”里把超时调大。`)));
    }, opts.timeoutMs);
    child.stdout!.setEncoding("utf8").on("data", (d: string) => { out += d; });
    child.stderr!.setEncoding("utf8").on("data", (d: string) => { err += d; });
    child.on("error", (e: NodeJS.ErrnoException) => done(() => reject(new ClaudeError(e.code === "ENOENT" ? notFound(opts, e.message) : `启动 Claude Code 失败：${e.message}`))));
    child.on("close", (code) => done(() => {
      if (cancelled) { reject(new ClaudeError("已取消")); return; }
      let parsed: { result?: string; is_error?: boolean; total_cost_usd?: number } | null = null;
      try { parsed = JSON.parse(out.trim().split("\n").filter(Boolean).pop() ?? ""); } catch { /* 下面按出错处理 */ }
      if (parsed && typeof parsed.result === "string" && !parsed.is_error && code === 0) {
        resolve({ text: parsed.result, costUsd: parsed.total_cost_usd });
        return;
      }
      const msg = (parsed?.result || err || out).trim().slice(0, 1500);
      // Windows 的 cmd 找不到命令时退出码是 9009；路径写错时是 1，并提示“系统找不到指定的路径”
      if (code === 9009 || /is not recognized|不是内部或外部命令|command not found|cannot find the (path|file) specified|系统找不到指定的(路径|文件)/i.test(msg)) { reject(new ClaudeError(notFound(opts, msg))); return; }
      reject(new ClaudeError(`Claude Code 运行出错（退出码 ${code}）：\n${msg || "没有输出"}\n\n如果提示没有登录，请先在命令行运行一次 claude 完成登录。`));
    }));
    child.stdin!.on("error", () => { /* 进程提前退出时写入会失败，以退出结果为准 */ });
    child.stdin!.end(prompt, "utf8");
  });
}

function notFound(opts: RunnerOptions, detail: string): string {
  return `找不到 Claude Code 命令“${opts.command.trim() || "claude"}”。请确认本机已经安装 Claude Code，并且在命令行里能运行 claude；如果能运行但程序找不到，请在“设置 → Claude 写回路 → Claude Code 命令”里选择 claude.exe 或 claude.cmd 的位置。\n（${detail.slice(0, 300)}）`;
}

export interface GenerateResult {
  /** 检查通过（或最后一次）的回路文本 */
  text: string | null;
  /** Claude 在代码块前写的说明 */
  notes: string;
  /** 最后一次检查仍有的问题；空数组表示全部通过 */
  errors: string[];
  attempts: number;
  costUsd: number;
}

/** 生成回路：调用 Claude，检查结果，不通过就带着问题让它重写，最多 maxAttempts 次。 */
export async function generateCircuit(
  input: Omit<PromptInput, "previous">,
  opts: RunnerOptions,
  onProgress: (text: string) => void,
  maxAttempts = 3,
): Promise<GenerateResult> {
  cancelled = false;
  let previous: PromptInput["previous"];
  let last: GenerateResult = { text: null, notes: "", errors: [], attempts: 0, costUsd: 0 };
  for (let i = 1; i <= maxAttempts; i++) {
    onProgress(i === 1 ? "Claude 正在编写回路……" : `检查发现 ${previous!.errors.length} 处问题，让 Claude 修改（第 ${i} 次）……`);
    const ans = await askClaude(buildCircuitPrompt({ ...input, previous }), opts);
    const { json, notes } = extractCircuitJson(ans.text);
    last = { ...last, attempts: i, costUsd: last.costUsd + (ans.costUsd ?? 0), notes: notes || last.notes };
    if (!json) {
      previous = { text: ans.text.slice(0, 4000), errors: ["回答里没有找到 ```json 代码块"] };
      last.errors = previous.errors;
      continue;
    }
    onProgress("正在检查格式并试运行演示场景……");
    const check = checkGeneratedCircuit(json);
    last.text = check.text ?? json;
    last.errors = check.errors;
    if (check.ok) return last;
    previous = { text: last.text, errors: check.errors };
  }
  return last;
}
