/**
 * Verifica a ligação à base de dados com o MESMO pool da API (lib/db), de forma segura para a produção:
 *   - só faz leituras (current_database() e o estado do TLS); não escreve nada, não arranca jobs nem a API;
 *   - NUNCA imprime o URL, o utilizador, a palavra-passe, o servidor nem a mensagem do erro (que pode trazê-los).
 *
 * O resultado principal é o TLS do LADO DO CLIENTE (o socket que o pg abriu: encriptado, protocolo, cifra, certificado verificado).
 * O pg_stat_ssl é só informativo: mostra a ligação do ÚLTIMO SALTO até ao Postgres e, atrás de um proxy ou pooler (Neon), pode dizer
 * «inativo» com o cliente encriptado. Nunca se rotula «TLS ativo» a partir dele.
 *
 * Origem do URL, sem valores: o nome da variável, o ficheiro de origem (caminho relativo) e, por ficheiro candidato, uma impressão digital
 * não reversível (SHA-256 de «sal|host:porta/base» em minúsculas, 12 caracteres) calculada a partir do URL já interpretado.
 *
 * Uso: pnpm db:verificar [--como-api] [--pasta-api=<pasta>]      (código de saída 0 = ok, 1 = falhou ou sem TLS no cliente)
 *   --como-api    resolve o URL pela ordem da API em produção: <pasta da API>/.env, depois o .env da raiz, depois artifacts/.env
 *                 (o ambiente do terminal é ignorado; o ambiente do pm2 não é visível ao script e, se existir, prevalece sobre os ficheiros).
 *   --pasta-api   pasta onde o pm2 arrancou a API (por omissão artifacts/api-server).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TLSSocket } from "node:tls";
import dotenv from "dotenv";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const SAL = "xclusive-bd-v1";
const VARIAVEIS = ["SUPABASE_DATABASE_URL", "DATABASE_URL"] as const;
type Variavel = (typeof VARIAVEIS)[number];
type Fonte = { rotulo: string; existe: boolean; def: Partial<Record<Variavel, string>> };

const comoApi = process.argv.includes("--como-api");
const pastaApiArg = process.argv.find((a) => a.startsWith("--pasta-api="))?.slice("--pasta-api=".length);
const PASTA_API = pastaApiArg ? path.resolve(pastaApiArg) : path.join(RAIZ, "artifacts/api-server");

/** Nome curto e relativo (nunca o caminho completo). */
function rotuloDe(ficheiro: string): string {
  const rel = path.relative(RAIZ, ficheiro);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return ".env (pasta indicada, fora do repositório)";
  return rel === ".env" ? ".env (raiz)" : rel.split(path.sep).join("/");
}

function lerFicheiro(ficheiro: string): Fonte {
  const rotulo = rotuloDe(ficheiro);
  try {
    const p = dotenv.parse(fs.readFileSync(ficheiro));
    const def: Fonte["def"] = {};
    for (const v of VARIAVEIS) if (Object.prototype.hasOwnProperty.call(p, v)) def[v] = p[v];
    return { rotulo, existe: true, def };
  } catch {
    return { rotulo, existe: false, def: {} };
  }
}

/** O ambiente do terminal tal como estava ao arrancar (antes de qualquer ficheiro). */
function lerTerminal(): Fonte {
  const def: Fonte["def"] = {};
  for (const v of VARIAVEIS) if (process.env[v] !== undefined) def[v] = process.env[v];
  return { rotulo: "ambiente do terminal", existe: true, def };
}

/** Ordem do script (modo normal): terminal, .env da pasta atual, .env da raiz, artifacts/api-server/.env. */
const ordemNormal = (): Fonte[] => [lerTerminal(), lerFicheiro(path.resolve(process.cwd(), ".env")), lerFicheiro(path.join(RAIZ, ".env")), lerFicheiro(path.join(RAIZ, "artifacts/api-server/.env"))];
/** Ordem da API em produção (pm2 na pasta da API): <pasta da API>/.env, raiz/.env, artifacts/.env. O dotenv nunca sobrepõe: ganha o primeiro que define. */
const ordemApi = (): Fonte[] => [lerFicheiro(path.join(PASTA_API, ".env")), lerFicheiro(path.join(RAIZ, ".env")), lerFicheiro(path.join(RAIZ, "artifacts/.env"))];

/** Mesma regra do lib/db: SUPABASE_DATABASE_URL só vale se for um URL postgres; senão DATABASE_URL. Cada variável vem da 1.ª fonte que a define. */
function resolver(fontes: Fonte[]) {
  const pegar = (nome: Variavel) => { for (const f of fontes) if (f.def[nome] !== undefined) return { valor: f.def[nome] as string, rotulo: f.rotulo }; return null; };
  const sup = pegar("SUPABASE_DATABASE_URL"), db = pegar("DATABASE_URL");
  const supValido = !!sup && /^postgres(ql)?:\/\//.test(sup.valor);
  const usada = supValido ? { nome: "SUPABASE_DATABASE_URL" as Variavel, ...sup! } : db ? { nome: "DATABASE_URL" as Variavel, ...db } : null;
  return { sup, db, usada };
}

const MODOS_SSL = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full", "no-verify"]);

