// Cria UM utilizador administrador (role «admin»; NUNCA superadmin).
//
//   pnpm --filter @workspace/scripts exec tsx criar-admin.mjs <email> [<utilizador>]               (simulação: não escreve nada)
//   pnpm --filter @workspace/scripts exec tsx criar-admin.mjs <email> [<utilizador>] --confirmar   (cria a conta)
//
// Regras:
//  - Role fixo «admin». Não há opção para outro role e o script nunca altera uma conta existente (por isso também não eleva ninguém a superadmin).
//  - A palavra-passe é pedida no terminal, SEM eco, duas vezes (mínimo 12 caracteres, recusa as óbvias). Nunca vem por argumento, variável de ambiente nem ficheiro,
//    e nunca é impressa, registada nem guardada em texto: só o hash bcrypt (custo 12, o mesmo de lib/auth.ts hashPassword) vai para a base de dados.
//  - Liga à base de dados pela configuração que a aplicação já usa (@workspace/db: DATABASE_URL / .env). Não imprime a ligação nem segredos.
//  - Por defeito é uma simulação (só lê: confirma que o email e o utilizador estão livres). Só escreve com --confirmar.
//  - Recusa, sem alterar nada, se o email (qualquer conta, sem distinguir maiúsculas) ou o utilizador já existirem.
//  - Conta criada: role «admin», ativa, nome de exibição = utilizador, SEM linhas de registo/consentimentos nem Google (não passa pelo registo de utilizadores).
//    O email NÃO é marcado como verificado: o login de admin (POST /admin/auth/login) só exige role admin/superadmin, palavra-passe certa e conta ativa.
//  - Regista a criação em audit_log (ação «admin_criado_script»; o autor é a própria conta nova, porque admin_id é obrigatório; sem a palavra-passe nem o hash).
import readline from "node:readline";
import bcrypt from "bcryptjs";

const CUSTO_BCRYPT = 12;   // o mesmo de artifacts/api-server/src/lib/auth.ts (hashPassword)
const MIN_PASSWORD = 12, MAX_PASSWORD = 128;
const ACAO_AUDITORIA = "admin_criado_script";

const falha = (msg, codigo = 1) => { console.error(`❌ ${msg}`); process.exit(codigo); };

// ── argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes("--ajuda") || args.includes("-h")) {
  console.log("Uso: criar-admin.mjs <email> [<utilizador>] [--confirmar]\n  Sem --confirmar corre em simulação (não escreve nada). A palavra-passe é pedida no terminal, sem eco, duas vezes.");
  process.exit(0);
}
const opcoes = args.filter((a) => a.startsWith("-")), posicionais = args.filter((a) => !a.startsWith("-"));
const desconhecidas = opcoes.filter((o) => o !== "--confirmar");
if (desconhecidas.length) falha(`Opção não reconhecida: ${desconhecidas.join(" ")}. Só existe --confirmar (o role é sempre «admin»; este script nunca cria nem eleva superadmin).`, 2);
if (posicionais.length < 1 || posicionais.length > 2) falha("Uso: criar-admin.mjs <email> [<utilizador>] [--confirmar]", 2);
const confirmar = opcoes.includes("--confirmar");

const emailBruto = posicionais[0].trim();
if (emailBruto.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto)) falha("Email inválido.", 2);
const email = emailBruto.toLowerCase();   // a aplicação guarda e compara os emails em minúsculas (normalizarEmailConta)

// ── terminal: perguntas ──────────────────────────────────────────────────────
const exigirTerminal = () => { if (!process.stdin.isTTY) falha("É preciso um terminal interativo para esta pergunta (a palavra-passe nunca vem por argumento, variável de ambiente, ficheiro nem pipe).", 2); };

function perguntar(pergunta) {   // linha normal (com eco)
  exigirTerminal();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (r) => { rl.close(); resolve(r.trim()); }));
}

function perguntarSecreto(pergunta) {   // SEM eco: modo raw, caracter a caracter
  exigirTerminal();
  return new Promise((resolve) => {
    const { stdin, stdout } = process; let s = "";
    stdout.write(pergunta); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const fim = () => { stdin.removeListener("data", ao); stdin.setRawMode(false); stdin.pause(); stdout.write("\n"); };
    const ao = (bloco) => {
      for (const c of bloco) {
        if (c === "\u0003") { fim(); process.exit(130); }                   // Ctrl-C
        if (c === "\r" || c === "\n") { fim(); resolve(s); return; }
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
        else if (c >= " ") s += c;
      }
    };
    stdin.on("data", ao);
  });
}

// ── utilizador ───────────────────────────────────────────────────────────────
let utilizador = posicionais[1] ?? "";
if (!utilizador) utilizador = await perguntar("Nome de utilizador: ");
if (utilizador.length < 3 || utilizador.length > 50 || !/^[a-zA-Z0-9_]+$/.test(utilizador)) falha("Nome de utilizador inválido (3 a 50 caracteres: letras, números e _).", 2);
const username = utilizador.toLowerCase();

