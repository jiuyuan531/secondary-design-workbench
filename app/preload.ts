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
  data: {
    backup: () => ipcRenderer.invoke("data:backup"),
    pickRestore: () => ipcRenderer.invoke("data:pickRestore"),
    restore: (src) => ipcRenderer.invoke("data:restore", src),
  },
};

contextBridge.exposeInMainWorld("api", api);
