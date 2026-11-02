import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCircuitPrompt, checkGeneratedCircuit, extractCircuitJson } from "../circuitPrompt";
import { generateCircuit, askClaude, commandLine } from "../claudeRunner";

const seedText = (f: string) => fs.readFileSync(path.join("data/seed/circuits", f), "utf8");
const fake = path.resolve("src/ai/__tests__/fake-claude.cjs");
const workDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "claude-test-"));
const opts = (cwd: string) => ({ command: process.execPath, prefixArgs: [fake], timeoutMs: 20000, cwd });

describe("提示词与结果解析", () => {
  it("提示词包含要求、格式说明、规则；勾选时包含当前回路；修正时包含上次的问题", () => {
    const p = buildCircuitPrompt({ request: "加弹簧未储能闭锁", formatDoc: "格式说明正文", example: "{}", base: '{"id":"x"}', previous: { text: "{}", errors: ["缺少 HQ 布局"] } });
    for (const s of ["加弹簧未储能闭锁", "格式说明正文", "\"草稿\"", "TODO(待沈确认)", "不写具体厂家型号", '{"id":"x"}', "缺少 HQ 布局"]) expect(p).toContain(s);
    expect(buildCircuitPrompt({ request: "r", formatDoc: "f", example: "{}" })).not.toContain("现有回路的基础上");
  });

  it("取出最后一个 json 代码块和前面的说明；没有代码块时取大括号", () => {
    expect(extractCircuitJson("说明\n```json\n{\"a\":1}\n```\n后记")).toEqual({ json: '{"a":1}', notes: "说明" });
    expect(extractCircuitJson("```json\n{1}\n```\n再改：\n```json\n{2}\n```").json).toBe("{2}");
    expect(extractCircuitJson("好的 {\"a\":1}").json).toBe('{"a":1}');
    expect(extractCircuitJson("没有文件").json).toBeNull();
  });
});

describe("生成结果检查", () => {
  it("内置草稿回路都能通过检查，审核状态强制为草稿", () => {
    for (const f of fs.readdirSync("data/seed/circuits")) {
      const raw = JSON.parse(seedText(f));
      raw.reviewStatus = "已审核";
      const r = checkGeneratedCircuit(JSON.stringify(raw));
      expect(r.errors, f).toEqual([]);
      expect(JSON.parse(r.text!).reviewStatus).toBe("草稿");
    }
  });

  it("能查出缺布局、坐标重叠、没有场景、缺讲解、格式错误", () => {
    const c = JSON.parse(seedText("breaker-control-basic.json"));
    delete c.layout.HQ;
    c.layout.TQ = { ...c.layout.SA_close };
    c.scenarios[0].steps[0].explain = "";
    const r = checkGeneratedCircuit(JSON.stringify(c));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/HQ：layout 里缺少坐标/);
    expect(r.errors.join("\n")).toMatch(/坐标相同/);
    expect(r.errors.join("\n")).toMatch(/缺少 explain/);
    delete c.scenarios;
    expect(checkGeneratedCircuit(JSON.stringify(c)).errors).toContain("没有演示场景（scenarios）");
    expect(checkGeneratedCircuit("{不是json").errors[0]).toMatch(/不是合法的 JSON/);
    const bad = JSON.parse(seedText("breaker-control-basic.json"));
    bad.components[0].type = "unknown";
    expect(checkGeneratedCircuit(JSON.stringify(bad)).errors.join()).toMatch(/未知的元件类型/);
  });
});

describe("调用 Claude Code（用假命令测试）", () => {
  it("命令行参数里不含用户内容，工具全部关闭", () => {
    const { args } = commandLine({ command: "", timeoutMs: 1, cwd: "." });
    expect(args).toEqual(["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--no-session-persistence"]);
  });

  it("一次通过：返回规范化的回路和说明，提示词从标准输入传入", async () => {
    const dir = workDir();
    process.env.FAKE_MODE = "ok";
    const steps: string[] = [];
    const r = await generateCircuit({ request: "我的要求ABC", formatDoc: "f", example: "{}" }, opts(dir), (t) => steps.push(t));
    expect(r.errors).toEqual([]);
    expect(r.attempts).toBe(1);
    expect(r.notes).toContain("TODO(待沈确认)");
    expect(JSON.parse(r.text!).reviewStatus).toBe("草稿");
    expect(fs.readFileSync(path.join(dir, "prompt-1.txt"), "utf8")).toContain("我的要求ABC");
    expect(fs.readFileSync(path.join(dir, "args-1.txt"), "utf8")).not.toContain("我的要求ABC");
    expect(steps[0]).toContain("正在编写");
  });

  it("第一次有问题时把问题发回去，第二次通过", async () => {
    const dir = workDir();
    process.env.FAKE_MODE = "fix";
    const r = await generateCircuit({ request: "r", formatDoc: "f", example: "{}" }, opts(dir), () => {});
    expect(r.attempts).toBe(2);
    expect(r.errors).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "prompt-2.txt"), "utf8")).toContain("HQ：layout 里缺少坐标");
  });

  it("没登录等错误：给出中文提示和原始信息", async () => {
    process.env.FAKE_MODE = "error";
    await expect(askClaude("x", opts(workDir()))).rejects.toThrow(/Not logged in[\s\S]*登录/);
  });

  it("找不到命令：提示安装或在设置里选择路径", async () => {
    await expect(askClaude("x", { command: "/不存在/claude", timeoutMs: 5000, cwd: workDir() })).rejects.toThrow(/找不到 Claude Code 命令/);
  });

  it("超时会停止并提示", async () => {
    process.env.FAKE_MODE = "hang";
    await expect(askClaude("x", { ...opts(workDir()), timeoutMs: 1500 })).rejects.toThrow(/超过 2 秒还没有完成/);
  });
});
