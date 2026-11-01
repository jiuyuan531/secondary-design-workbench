import { useCallback, useEffect, useState } from "react";
import type { EntityName, Row } from "../board/model";
import type { ListFilter } from "../board/repo";
import { call } from "./lib";

export function useList(entity: EntityName, filter: ListFilter = {}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filter);
  const reload = useCallback(() => {
    call(window.api.board.list(entity, JSON.parse(key)))
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError((e as Error).message));
  }, [entity, key]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, error, reload };
}
