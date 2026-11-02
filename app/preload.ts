import { contextBridge, ipcRenderer } from "electron";
import type { WorkbenchApi } from "../src/shared/api";

const api: WorkbenchApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  getSettings: () => ipcRenderer.invoke("settings:getAll"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  selfCheck: () => ipcRenderer.invoke("db:selfCheck"),
  openPath: (p) => ipcRenderer.invoke("shell:openPath", p),
  pickPath: (kind, current) => ipcRenderer.invoke("dialog:pickPath", kind, current),
  relaunch: () => ipcRenderer.invoke("app:relaunch"),
  board: {
    list: (e, f) => ipcRenderer.invoke("board:list", e, f),
    get: (e, id) => ipcRenderer.invoke("board:get", e, id),
    create: (e, d) => ipcRenderer.invoke("board:create", e, d),
    update: (e, id, d) => ipcRenderer.invoke("board:update", e, id, d),
    deleteImpact: (e, id) => ipcRenderer.invoke("board:deleteImpact", e, id),
    remove: (e, id) => ipcRenderer.invoke("board:remove", e, id),
    dashboard: (today) => ipcRenderer.invoke("board:dashboard", today),
  },
  circuits: {
    list: () => ipcRenderer.invoke("circuits:list"),
    read: (file) => ipcRenderer.invoke("circuits:read", file),
    write: (file, text, create) => ipcRenderer.invoke("circuits:write", file, text, create),
    openFormatDoc: () => ipcRenderer.invoke("circuits:openFormatDoc"),
  },
  questions: {
    list: (f) => ipcRenderer.invoke("q:list", f),
    tags: () => ipcRenderer.invoke("q:tags"),
    create: (d) => ipcRenderer.invoke("q:create", d),
    update: (id, d) => ipcRenderer.invoke("q:update", id, d),
    setStatus: (ids, st) => ipcRenderer.invoke("q:setStatus", ids, st),
    remove: (ids) => ipcRenderer.invoke("q:delete", ids),
    exportFile: (ids) => ipcRenderer.invoke("q:export", ids),
    pickImport: () => ipcRenderer.invoke("q:pickImport"),
    importFile: (p, u) => ipcRenderer.invoke("q:import", p, u),
  },
  review: {
    queue: (today) => ipcRenderer.invoke("review:queue", today),
    answer: (id, resp, grade, today) => ipcRenderer.invoke("review:answer", id, resp, grade, today),
    stats: (today) => ipcRenderer.invoke("review:stats", today),
  },
  claude: {
    generate: (request, baseFile) => ipcRenderer.invoke("claude:generate", request, baseFile),
    cancel: () => ipcRenderer.invoke("claude:cancel"),
    onProgress: (cb) => {
      const fn = (_e: unknown, text: string) => cb(text);
      ipcRenderer.on("claude:progress", fn);
      return () => { ipcRenderer.removeListener("claude:progress", fn); };
    },
  },
  data: {
    backup: () => ipcRenderer.invoke("data:backup"),
    pickRestore: () => ipcRenderer.invoke("data:pickRestore"),
    restore: (src) => ipcRenderer.invoke("data:restore", src),
  },
};

contextBridge.exposeInMainWorld("api", api);
