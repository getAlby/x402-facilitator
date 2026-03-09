import Redis from "ioredis";

if (!process.env.REDIS_URL) {
  console.error("Fatal: REDIS_URL environment variable is required");
  process.exit(1);
}

// Shared Redis client — ioredis manages connection pooling and reconnection automatically
export const redis = new Redis(process.env.REDIS_URL);
