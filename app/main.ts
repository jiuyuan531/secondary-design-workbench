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
import initSqlJs from "sql.js";
import { AppDatabase, LATEST_DB_VERSION } from "../src/db/database";
import { BootstrapFile, readAllSettings, writeSetting } from "./settingsStore";
import { getSettingDef, SETTINGS_SCHEMA } from "../src/settings/schema";
import type { AppInfo } from "../src/shared/api";

const argv = process.argv;
const argValue = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const isSmoke = argv.includes("--smoke-test");

const userDataOverride = argValue("user-data");
if (userDataOverride) app.setPath("userData", path.resolve(userDataOverride));

let db: AppDatabase | null = null;
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

/** 首次启动时把内置草稿回路复制到回路数据目录；之后不再覆盖用户文件。 */
function ensureCircuitsDir(): void {
  fs.mkdirSync(circuitsDir, { recursive: true });
  if (!db) return;
  const done = db.all<{ value: string }>("SELECT value FROM app_meta WHERE key = 'seed.circuits.copied'");
  if (done.length) return;
  const src = path.join(seedDir(), "circuits");
  if (fs.existsSync(src)) {
    for (const f of fs.readdirSync(src)) {
      if (!f.endsWith(".json")) continue;
      const dest = path.join(circuitsDir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(src, f), dest);
    }
  }
  db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed.circuits.copied', ?)", [new Date().toISOString()]);
}

async function initData(): Promise<void> {
  const userData = app.getPath("userData");
  boot = new BootstrapFile(path.join(userData, "bootstrap.json"));
  dbPath = boot.read().dbPath || path.join(userData, "workbench.db");
  try {
    const SQL = await initSqlJs({ wasmBinary: loadWasm() as unknown as ArrayBuffer });
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
