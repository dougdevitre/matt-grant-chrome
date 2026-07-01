// Harness smoke test: proves the Express app can be imported without binding a
// port (the main-module guard in index.ts) and driven via supertest.

import request from "supertest";
import { app } from "../index.js";

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
});
