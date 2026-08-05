import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// SUPABASE_DATABASE_URL tem prioridade sobre DATABASE_URL (gerida pelo Replit),
// mas só se for uma connection string PostgreSQL válida (postgresql:// ou postgres://).
// Ignora URLs HTTP (ex: URL do projeto Supabase) e faz fallback para DATABASE_URL.
const rawSupabase = process.env.SUPABASE_DATABASE_URL ?? "";
const isValidPgUrl =
  rawSupabase.startsWith("postgresql://") || rawSupabase.startsWith("postgres://");
const connectionString = (isValidPgUrl ? rawSupabase : null) ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// SSL: activado sempre que a connection string não seja localhost/127.0.0.1.
// Supabase exige SSL; a DB interna do Replit não precisa.
// rejectUnauthorized: false aceita o certificado auto-assinado do pgbouncer
// do Supabase sem precisar de instalar o certificado CA manualmente.
const isLocal =
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1");

export const pool = new Pool({
  connectionString,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});

export const db = drizzle(pool, { schema });

export * from "./schema";
