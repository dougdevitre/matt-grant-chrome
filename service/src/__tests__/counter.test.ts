// Shared counter port. MemoryCounter is the single-instance default; RedisCounter
// (tested against a mocked ioredis client) makes the rate limits + SMS cap hold
// across instances.

import { describe, expect, it, vi } from "vitest";
import { MemoryCounter, RedisCounter, type RedisLike } from "../lib/counter.js";

describe("MemoryCounter", () => {
  it("allows up to max within the window, then blocks, then resets", async () => {
    const c = new MemoryCounter();
    const now = 1_000_000;
    expect(await c.allowN("k", 2, 1000, now)).toBe(true);
    expect(await c.allowN("k", 2, 1000, now)).toBe(true);
    expect(await c.allowN("k", 2, 1000, now)).toBe(false);
    expect(await c.allowN("k", 2, 1000, now + 2000)).toBe(true); // window elapsed
  });

  it("tracks a per-day counter independently per day", async () => {
    const c = new MemoryCounter();
    expect(await c.dailyCount("sms", "2026-07-01")).toBe(0);
    await c.dailyIncr("sms", "2026-07-01");
    await c.dailyIncr("sms", "2026-07-01");
    expect(await c.dailyCount("sms", "2026-07-01")).toBe(2);
    expect(await c.dailyCount("sms", "2026-07-02")).toBe(0);
  });
});

function fakeRedis(opts: { card?: number; incr?: number; get?: string | null }) {
  const calls: string[] = [];
  const chain = {
    zremrangebyscore: () => (calls.push("zremrangebyscore"), chain),
    zadd: () => (calls.push("zadd"), chain),
    zcard: () => (calls.push("zcard"), chain),
    pexpire: () => (calls.push("pexpire"), chain),
    exec: async () =>
      [
        [null, 1],
        [null, 1],
        [null, opts.card ?? 0],
        [null, 1],
      ] as Array<[Error | null, unknown]>,
  };
  const redis = {
    multi: () => chain,
    incr: vi.fn(async () => opts.incr ?? 1),
    expire: vi.fn(async () => 1),
    get: vi.fn(async () => opts.get ?? null),
  };
  return { redis: redis as unknown as RedisLike, calls, mocks: redis };
}

describe("RedisCounter", () => {
  it("runs the sliding-window pipeline and allows when card <= max", async () => {
    const { redis, calls } = fakeRedis({ card: 2 });
    const c = new RedisCounter(redis);
    expect(await c.allowN("k", 2, 1000)).toBe(true);
    expect(calls).toEqual(["zremrangebyscore", "zadd", "zcard", "pexpire"]);
  });

  it("blocks when the window count exceeds max", async () => {
    const { redis } = fakeRedis({ card: 3 });
    expect(await new RedisCounter(redis).allowN("k", 2, 1000)).toBe(false);
  });

  it("sets a TTL only on the first daily increment", async () => {
    const first = fakeRedis({ incr: 1 });
    await new RedisCounter(first.redis).dailyIncr("sms", "2026-07-01");
    expect(first.mocks.expire).toHaveBeenCalledTimes(1);

    const later = fakeRedis({ incr: 5 });
    await new RedisCounter(later.redis).dailyIncr("sms", "2026-07-01");
    expect(later.mocks.expire).not.toHaveBeenCalled();
  });

  it("reads the daily count (0 when unset)", async () => {
    expect(await new RedisCounter(fakeRedis({ get: "7" }).redis).dailyCount("sms", "d")).toBe(7);
    expect(await new RedisCounter(fakeRedis({ get: null }).redis).dailyCount("sms", "d")).toBe(0);
  });
});
