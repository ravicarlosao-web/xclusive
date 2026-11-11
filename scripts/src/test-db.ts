import "dotenv/config";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

// Só diz se a ligação está configurada e se funciona: nunca imprime o URL (nem o início), o utilizador, a versão nem o objeto de erro.
const configurada = Boolean(process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL);

async function testConnection() {
  console.log("A testar a ligação à base de dados...");
  console.log(`configurada: ${configurada ? "sim" : "não"}`);
  if (!configurada) return;
  let pool: { query: (q: string) => Promise<unknown>; end: () => Promise<void> } | null = null;
  try {
    ({ pool } = await import("@workspace/db"));
    await pool!.query("SELECT 1");
    console.log("✅ Ligação com sucesso.");
  } catch (err) {
    // Só o nome e o código do erro: a mensagem e a stack podem trazer o servidor ou o utilizador.
    const e = err as { name?: string; code?: string };
    console.error(`❌ Falhou a ligação (${typeof e?.name === "string" ? e.name : "Error"}${typeof e?.code === "string" ? ", código " + e.code : ""}).`);
  } finally {
    await pool?.end().catch(() => {});
  }
}

testConnection();
