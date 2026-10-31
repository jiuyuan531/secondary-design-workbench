import type { WorkbenchApi } from "../shared/api";
declare global {
  interface Window {
    api: WorkbenchApi;
  }
}
export {};
