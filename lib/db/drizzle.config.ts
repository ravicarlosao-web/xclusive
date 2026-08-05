import { defineConfig } from "drizzle-kit";
import path from "path";

// SUPABASE_DATABASE_URL tem prioridade — mas só se for uma connection string
// PostgreSQL válida (começa com postgresql:// ou postgres://).
// Ignora URLs HTTP (ex: o URL do projeto Supabase) e faz fallback para DATABASE_URL.
const rawSupabase = process.env.SUPABASE_DATABASE_URL ?? "";
const isValidPgUrl = rawSupabase.startsWith("postgresql://") || rawSupabase.startsWith("postgres://");
const url = (isValidPgUrl ? rawSupabase : null) ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
