import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function createDatabaseClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) throw new Error("DATABASE_URL must be set explicitly");
  let valid = false;
  try { valid = ["postgresql:", "postgres:"].includes(new URL(databaseUrl).protocol); } catch { /* Invalid URL. */ }
  if (!valid) throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 }) });
}
