/** 主进程与界面之间的接口类型（preload 暴露为 window.api）。 */
import type { SettingValue } from "../settings/schema";

export interface AppInfo {
  appVersion: string;
  electronVersion: string;
  platform: string;
  userDataDir: string;
  dbPath: string;
  dbVersion: number | null;
  latestDbVersion: number;
  circuitsDir: string;
  /** 本次启动执行的迁移说明 */
  migrationsApplied: string[];
  migrationBackupPath?: string;
  /** 启动时数据库打开失败的原因（中文），为空表示正常 */
  startupError?: string;
}

export interface SelfCheckResult {
  ok: boolean;
  totalRows: number;
  lastId: number;
  at: string;
}

export type SetSettingResult =
  | { ok: true; value: SettingValue; restartRequired: boolean; note?: string }
  | { ok: false; error: string };

export interface WorkbenchApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Record<string, SettingValue>>;
  setSetting(key: string, value: unknown): Promise<SetSettingResult>;
  selfCheck(): Promise<SelfCheckResult>;
  openPath(p: string): Promise<string>;
  pickPath(kind: "file" | "directory", current?: string): Promise<string | null>;
  relaunch(): Promise<void>;
}
