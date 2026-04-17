import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const ENV = env.runtime.nodeEnv;
const IS_PROD = ENV === "production";
const IS_TEST = ENV === "test";
const IS_DEV  = !IS_PROD && !IS_TEST;

const prismaLog: ("query" | "info" | "warn" | "error")[] =
  IS_TEST ? [] : (IS_DEV ? ["warn", "error"] : ["error"]);

type GlobalWithPrisma = typeof globalThis & { __prisma?: PrismaClient };
const g = globalThis as GlobalWithPrisma;

export const prisma: PrismaClient = g.__prisma ?? new PrismaClient({ log: prismaLog });

if (!IS_PROD) g.__prisma = prisma;

const MAX_CONCURRENCY = env.database.maxConcurrency;
let current = 0;
const queue: Array<() => void> = [];

function _next() {
  const job = queue.shift();
  if (job) job();
}

export async function withDbLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      current++;
      try {
        const res = await fn();
        resolve(res);
      } catch (e) {
        reject(e);
      } finally {
        current--;
        _next();
      }
    };
    if (current < MAX_CONCURRENCY) run();
    else queue.push(run);
  });
}

export async function connectPrismaWithRetry(maxRetries = 8) {
  let attempt = 0;
  while (true) {
    try {
      await prisma.$connect();
      if (IS_DEV) console.log(`[DB] Connected (attempt ${attempt + 1})`);
      return;
    } catch (err) {
      attempt++;
      const wait = Math.min(30_000, 1000 * 2 ** attempt);
      if (!IS_TEST) {
        console.warn(
          `[DB] Connect fail (attempt ${attempt}/${maxRetries}) — retry in ${Math.round(
            wait / 1000
          )}s`,
          IS_DEV ? err : ""
        );
      }
      if (attempt >= maxRetries) {
        console.error("[DB] Max retries reached. Continuing without hard exit.");
        return;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

let shuttingDown = false;

export async function disconnectPrisma() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await prisma.$disconnect();
    if (IS_DEV) console.log("[DB] Disconnected");
  } catch (e) {
    console.error("[DB] Disconnect error", e);
  }
}


if (!IS_TEST) {
  const onExit = async (signal: NodeJS.Signals) => {
    if (IS_DEV) console.log(`[APP] Received ${signal}, shutting down...`);
    await disconnectPrisma();
    process.exit(0);
  };
  process.once("SIGINT", onExit);
  process.once("SIGTERM", onExit);
}