// ── palavra-passe: regras ────────────────────────────────────────────────────
const OBVIAS = ["password", "passw0rd", "palavrapasse", "palavra-passe", "senha", "admin", "administrador", "xclusive", "qwerty", "azerty", "letmein", "welcome", "iloveyou", "angola", "luanda", "123456", "654321", "abcdef", "000000", "111111"];
function problemaDaPassword(p, { email, username }) {
  if (p.length < MIN_PASSWORD) return `A palavra-passe tem de ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (p.length > MAX_PASSWORD) return `A palavra-passe tem de ter no máximo ${MAX_PASSWORD} caracteres.`;
  const l = p.toLowerCase();
  if (new Set(l).size < 5) return "A palavra-passe é demasiado óbvia (poucos caracteres diferentes).";
  if (OBVIAS.some((o) => l.includes(o))) return "A palavra-passe é demasiado óbvia (contém uma palavra ou sequência comum).";
  const local = email.split("@")[0];
  for (const parte of [local, username]) if (parte.length >= 4 && l.includes(parte.toLowerCase())) return "A palavra-passe não pode conter o email nem o nome de utilizador.";
  if (/^(.)\1+$/.test(p) || "abcdefghijklmnopqrstuvwxyz0123456789".includes(l) || "9876543210zyxwvutsrqponmlkjihgfedcba".includes(l)) return "A palavra-passe é demasiado óbvia (sequência).";
  return null;
}

// ── base de dados (a configuração já existente da aplicação) ─────────────────
let pool;
try { ({ pool } = await import("@workspace/db")); } catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`); }
const destino = (() => { try { const h = new URL(pool.options.connectionString).hostname; return h === "localhost" || h === "127.0.0.1" ? "local" : "remota"; } catch { return "configurada"; } })();
const sair = async (codigo) => { try { await pool.end(); } catch { /* ignora */ } process.exit(codigo); };
const erroBd = (e) => `Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`;   // nunca a mensagem, a query nem os parâmetros: podem trazer dados

let existentes;
try {
  existentes = await pool.query("select (select count(*) from users where lower(email) = $1)::int as por_email, (select count(*) from users where lower(username) = $2)::int as por_username", [email, username]);
} catch (e) { console.error(`❌ ${erroBd(e)}`); await sair(1); }
const { por_email, por_username } = existentes.rows[0];
if (por_email > 0) { console.error("❌ Recusado: já existe uma conta com este email. Nada foi alterado."); await sair(1); }
if (por_username > 0) { console.error("❌ Recusado: já existe uma conta com este nome de utilizador. Nada foi alterado."); await sair(1); }

// ── simulação (por defeito) ──────────────────────────────────────────────────
console.log(confirmar ? "Criar administrador:" : "SIMULAÇÃO (nada será escrito). Faria o seguinte:");
console.log(`  email        ${email}`);
console.log(`  utilizador   ${username}`);
console.log("  role         admin");
console.log(`  base de dados ${destino}`);
if (!confirmar) {
  console.log("  (o email e o utilizador estão livres; a palavra-passe seria pedida no terminal, sem eco, 2 vezes, mínimo 12 caracteres)");
  console.log("Para criar a conta, repete o comando com --confirmar.");
  await sair(0);
}

// ── palavra-passe (só com --confirmar) ───────────────────────────────────────
let password = await perguntarSecreto("Palavra-passe (sem eco): ");
let repetida = await perguntarSecreto("Repete a palavra-passe: ");
if (password !== repetida) { console.error("❌ As palavras-passe não coincidem. Nada foi alterado."); await sair(1); }
const problema = problemaDaPassword(password, { email, username });
if (problema) { console.error(`❌ ${problema} Nada foi alterado.`); await sair(1); }
const hash = await bcrypt.hash(password, CUSTO_BCRYPT);
password = repetida = "";   // nada mais precisa do texto

// ── escrita: tudo numa transação ─────────────────────────────────────────────
const cliente = await pool.connect();
try {
  await cliente.query("begin");
  const r = await cliente.query(
    "insert into users (username, email, password_hash, nome_exibicao, role) values ($1, $2, $3, $4, 'admin') returning id",
    [username, email, hash, username],
  );
  const id = r.rows[0].id;
  await cliente.query(
    "insert into audit_log (admin_id, action, target_type, target_id, details) values ($1, $2, 'user', $1, $3::jsonb)",
    [id, ACAO_AUDITORIA, JSON.stringify({ origem: "scripts/criar-admin.mjs", role: "admin" })],
  );
  await cliente.query("commit");
  console.log(`✅ Administrador criado: id ${id}, ${email} (${username}), role admin.`);
} catch (e) {
  try { await cliente.query("rollback"); } catch { /* ignora */ }
  if (e?.code === "23505") console.error("❌ Recusado: o email ou o utilizador foram ocupados entretanto. Nada foi alterado.");
  else console.error(`❌ ${erroBd(e)} Nada foi alterado.`);
  cliente.release(); await sair(1);
}
cliente.release();
await sair(0);
