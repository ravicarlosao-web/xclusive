// GUARDA DE MIGRAÇÕES do deploy (SÓ DE LEITURA). Compara os ficheiros .sql de lib/db/src/migrations com a tabela schema_migracoes da base de dados e RECUSA (código de saída 1) se alguma migração não estiver registada,
// para o deploy não pôr código novo em produção antes de a migração estar aplicada (lição do #138). A aplicação não usa esta tabela; só este script.
//
//   pnpm --filter @workspace/scripts exec tsx verificar-migracoes.mjs                    (guarda: 0 = tudo registado; 1 = há pendentes, a tabela não existe ou a base não responde)
//   pnpm --filter @workspace/scripts exec tsx verificar-migracoes.mjs --gerar-baseline   (NÃO toca na base de dados: imprime o INSERT com todos os ficheiros que existem hoje)
//   PULAR_GUARDA_MIGRACOES=1 pnpm … verificar-migracoes.mjs                              (EMERGÊNCIA: avisa em letras grandes que a guarda foi ignorada e sai com 0)
//
// Lê a ligação à base de dados do .env da API (artifacts/api-server/.env) ou das variáveis de ambiente, como o resto dos scripts; não imprime a ligação nem segredos.
// Em modo normal corre numa transação READ ONLY (a própria base de dados recusa qualquer escrita) e só faz SELECTs.
// MIGRACOES_DIR (opcional) aponta para outra pasta de migrações (usado só pelos testes). Procedimento: docs/deploy/guarda-migracoes.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(aqui, "..");
const DIR = process.env.MIGRACOES_DIR || path.join(REPO, "lib/db/src/migrations");
const falha = (msg, codigo = 1) => { console.error(`❌ ${msg}`); process.exit(codigo); };

const args = process.argv.slice(2), opt = {};
for (const a of args) { if (a === "--gerar-baseline" || a === "--ajuda" || a === "-h") opt[a] = true; else falha(`Argumento não reconhecido: ${a}.`, 2); }
if (opt["--ajuda"] || opt["-h"]) {
  console.log("Uso: verificar-migracoes.mjs [--gerar-baseline]\n  Sem opções: guarda (só leitura). Sai com 1 se houver migrações por aplicar, se a tabela schema_migracoes não existir ou se a base de dados não responder.\n  --gerar-baseline: não toca na base de dados; imprime o INSERT com os ficheiros de migração que existem hoje.\n  PULAR_GUARDA_MIGRACOES=1: ignora a guarda (emergência), com aviso.");
  process.exit(0);
}

const ficheiros = () => {
  let l; try { l = fs.readdirSync(DIR); } catch { falha(`Não foi possível ler a pasta das migrações (${path.relative(REPO, DIR) || DIR}).`, 1); }
  return l.filter((f) => f.endsWith(".sql")).sort();
};
const sqlTexto = (s) => `'${s.replace(/'/g, "''")}'`;

// ── emergência ──
if (process.env.PULAR_GUARDA_MIGRACOES === "1") {
  const barra = "█".repeat(78);
  console.error(`\n${barra}\n██  A GUARDA DE MIGRAÇÕES FOI IGNORADA (PULAR_GUARDA_MIGRACOES=1)  ██\n██  O deploy segue SEM confirmar que as migrações estão aplicadas na base de dados.  ██\n██  Confirma À MÃO que todas as migrações novas já foram aplicadas no Neon.  ██\n${barra}\n`);
  process.exit(0);
}

// ── baseline: só imprime, nunca liga à base de dados ──
if (opt["--gerar-baseline"]) {
  const nomes = ficheiros();
  if (nomes.length === 0) falha("Não há ficheiros .sql na pasta das migrações.", 1);
  console.log(`-- Baseline gerado por verificar-migracoes.mjs (NÃO foi escrito nada na base de dados): ${nomes.length} migrações.`);
  console.log("-- ANTES de colar no Neon: confirma que TODAS estas migrações já estão aplicadas em produção. Se alguma ainda não estiver, tira-a da lista e aplica-a primeiro (senão a guarda deixava-a passar sem estar aplicada).");
  console.log("INSERT INTO schema_migracoes (nome) VALUES\n" + nomes.map((n) => `  (${sqlTexto(n)})`).join(",\n") + "\nON CONFLICT DO NOTHING;");
  process.exit(0);
}

// ── guarda ──
const nomes = ficheiros();
if (nomes.length === 0) falha("Não há ficheiros .sql na pasta das migrações: nada a verificar (isto não é normal).", 1);

// A ligação vem do .env da API (sem sobrescrever variáveis já definidas no ambiente).
try { const dotenv = (await import("dotenv")).default; dotenv.config({ path: path.join(REPO, "artifacts/api-server/.env") }); } catch { /* sem dotenv: só as variáveis de ambiente */ }

let pool;
try { ({ pool } = await import("@workspace/db")); }
catch (e) { falha(`Guarda de migrações: não foi possível configurar a ligação à base de dados (${/DATABASE_URL/.test(String(e?.message)) ? "DATABASE_URL não definida" : (e?.code ?? e?.name ?? "erro")}). O deploy NÃO deve avançar.`, 1); }
let cliente = null;
const sair = async (codigo) => { try { cliente?.release(); } catch { /* ignora */ } try { await Promise.race([pool.end(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* ignora */ } process.exit(codigo); };
const indisponivel = async (e) => { console.error(`❌ Guarda de migrações: a base de dados não respondeu (${e?.code ?? e?.name ?? "erro"}). O deploy NÃO deve avançar (a guarda não deixa passar em silêncio).`); await sair(1); };

try {
  cliente = await Promise.race([pool.connect(), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("tempo esgotado"), { code: "TEMPO_ESGOTADO" })), 15000))]);
} catch (e) { await indisponivel(e); }

try {
  await cliente.query("begin transaction isolation level repeatable read read only");   // só leitura: a base recusa qualquer escrita
  const existe = (await cliente.query("select to_regclass('public.schema_migracoes') is not null as existe")).rows[0].existe;
  if (!existe) {
    await cliente.query("rollback");
    console.error("❌ A guarda de migrações ainda NÃO foi instalada: a tabela schema_migracoes não existe nesta base de dados.\n   Aplica no Neon, ANTES de continuar, a migração lib/db/src/migrations/add_schema_migracoes.sql\n   e regista as migrações já aplicadas (--gerar-baseline). Procedimento: docs/deploy/guarda-migracoes.md");
    await sair(1);
  }
  const registadas = new Set((await cliente.query("select nome from schema_migracoes")).rows.map((r) => r.nome));
  await cliente.query("rollback");
  const pendentes = nomes.filter((n) => !registadas.has(n));
  const extra = [...registadas].filter((n) => !nomes.includes(n)).sort();
  if (pendentes.length > 0) {
    console.error(`❌ Há ${pendentes.length} migração(ões) por aplicar (não registadas em schema_migracoes):`);
    for (const n of pendentes) console.error(`   • ${n}`);
    console.error("\nAplica estas migrações no Neon ANTES do deploy (cada ficheiro termina com o INSERT que o regista). Depois repete o deploy.\nDeploy RECUSADO.");
    await sair(1);
  }
  console.log(`✅ Guarda de migrações: as ${nomes.length} migrações estão registadas. Pode avançar com o deploy.`);
  if (extra.length) console.log(`   (info: ${extra.length} registo(s) sem ficheiro nesta versão do código: ${extra.join(", ")})`);
  await sair(0);
} catch (e) {
  try { await cliente.query("rollback"); } catch { /* ignora */ }
  await indisponivel(e);
}
