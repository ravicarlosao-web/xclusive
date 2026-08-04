import { defineConfig } from "drizzle-kit";
import path from "path";

// SUPABASE_DATABASE_URL tem prioridade — permite correr migrations contra
// Supabase sem tocar na DATABASE_URL gerida pelo Replit.
const url = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
