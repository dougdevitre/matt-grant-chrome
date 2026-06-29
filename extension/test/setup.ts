// jsdom test setup for the extension project.
//  - registers jest-dom matchers (toBeInTheDocument, etc.) on vitest's expect
//  - stubs the chrome.* API surface so modules that touch it under jsdom don't
//    throw. Individual tests can override any of these with vi.fn().

import "@testing-library/jest-dom/vitest";

const chromeStub = {
  runtime: {
    sendMessage: () => Promise.resolve(undefined),
    onMessage: { addListener: () => {}, removeListener: () => {} },
    getURL: (p: string) => p,
    id: "test-extension",
    lastError: undefined,
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
