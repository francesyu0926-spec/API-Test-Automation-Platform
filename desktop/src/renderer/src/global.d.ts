import type { AtpApi } from "../../../preload/index";

declare global {
  interface Window {
    atp: AtpApi;
  }
}

export {};