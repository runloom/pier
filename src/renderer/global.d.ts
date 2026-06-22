/// <reference types="vite/client" />

declare module "*.css";

import type { PierWindowAPI } from "../preload/index.ts";

declare global {
  interface Window {
    pier: PierWindowAPI;
  }
}
