/**
 * Electron 主进程。
 * 负责：打开 SQLite 数据库并执行迁移、读写设置、提供界面调用的接口（IPC）、创建窗口。
 *
 * 命令行参数：
 *   --smoke-test              无界面自检：打开数据库、写一行读一行，结果写到 --smoke-out 指定的文件后退出
 *   --smoke-out=<文件路径>     自检结果输出位置（默认用户数据目录下 smoke-result.json）
 *   --user-data=<目录>         指定用户数据目录（测试用）
 */
import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { AppDatabase, LATEST_DB_VERSION } from "../src/db/database";
import { BootstrapFile, readAllSettings, writeSetting } from "./settingsStore";
import { getSettingDef, SETTINGS_SCHEMA } from "../src/settings/schema";
import type { AppInfo, Result } from "../src/shared/api";
import * as board from "../src/board/repo";
import type { EntityName } from "../src/board/model";
import { inspectBackup, timestamp } from "../src/db/backup";
import { loadCircuit } from "../src/engine/index";
import { generateCircuit, cancelClaude } from "../src/ai/claudeRunner";
import * as qrepo from "../src/questions/repo";
import { exportQuestions } from "../src/questions/format";

const argv = process.argv;
const argValue = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const isSmoke = argv.includes("--smoke-test");

const userDataOverride = argValue("user-data");
if (userDataOverride) app.setPath("userData", path.resolve(userDataOverride));

let db: AppDatabase | null = null;
let SQL: SqlJsStatic;
let startupError: string | undefined;
let boot: BootstrapFile;
let dbPath = "";
let circuitsDir = "";

function seedDir(): string {
  // 打包后内置示例在 resources/seed；开发时在仓库的 data/seed
  return app.isPackaged ? path.join(process.resourcesPath, "seed") : path.join(app.getAppPath(), "data", "seed");
}

function loadWasm(): Buffer {
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  return fs.readFileSync(wasmPath);
}

/**
 * 把内置草稿回路复制到回路数据目录。
 * 每个内置文件只复制一次（记录在 app_meta），之后用户修改或删除都不会被覆盖或恢复；
 * 新版本程序新增的内置回路会在下次启动时补充复制。
 */
function ensureCircuitsDir(): void {
  fs.mkdirSync(circuitsDir, { recursive: true });
  if (!db) return;
  const row = db.all<{ value: string }>("SELECT value FROM app_meta WHERE key = 'seed.circuits.copied'")[0];
  let copied: string[] = [];
  try { const v = row ? JSON.parse(row.value) : []; if (Array.isArray(v)) copied = v; } catch { /* 旧版本存的是日期，按未复制处理 */ }
  const src = path.join(seedDir(), "circuits");
  if (!fs.existsSync(src)) return;
  let changed = false;
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith(".json") || copied.includes(f)) continue;
    const dest = path.join(circuitsDir, f);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(src, f), dest);
    copied.push(f);
    changed = true;
  }
  if (changed) db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed.circuits.copied', ?)", [JSON.stringify(copied)]);
}

/** 内置示例题：每个文件只导入一次（记录在 app_meta），之后用户修改或删除都不会被覆盖或恢复。 */
function ensureSeedQuestions(): void {
  if (!db) return;
  const src = path.join(seedDir(), "questions");
  if (!fs.existsSync(src)) return;
  const row = db.all<{ value: string }>("SELECT value FROM app_meta WHERE key = 'seed.questions.imported'")[0];
  let done: string[] = [];
  try { const v = row ? JSON.parse(row.value) : []; if (Array.isArray(v)) done = v; } catch { /* 按未导入处理 */ }
  let changed = false;
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith(".json")).sort()) {
    if (done.includes(f)) continue;
    qrepo.applyImport(db, fs.readFileSync(path.join(src, f), "utf8"), false, "builtin");
    done.push(f);
    changed = true;
  }
  if (changed) db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed.questions.imported', ?)", [JSON.stringify(done)]);
}

async function initData(): Promise<void> {
  const userData = app.getPath("userData");
  boot = new BootstrapFile(path.join(userData, "bootstrap.json"));
  dbPath = boot.read().dbPath || path.join(userData, "workbench.db");
  try {
    SQL = await initSqlJs({ wasmBinary: loadWasm() as unknown as ArrayBuffer });
    db = AppDatabase.open(SQL, dbPath);
  } catch (e) {
    startupError = (e as Error).message;
    db = null;
  }
  const settings = readAllSettings(db, boot);
  circuitsDir = (settings["data.circuitsDir"] as string) || path.join(userData, "circuits");
  try {
    ensureCircuitsDir();
  } catch (e) {
    startupError = (startupError ? startupError + "\n" : "") + `回路数据目录不可用：${(e as Error).message}`;
  }
  try {
    ensureSeedQuestions();
  } catch (e) {
    startupError = (startupError ? startupError + "\n" : "") + `内置示例题导入失败：${(e as Error).message}`;
  }
}

