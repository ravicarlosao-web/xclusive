import { defineConfig } from "drizzle-kit";
import path from "path";
import dotenv from "dotenv";
import { sslmodeExplicito } from "./src/sslmode";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

// SUPABASE_DATABASE_URL tem prioridade — mas só se for uma connection string
// PostgreSQL válida (começa com postgresql:// ou postgres://).
// Ignora URLs HTTP (ex: o URL do projeto Supabase) e faz fallback para DATABASE_URL.
const rawSupabase = process.env.SUPABASE_DATABASE_URL ?? "";
const isValidPgUrl = rawSupabase.startsWith("postgresql://") || rawSupabase.startsWith("postgres://");
const urlBruto = (isValidPgUrl ? rawSupabase : null) ?? process.env.DATABASE_URL;
// sslmode=prefer|require|verify-ca passam a 'verify-full' (o que o pg 8 já faz; explícito para não mudar com o pg v9). Ver src/sslmode.ts.
const url = urlBruto ? sslmodeExplicito(urlBruto) : urlBruto;

if (!url) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: { url },
});
