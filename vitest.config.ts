// Vitest config: two projects with different environments.
//   service   — Node backend (Express), runs in the `node` environment.
//   extension — React side panel, runs in `jsdom` with testing-library.
//
// vitest 4 removed `defineWorkspace`/`vitest.workspace.ts`; projects now live
// under `test.projects` here.
//
// Both workspaces are ESM and use NodeNext-style `.js` import specifiers that
// actually point at `.ts` sources (e.g. `import { x } from "./config.js"`).
// Vite does not resolve `.js`→`.ts` on its own, so a small `enforce: "pre"`
// resolver plugin rewrites relative `.js` specifiers to the sibling `.ts` file
// when one exists. This keeps the production import style untouched.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

function jsToTsResolver() {
  return {
    name: "js-to-ts-resolver",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (!importer) return null;
      if (!source.startsWith("./") && !source.startsWith("../")) return null;
      if (!source.endsWith(".js")) return null;
      const candidate = path.resolve(
        path.dirname(importer),
        source.slice(0, -3) + ".ts"
      );
      return fs.existsSync(candidate) ? candidate : null;
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [jsToTsResolver()],
        test: {
          name: "service",
          environment: "node",
          globals: true,
          include: ["service/src/**/*.test.ts"],
        },
      },
      {
        plugins: [jsToTsResolver(), react()],
        test: {
          name: "extension",
          environment: "jsdom",
          globals: true,
          include: ["extension/src/**/*.test.{ts,tsx}"],
          setupFiles: ["./extension/test/setup.ts"],
        },
      },
    ],
  },
});
