/**
 * Verifica a ligação à base de dados com o MESMO pool da API (lib/db), de forma segura para a produção:
 *   - faz só leituras (select 1 e o estado do TLS desta ligação); não escreve nada, não arranca jobs nem a API;
 *   - imprime APENAS «ligação à BD: ok (TLS ativo|inativo)» ou «FALHOU (nome do erro, código)»;
 *   - NUNCA imprime o URL, o utilizador, a palavra-passe, o servidor nem a mensagem do erro (que pode trazê-los).
 * Uso: pnpm db:verificar   (código de saída 0 = ok, 1 = falhou)
 */
import path from "node:path";
import dotenv from "dotenv";

// Procura o .env nos mesmos sítios que a API (a pasta atual, a raiz do repositório e artifacts/api-server).
dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../artifacts/api-server/.env"), quiet: true });

async function verificar(): Promise<number> {
  let pool: { query: (q: string) => Promise<{ rows: { tls: boolean }[] }>; end: () => Promise<void> } | null = null;
  try {
    // Import dinâmico: sem variável de ligação o @workspace/db lança ao carregar; assim a falha sai no mesmo formato, sem o texto do erro.
    ({ pool } = await import("@workspace/db"));
    const r = await pool!.query("select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as tls");
    console.log(`ligação à BD: ok (TLS ${r.rows[0]?.tls ? "ativo" : "inativo"})`);
    return 0;
  } catch (err) {
    const e = err as { name?: string; code?: string };
    const nome = typeof e?.name === "string" ? e.name : "Error";
    const codigo = typeof e?.code === "string" ? `, código ${e.code}` : "";
    const semVariavel = !pool;
    console.error(`ligação à BD: FALHOU (${semVariavel ? "variável de ligação em falta ou inválida" : nome + codigo})`);
    return 1;
  } finally {
    await pool?.end().catch(() => {});
  }
}

process.exit(await verificar());
