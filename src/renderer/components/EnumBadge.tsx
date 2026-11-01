import { enumLabel, type EnumKey } from "../../board/enums";

export function EnumBadge({ k, v }: { k: EnumKey; v: unknown }) {
  if (v == null || v === "") return null;
  return <span className={`badge ${k}-${String(v)}`}>{enumLabel(k, String(v))}</span>;
}
