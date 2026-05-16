import type { AriaApi } from '../shared/ipc-contract';

declare global {
  interface Window {
    aria: AriaApi;
  }
}

export {};
