// Harness smoke test: proves the Express app can be imported without binding a
// port (the main-module guard in index.ts) and driven via supertest.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { app } from "../index.js";

// The packaged download is a gitignored build artifact produced by
// `npm run build:download` (not by `npm test`), so the assertion below only
// runs when the zip is actually present. The Docker CI job is the
// authoritative check that a fresh build serves it (see .github/workflows/ci.yml).
const DOWNLOAD_ZIP = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/download/matt-grant-campaign-tools.zip",
);

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("public distribution site", () => {
  it("serves the landing page at / without auth", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Campaign Tools");
    expect(res.text).toContain("/download/matt-grant-campaign-tools.zip");
    expect(res.text).toContain('href="/guide/"'); // footer link to the guide
  });

  it("serves the user guide page at /guide/ without auth", async () => {
    const res = await request(app).get("/guide/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("user guide");
  });

  const packed = existsSync(DOWNLOAD_ZIP);
  (packed ? it : it.skip)(
    "serves the packaged extension zip at /download/ when built",
    async () => {
      const res = await request(app).get("/download/matt-grant-campaign-tools.zip");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/zip/);
    },
  );
});
