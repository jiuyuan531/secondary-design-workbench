/** 主进程与界面之间的接口类型（preload 暴露为 window.api）。 */
import type { SettingValue } from "../settings/schema";
import type { EntityName, Row } from "../board/model";
import type { Dashboard, ListFilter } from "../board/repo";
import type { BackupCheck } from "../db/backup";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

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

  board: {
    list(entity: EntityName, filter?: ListFilter): Promise<Result<Row[]>>;
    get(entity: EntityName, id: number): Promise<Result<Row>>;
    create(entity: EntityName, data: Record<string, unknown>): Promise<Result<Row>>;
    update(entity: EntityName, id: number, data: Record<string, unknown>): Promise<Result<Row>>;
    deleteImpact(entity: EntityName, id: number): Promise<Result<string[]>>;
    remove(entity: EntityName, id: number): Promise<Result<void>>;
    dashboard(today: string): Promise<Result<Dashboard>>;
  };

  data: {
    backup(): Promise<Result<{ path: string; summary?: string } | null>>;
    pickRestore(): Promise<Result<{ path: string; check: BackupCheck } | null>>;
    restore(source: string): Promise<Result<{ safetyBackup: string; summary?: string }>>;
  };
}
