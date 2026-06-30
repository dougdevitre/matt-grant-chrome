// Shared counters for rate limiting + the SMS daily cap. Per-process memory by
// default; set REDIS_URL (COUNTER_DRIVER=redis) so the limits/cap are shared
// across instances. Without it, N instances mean N× the per-IP/clerk rate limit
// and — more importantly — N× the SMS daily spend ceiling. Same adapter shape as
// the store/sms/mailer ports: interface + getCounter() singleton + driver switch.

import { getConfig } from "../config.js";

export interface CounterPort {
  /** Record a hit for key and return whether it is within max over windowMs. */
  allowN(key: string, max: number, windowMs: number, now?: number): Promise<boolean>;
  /** Increment a per-day counter (key scoped by an opaque day string). */
  dailyIncr(key: string, day: string): Promise<void>;
  /** Read the current per-day counter (0 if unset). */
  dailyCount(key: string, day: string): Promise<number>;
}

// --- memory (default, single-instance) --------------------------------------

const SWEEP_CAP = 50_000;
const MAX_IDLE_MS = 600_000;

export class MemoryCounter implements CounterPort {
  private buckets = new Map<string, number[]>();
  private daily = new Map<string, number>();

  async allowN(key: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
    const hits = (this.buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      this.buckets.set(key, hits);
      return false;
    }
    hits.push(now);
    this.buckets.set(key, hits);
    this.sweep(now);
    return true;
  }

  private sweep(now: number): void {
    if (this.buckets.size <= SWEEP_CAP) return;
    for (const [k, h] of this.buckets) {
      if (now - (h[h.length - 1] ?? 0) > MAX_IDLE_MS) this.buckets.delete(k);
    }
  }

  async dailyIncr(key: string, day: string): Promise<void> {
    const k = `${key}:${day}`;
    this.daily.set(k, (this.daily.get(k) ?? 0) + 1);
  }

  async dailyCount(key: string, day: string): Promise<number> {
    return this.daily.get(`${key}:${day}`) ?? 0;
  }
}

// --- redis (shared, multi-instance) -----------------------------------------

// Minimal shape of the ioredis methods we use (avoids a hard type dependency).
export interface RedisMulti {
  zremrangebyscore(key: string, min: number, max: number): RedisMulti;
  zadd(key: string, score: number, member: string): RedisMulti;
  zcard(key: string): RedisMulti;
  pexpire(key: string, ms: number): RedisMulti;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}
export interface RedisLike {
  multi(): RedisMulti;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export class RedisCounter implements CounterPort {
  private seq = 0;
  constructor(private redis: RedisLike) {}

  async allowN(key: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
    // Sorted-set sliding window: drop old entries, add this hit, count, expire.
    const member = `${now}-${this.seq++}`;
    const res = await this.redis
      .multi()
      .zremrangebyscore(key, 0, now - windowMs)
      .zadd(key, now, member)
      .zcard(key)
      .pexpire(key, windowMs)
      .exec();
    const card = res?.[2]?.[1];
    const count = typeof card === "number" ? card : Number(card ?? 0);
    return count <= max;
  }

  async dailyIncr(key: string, day: string): Promise<void> {
    const k = `${key}:${day}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, 172_800); // ~2 days
  }

  async dailyCount(key: string, day: string): Promise<number> {
    const v = await this.redis.get(`${key}:${day}`);
    return v ? Number(v) : 0;
  }
}

let singleton: CounterPort | null = null;

export async function getCounter(): Promise<CounterPort> {
  if (singleton) return singleton;
  const url = await getConfig("REDIS_URL");
  const driver = process.env.COUNTER_DRIVER ?? (url ? "redis" : "memory");
  if (driver === "redis" && url) {
    const { default: IORedis } = await import("ioredis");
    singleton = new RedisCounter(new IORedis(url) as unknown as RedisLike);
    return singleton;
  }
  singleton = new MemoryCounter();
  return singleton;
}

/** Test-only: drop the cached counter so each test starts clean. */
export function resetCounterForTests(): void {
  singleton = null;
}
