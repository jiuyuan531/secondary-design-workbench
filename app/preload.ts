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
};

contextBridge.exposeInMainWorld("api", api);