function appInfo(): AppInfo {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: `${process.platform}-${process.arch}`,
    userDataDir: app.getPath("userData"),
    dbPath,
    dbVersion: db ? db.version : null,
    latestDbVersion: LATEST_DB_VERSION,
    circuitsDir,
    migrationsApplied: db?.lastMigration?.applied ?? [],
    migrationBackupPath: db?.lastMigration?.backupPath,
    startupError,
  };
}

function needDb(): AppDatabase {
  if (!db) throw new Error(startupError || "数据库未打开");
  return db;
}

/** 把异常转成 { ok: false, error }，界面直接显示中文错误，不带 Electron 的英文前缀。 */
async function wrap<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (_e, ...args) => wrap(() => fn(...args)));
}

function registerIpc(): void {
  ipcMain.handle("app:info", () => appInfo());
  ipcMain.handle("settings:getAll", () => readAllSettings(db, boot));
  ipcMain.handle("settings:set", (_e, key: string, value: unknown) => {
    const def = getSettingDef(key);
    let note: string | undefined;
    // 修改数据库位置：检查目标文件夹可写；目标位置没有数据库时复制当前数据库过去
    if (key === "data.dbPath" && typeof value === "string" && value.trim()) {
      const target = path.resolve(value.trim());
      const dir = path.dirname(target);
      try {
        if (!fs.existsSync(dir)) return { ok: false, error: `文件夹不存在：${dir}` };
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        return { ok: false, error: `没有写入权限：${dir}` };
      }
      if (target !== dbPath) {
        if (fs.existsSync(target)) {
          note = "新位置已有数据库文件，重启后将直接使用它。";
        } else if (db) {
          db.persist();
          fs.copyFileSync(dbPath, target);
          note = "已把当前数据库复制到新位置，重启后生效。";
        }
      }
      value = target;
    }
    const r = writeSetting(db, boot, key, value);
    if (!r.ok) return r;
    return { ...r, restartRequired: !!def?.restartRequired, note };
  });
  ipcMain.handle("db:selfCheck", () => {
    if (!db) throw new Error(startupError || "数据库未打开");
    return db.selfCheck();
  });
  ipcMain.handle("shell:openPath", (_e, p: string) => shell.openPath(p));
  ipcMain.handle("dialog:pickPath", async (e, kind: "file" | "directory", current?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    if (kind === "directory") {
      const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], defaultPath: current || undefined });
      return r.canceled ? null : r.filePaths[0];
    }
    const r = await dialog.showSaveDialog(win, {
      defaultPath: current || "workbench.db",
      filters: [{ name: "SQLite 数据库", extensions: ["db", "sqlite"] }],
    });
    return r.canceled ? null : r.filePath ?? null;
  });
  // ---------------- 项目看板 ----------------
  const ENTITY_NAMES: EntityName[] = ["project", "volume", "task", "issue"];
  const checkEntity = (e: string): EntityName => {
    if (!ENTITY_NAMES.includes(e as EntityName)) throw new Error(`未知的数据类型：${e}`);
    return e as EntityName;
  };
  handle("board:list", (e: string, filter?: board.ListFilter) => board.list(needDb(), checkEntity(e), filter ?? {}));
  handle("board:get", (e: string, id: number) => board.get(needDb(), checkEntity(e), id));
  handle("board:create", (e: string, data: Record<string, unknown>) => board.create(needDb(), checkEntity(e), data));
  handle("board:update", (e: string, id: number, data: Record<string, unknown>) => board.update(needDb(), checkEntity(e), id, data));
  handle("board:deleteImpact", (e: string, id: number) => board.deleteImpact(needDb(), checkEntity(e), id));
  handle("board:remove", (e: string, id: number) => board.remove(needDb(), checkEntity(e), id));
  handle("board:dashboard", (today: string) => board.dashboard(needDb(), today));

  // ---------------- 回路库 ----------------
  const circuitFile = (file: string) => {
    if (!/^[^\\/:*?"<>|]+\.json$/.test(file)) throw new Error(`文件名不合法：${file}`);
    return path.join(circuitsDir, file);
  };
  handle("circuits:list", () => {
    if (!fs.existsSync(circuitsDir)) return [];
    return fs.readdirSync(circuitsDir).filter((f) => f.endsWith(".json")).sort().map((file) => {
      try {
        const { circuit, migratedFrom } = loadCircuit(fs.readFileSync(path.join(circuitsDir, file), "utf8"));
        return { file, id: circuit.id, title: circuit.title, category: circuit.category ?? "未分类", reviewStatus: circuit.reviewStatus ?? "草稿", migratedFrom };
      } catch (e) {
        return { file, error: (e as Error).message };
      }
    });
  });
  handle("circuits:read", (file: string) => fs.readFileSync(circuitFile(file), "utf8"));
  /**
   * 保存回路文件。先校验格式，不合格不写；覆盖已有文件前把旧内容存到“历史版本”子目录。
   * create 为 true 时文件已存在就报错，避免新建时误覆盖。
   */
  handle("circuits:write", (file: string, text: string, create?: boolean) => {
    const dest = circuitFile(file);
    loadCircuit(text);
    const exists = fs.existsSync(dest);
    if (create && exists) throw new Error(`回路文件夹里已经有 ${file}，请换一个文件名`);
    if (exists) {
      const hist = path.join(circuitsDir, "历史版本");
      fs.mkdirSync(hist, { recursive: true });
      fs.copyFileSync(dest, path.join(hist, `${file.replace(/\.json$/, "")}-${timestamp()}.json`));
    }
    const tmp = dest + ".tmp";
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, dest);
    return { file, historyKept: exists };
  });
  const formatDocPath = () => app.isPackaged
    ? path.join(process.resourcesPath, "docs", "回路数据格式.md")
    : path.join(app.getAppPath(), "docs", "回路数据格式.md");
  handle("circuits:openFormatDoc", async () => {
    const doc = formatDocPath();
    if (!fs.existsSync(doc)) throw new Error(`找不到格式说明文件：${doc}`);
    const err = await shell.openPath(doc);
    if (err) throw new Error(`打不开格式说明：${err}`);
    return doc;
  });

  // ---------------- 题库与复习 ----------------
  const reviewSettings = (): qrepo.ReviewSettings => {
    const st = readAllSettings(db, boot);
    return {
      newPerDay: Number(st["review.newPerDay"] ?? 10),
      maxReviewsPerDay: Number(st["review.maxReviewsPerDay"] ?? 100),
      includeDrafts: !!st["review.includeDrafts"],
    };
  };
  handle("q:list", (f?: qrepo.QuestionFilter) => qrepo.listQuestions(needDb(), f ?? {}));
  handle("q:tags", () => qrepo.allTags(needDb()));
  handle("q:create", (data: Record<string, unknown>) => qrepo.createQuestion(needDb(), { ...data, source: "manual" }));
  handle("q:update", (id: number, data: Record<string, unknown>) => qrepo.updateQuestion(needDb(), id, data));
  handle("q:setStatus", (ids: number[], status: "draft" | "reviewed") => qrepo.setReviewStatus(needDb(), ids, status));
  handle("q:delete", (ids: number[]) => qrepo.deleteQuestions(needDb(), ids));
  handle("review:queue", (today: string) => qrepo.todayQueue(needDb(), today, reviewSettings()));
  handle("review:answer", (id: number, response: unknown, grade: number, today: string) => qrepo.answerQuestion(needDb(), id, response, grade, today));
  handle("review:stats", (today: string) => qrepo.reviewStats(needDb(), today, reviewSettings()));
  ipcMain.handle("q:export", async (e, ids?: number[]) => wrap(async () => {
    const all = qrepo.listQuestions(needDb());
    const qs = ids?.length ? all.filter((q) => ids.includes(q.id)) : all;
    if (!qs.length) throw new Error("没有可以导出的题目");
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showSaveDialog(win, {
      title: "导出题目",
      defaultPath: path.join(app.getPath("documents"), `题目导出-${timestamp()}.json`),
      filters: [{ name: "题目 JSON", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, exportQuestions(qs, new Date().toISOString()), "utf8");
    return { path: r.filePath, count: qs.length };
  }));
  ipcMain.handle("q:pickImport", async (e) => wrap(async () => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showOpenDialog(win, {
      title: "选择要导入的题目文件",
      properties: ["openFile"],
      filters: [{ name: "题目 JSON", extensions: ["json"] }, { name: "所有文件", extensions: ["*"] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    try {
      return { path: file, preview: qrepo.previewImport(needDb(), fs.readFileSync(file, "utf8")) };
    } catch (err) {
      return { path: file, error: (err as Error).message };
    }
  }));
  handle("q:import", (file: string, updateExisting: boolean) => qrepo.applyImport(needDb(), fs.readFileSync(file, "utf8"), !!updateExisting));

  // ---------------- 让 Claude 写回路 ----------------
  // 只发送用户在对话框里写的要求，以及用户勾选时的当前这一个回路；Claude Code 的工具全部关闭，不读本机文件。
  let claudeBusy = false;
  ipcMain.handle("claude:generate", async (e, request: string, baseFile?: string) => wrap(async () => {
    const settings = readAllSettings(db, boot);
    if (!settings["claude.enabled"]) throw new Error("“让 Claude 写回路”还没有打开。请到“设置 → Claude 写回路”里打开。");
    if (typeof request !== "string" || !request.trim()) throw new Error("请先写下对回路的要求");
    if (claudeBusy) throw new Error("上一次生成还没有结束");
    claudeBusy = true;
    try {
      const workDir = path.join(app.getPath("userData"), "claude-work");
      fs.mkdirSync(workDir, { recursive: true });
      const base = baseFile ? fs.readFileSync(circuitFile(baseFile), "utf8") : undefined;
      const example = fs.readFileSync(path.join(seedDir(), "circuits", "breaker-control-basic.json"), "utf8");
      return await generateCircuit(
        { request, base, formatDoc: fs.readFileSync(formatDocPath(), "utf8"), example },
        {
          command: String(settings["claude.command"] ?? ""),
          model: String(settings["claude.model"] ?? ""),
          timeoutMs: (Number(settings["claude.timeoutSec"]) || 300) * 1000,
          cwd: workDir,
        },
        (text) => { if (!e.sender.isDestroyed()) e.sender.send("claude:progress", text); },
      );
    } finally {
      claudeBusy = false;
    }
  }));
  ipcMain.handle("claude:cancel", () => { cancelClaude(); });

  // ---------------- 备份 / 恢复 ----------------
  ipcMain.handle("data:backup", async (e) => wrap(async () => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showSaveDialog(win, {
      title: "备份数据库",
      defaultPath: path.join(app.getPath("documents"), `二次设计工作台备份-${timestamp()}.db`),
      filters: [{ name: "SQLite 数据库", extensions: ["db"] }],
    });
    if (r.canceled || !r.filePath) return null;
    needDb().persist();
    fs.copyFileSync(dbPath, r.filePath);
    const check = inspectBackup(SQL, r.filePath);
    if (!check.ok) throw new Error(`备份文件校验失败：${check.error}`);
    return { path: r.filePath, summary: check.summary };
  }));
  ipcMain.handle("data:pickRestore", async (e) => wrap(async () => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showOpenDialog(win, {
      title: "选择要恢复的备份文件",
      properties: ["openFile"],
      filters: [{ name: "SQLite 数据库", extensions: ["db", "sqlite"] }, { name: "所有文件", extensions: ["*"] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], check: inspectBackup(SQL, r.filePaths[0]) };
  }));
  handle("data:restore", (source: string) => {
    const check = inspectBackup(SQL, source);
    if (!check.ok) throw new Error(check.error);
    // 恢复前先把当前数据库自动备份一份，万一选错了还能找回来
    const autoDir = path.join(app.getPath("userData"), "backups");
    fs.mkdirSync(autoDir, { recursive: true });
    const safety = path.join(autoDir, `恢复前自动备份-${timestamp()}.db`);
    if (db) { db.persist(); db.close(); db = null; }
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, safety);
    fs.copyFileSync(source, dbPath);
    try {
      db = AppDatabase.open(SQL, dbPath);
    } catch (err) {
      // 打开失败就换回原来的数据库
      fs.copyFileSync(safety, dbPath);
      db = AppDatabase.open(SQL, dbPath);
      throw err;
    }
    startupError = undefined;
    return { safetyBackup: safety, summary: check.summary };
  });

  ipcMain.handle("app:relaunch", () => {
    app.relaunch();
    app.exit(0);
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "二次设计工作台",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  // 外部链接用系统浏览器打开，不在程序里跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

async function runSmoke(): Promise<void> {
  const out = argValue("smoke-out") || path.join(app.getPath("userData"), "smoke-result.json");
  let result: Record<string, unknown>;
  let code = 0;
  try {
    await initData();
    if (!db) throw new Error(startupError || "数据库未打开");
    const check = db.selfCheck("smoke-test");
    // 自检输出里不写入密钥类设置的值
    const settings = readAllSettings(db, boot);
    for (const d of SETTINGS_SCHEMA) if (d.type === "secret") settings[d.key] = settings[d.key] ? "（已设置，已隐藏）" : "";
    result = { ...appInfo(), selfCheck: check, settings };
    if (!check.ok) code = 1;
  } catch (e) {
    result = { ok: false, error: (e as Error).message };
    code = 1;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2), "utf8");
  process.stdout.write(JSON.stringify(result) + "\n");
  app.exit(code);
}

if (isSmoke) {
  app.whenReady().then(runSmoke);
} else {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
    });
    app.whenReady().then(async () => {
      await initData();
      registerIpc();
      createWindow();
    });
    app.on("window-all-closed", () => app.quit());
  }
}
