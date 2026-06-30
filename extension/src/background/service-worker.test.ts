// The MV3 service worker: opens the side panel on the toolbar icon and seeds a
// default apiBase on install. Provide a chrome mock, import the worker (which
// runs its top-level registration), then drive the captured onInstalled handler.

import { describe, it, expect, vi, beforeEach } from "vitest";

let installListeners: Array<() => Promise<void> | void>;
let storage: Record<string, unknown>;
let setSpy: ReturnType<typeof vi.fn>;
let setPanelBehavior: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  installListeners = [];
  storage = {};
  setSpy = vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch));
  setPanelBehavior = vi.fn(() => Promise.resolve());
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { onInstalled: { addListener: (fn: () => void) => installListeners.push(fn) } },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: setSpy,
      },
    },
    sidePanel: { setPanelBehavior },
  };
});

describe("service worker", () => {
  it("opens the side panel on action click and registers an install listener", async () => {
    await import("./service-worker.js");
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
    expect(installListeners).toHaveLength(1);
  });

  it("seeds a default apiBase on install when none is set", async () => {
    await import("./service-worker.js");
    await installListeners[0]();
    expect(setSpy).toHaveBeenCalledWith({ apiBase: "http://localhost:8787" });
  });

  it("does not overwrite an existing apiBase", async () => {
    storage.apiBase = "https://api.example.com";
    await import("./service-worker.js");
    await installListeners[0]();
    expect(setSpy).not.toHaveBeenCalled();
  });
});
