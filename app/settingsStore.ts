/** 设置读写：合并默认值、数据库中的值、bootstrap.json 中的值，并做校验。 */
import fs from "node:fs";
import path from "node:path";
import { SETTINGS_SCHEMA, getSettingDef, validateSetting, type SettingValue } from "../src/settings/schema";
import type { AppDatabase } from "../src/db/database";

export interface Bootstrap {
  schemaVersion: 1;
  dbPath?: string;
}

export class BootstrapFile {
  constructor(readonly filePath: string) {}

  read(): Bootstrap {
    try {
      const j = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return { schemaVersion: 1, ...j };
    } catch {
      return { schemaVersion: 1 };
    }
  }

  write(b: Bootstrap): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(b, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }
}

const BOOTSTRAP_KEYS: Record<string, keyof Bootstrap> = { "data.dbPath": "dbPath" };

export function readAllSettings(db: AppDatabase | null, boot: BootstrapFile): Record<string, SettingValue> {
  const stored = db ? db.getAllSettings() : {};
  const b = boot.read();
  const out: Record<string, SettingValue> = {};
  for (const def of SETTINGS_SCHEMA) {
    const raw = def.storage === "bootstrap" ? b[BOOTSTRAP_KEYS[def.key]] : stored[def.key];
    const v = raw === undefined ? undefined : validateSetting(def, raw);
    out[def.key] = v && v.ok ? v.value : def.default;
  }
  return out;
}

export function writeSetting(
  db: AppDatabase | null,
  boot: BootstrapFile,
  key: string,
  raw: unknown,
): { ok: true; value: SettingValue } | { ok: false; error: string } {
  const def = getSettingDef(key);
  if (!def) return { ok: false, error: `未知的设置项：${key}` };
  const v = validateSetting(def, raw);
  if (!v.ok) return v;
  if (def.storage === "bootstrap") {
    const b = boot.read();
    (b as unknown as Record<string, unknown>)[BOOTSTRAP_KEYS[key]] = v.value === "" ? undefined : v.value;
    boot.write(b);
  } else {
    if (!db) return { ok: false, error: "数据库未打开，无法保存设置" };
    db.setSetting(key, v.value);
  }
  return v;
}
