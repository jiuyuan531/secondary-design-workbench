import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA, validateSetting, visibleSettings, getSettingDef } from "../schema";

describe("设置项 schema", () => {
  it("每一项都有完整的中文说明", () => {
    for (const d of SETTINGS_SCHEMA) {
      for (const f of ["label", "description", "howToFill", "ifWrong", "group"] as const) {
        expect(d[f], `${d.key}.${f}`).toBeTruthy();
      }
    }
  });

  it("key 不重复", () => {
    const keys = SETTINGS_SCHEMA.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("默认值自身能通过校验", () => {
    for (const d of SETTINGS_SCHEMA) {
      expect(validateSetting(d, d.default).ok, d.key).toBe(true);
    }
  });

  it("第一阶段隐藏第二阶段设置项", () => {
    const v = visibleSettings(1);
    expect(v.some((d) => d.key.startsWith("ai."))).toBe(false);
    expect(v.some((d) => d.key === "sim.maxTicks")).toBe(true);
  });

  it("数字校验：范围、整数、非数字", () => {
    const d = getSettingDef("sim.maxTicks")!;
    expect(validateSetting(d, "250")).toEqual({ ok: true, value: 250 });
    expect(validateSetting(d, "abc").ok).toBe(false);
    expect(validateSetting(d, "").ok).toBe(false);
    expect(validateSetting(d, 1.5).ok).toBe(false);
    expect(validateSetting(d, 1).ok).toBe(false);
  });
});