/** Impressão digital, pooler e sslmode do URL já interpretado. Nunca devolve o host, o utilizador nem a palavra-passe. */
function descrever(url: string): { impressao: string; pooler: boolean; sslmode: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase(), porta = u.port || "5432", base = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const impressao = crypto.createHash("sha256").update(`${SAL}|${host}:${porta}/${base}`).digest("hex").slice(0, 12);
    const m = u.searchParams.get("sslmode");
    return { impressao, pooler: host.includes("-pooler"), sslmode: m === null ? "(não definido)" : MODOS_SSL.has(m) ? m : "(valor não reconhecido)" };
  } catch {
    return null;
  }
}
const texto = (d: ReturnType<typeof descrever>) => (d ? `impressão ${d.impressao} · pooler ${d.pooler ? "sim" : "não"} · sslmode ${d.sslmode}` : "URL ilegível");

async function verificar(): Promise<number> {
  const fontes = comoApi ? ordemApi() : ordemNormal();
  const r = resolver(fontes);
  const relPasta = path.relative(RAIZ, PASTA_API);
  console.log(`modo: ${comoApi ? `como a API (pasta da API: ${relPasta.startsWith("..") || path.isAbsolute(relPasta) ? "pasta indicada, fora do repositório" : relPasta || "raiz"})` : "normal"}`);
  console.log("ficheiros candidatos:");
  if (comoApi) console.log("  ambiente do terminal: ignorado neste modo");
  for (const f of fontes) {
    const linhas = VARIAVEIS.filter((v) => f.def[v] !== undefined).map((v) => `${v} → ${texto(descrever(f.def[v]!))}`);
    console.log(`  ${f.rotulo}: ${f.existe ? (linhas.length ? linhas.join(" | ") : "não define a variável") : "não existe ou ilegível"}`);
  }
  // A outra ordem, só para dizer se dá a mesma base (a ordem normal depende da pasta atual; a da API da pasta indicada)
  const outra = resolver(comoApi ? ordemNormal() : ordemApi());
  const a = r.usada ? descrever(r.usada.valor) : null, b = outra.usada ? descrever(outra.usada.valor) : null;
  console.log(`mesma base na ordem normal e na ordem da API: ${a && b ? (a.impressao === b.impressao ? "sim" : "NÃO") : "indeterminado"}`);
  if (comoApi) console.log("nota: o ambiente do pm2 não é visível ao script; se tiver DATABASE_URL guardado, prevalece sobre os ficheiros (confirma: pm2 env <id> | grep -c \"^DATABASE_URL=\")");
  console.log(`variável usada: ${r.usada ? `${r.usada.nome} (origem: ${r.usada.rotulo})` : "nenhuma"}`);

  // A ligação usa a resolução escolhida: as duas variáveis ficam definidas à partida (mesmo vazias), para o dotenv do lib/db não as sobrepor.
  process.env.DOTENV_CONFIG_QUIET = "true";
  process.env.DATABASE_URL = r.db?.valor ?? "";
  process.env.SUPABASE_DATABASE_URL = r.sup?.valor ?? "";

  let pool: Awaited<typeof import("@workspace/db")>["pool"] | null = null;
  try {
    // Import dinâmico: sem variável de ligação o @workspace/db lança ao carregar; assim a falha sai no mesmo formato, sem o texto do erro.
    ({ pool } = await import("@workspace/db"));
    const usada = descrever((pool.options as { connectionString?: string }).connectionString ?? "");
    const cliente = await pool.connect();
    try {
      const s = (cliente as unknown as { connection?: { stream?: Partial<TLSSocket> } }).connection?.stream;
      const encriptado = s?.encrypted === true, verificado = s?.authorized === true;
      const q = await cliente.query("select current_database() as bd, coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as tls_servidor");
      console.log(`base: ${q.rows[0].bd} · ${texto(usada).replace("sslmode ", "sslmode efetivo ")}`);
      if (usada && a && usada.impressao !== a.impressao) console.log("atenção: a ligação usada não coincide com a resolvida acima");
      console.log(encriptado
        ? `TLS do cliente: ativo (${s?.getProtocol?.() ?? "protocolo desconhecido"}, ${s?.getCipher?.()?.name ?? "cifra desconhecida"}, certificado ${verificado ? "verificado" : "NÃO verificado"})`
        : "TLS do cliente: INATIVO (o socket da ligação não está encriptado)");
      console.log(`visto pelo servidor (pg_stat_ssl): ${q.rows[0].tls_servidor ? "ativo" : "inativo"} — com proxy/pooler pode mostrar só o último salto`);
      if (!encriptado) { console.error("ligação à BD: ok mas SEM TLS no cliente"); return 1; }
      console.log(`ligação à BD: ok (TLS ativo${verificado ? "" : ", certificado NÃO verificado"})`);
      return 0;
    } finally {
      cliente.release();
    }
  } catch (err) {
    const e = err as { name?: string; code?: string };
    const nome = typeof e?.name === "string" ? e.name : "Error";
    const codigo = typeof e?.code === "string" ? `, código ${e.code}` : "";
    console.error(`ligação à BD: FALHOU (${pool ? nome + codigo : "variável de ligação em falta ou inválida"})`);
    return 1;
  } finally {
    await pool?.end().catch(() => {});
  }
}

process.exit(await verificar());
