// REPOSIÇÃO DE EMERGÊNCIA da verificação em dois passos (TOTP) de uma conta de admin ou superadmin — corre no VPS (acesso ao servidor = acesso de emergência).
// É o ÚNICO caminho de recuperação para o PRÓPRIO superadmin (um superadmin repõe outros admins pela API, nunca a si próprio).
//
//   pnpm --filter @workspace/scripts exec tsx admin-totp-repor.mjs <utilizador> [--confirmar]
//
// Sem --confirmar é uma SIMULAÇÃO: mostra a conta e o que seria feito, sem escrever nada. Com --confirmar pede que escrevas o NOME DO UTILIZADOR para confirmar e, numa só
// transação: remove o TOTP e os códigos de recuperação da conta, termina TODAS as sessões de admin dessa conta e regista admin_totp_reposto_por_script no audit_log (sem segredos).
// Saída: 0 = feito (ou simulação sem erros); 1 = erro; 2 = erro de uso; 3 = erro de ligação à base de dados; 4 = cancelado ou conta sem TOTP.
// Liga à base de dados pela configuração que a aplicação já usa (@workspace/db: DATABASE_URL / .env). Não imprime a ligação nem segredos (este script nem os lê: a chave ADMIN_TOTP_CHAVE não é precisa).
import readline from "node:readline";

const falha = (msg, codigo = 1) => { console.error(`❌ ${msg}`); process.exit(codigo); };
const args = process.argv.slice(2), posicionais = [], opt = {};
for (const a of args) {
  if (a === "--confirmar" || a === "--ajuda" || a === "-h") opt[a] = true;
  else if (a.startsWith("-")) falha(`Opção não reconhecida: ${a}.`, 2);
  else posicionais.push(a);
}
if (opt["--ajuda"] || opt["-h"]) { console.log("Uso: admin-totp-repor.mjs <utilizador> [--confirmar]\n  Sem --confirmar é uma simulação (nada fica escrito). Com --confirmar pede o nome do utilizador e repõe o TOTP dessa conta."); process.exit(0); }
if (posicionais.length !== 1) falha("Indica exatamente UM utilizador (nome de utilizador de um admin ou superadmin).", 2);
const nome = posicionais[0].trim();
if (!nome) falha("Indica exatamente UM utilizador.", 2);

let pool;
try { ({ pool } = await import("@workspace/db")); } catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`, 3); }
let cliente = null;
const sair = async (codigo) => { try { cliente?.release(); } catch { /* ignora */ } try { await pool.end(); } catch { /* ignora */ } process.exit(codigo); };   // sem libertar o cliente, pool.end() espera para sempre
cliente = await pool.connect().catch(async (e) => { console.error(`❌ Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`); await sair(3); });
const q = (sql, p) => cliente.query(sql, p);

try {
  const { rows: contas } = await q("select id, username, role, ativo from users where lower(username) = lower($1) and role in ('admin','superadmin') order by id limit 2", [nome]);
  if (contas.length === 0) { console.error(`❌ Não existe nenhuma conta de admin/superadmin com o utilizador «${nome}».`); await sair(1); }
  const conta = contas[0];
  let tem;
  try { tem = (await q("select 1 from admin_totp where user_id = $1", [conta.id])).rows.length > 0; }
  catch (e) { if (e?.code === "42P01") { console.error("❌ As tabelas do TOTP ainda não existem (migração add_admin_totp.sql por aplicar): nada a repor."); await sair(4); } throw e; }
  const sessoes = (await q("select count(*)::int as n from admin_sessoes where user_id = $1", [conta.id])).rows[0].n;
  const codigos = (await q("select count(*)::int as n from admin_totp_recuperacao where user_id = $1 and usado_em is null", [conta.id])).rows[0].n;
  console.log(`Conta: #${conta.id}  ${conta.username}  (${conta.role})${conta.ativo ? "" : "  [conta não ativa]"}`);
  console.log(`TOTP: ${tem ? "ATIVO ou em ativação" : "não existe"}  ·  códigos de recuperação por usar: ${codigos}  ·  sessões de admin abertas: ${sessoes}`);
  if (!tem) { console.log("\nNada a repor nesta conta."); await sair(4); }
  console.log("\nVai ser feito: remover o TOTP e os códigos de recuperação, terminar TODAS as sessões de admin desta conta e registar a reposição no audit_log.");
  if (!opt["--confirmar"]) { console.log("\nSIMULAÇÃO: nada foi alterado. Repete com --confirmar para repor."); await sair(0); }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await new Promise((res) => { rl.on("close", () => res("")); rl.question(`\nEscreve o nome do utilizador («${conta.username}») para confirmar a reposição: `, (r) => { res(r.trim()); rl.close(); }); });   // stdin fechado sem resposta = cancelado
  if (resposta !== conta.username) { console.error("\n❌ Confirmação diferente: cancelado, nada foi alterado."); await sair(4); }

  await q("begin");
  await q("delete from admin_totp_recuperacao where user_id = $1", [conta.id]);
  await q("delete from admin_totp where user_id = $1", [conta.id]);
  await q("delete from admin_sessoes where user_id = $1", [conta.id]);
  await q("insert into audit_log (admin_id, action, target_type, target_id, details) values ($1, 'admin_totp_reposto_por_script', 'user', $1, $2::jsonb)", [conta.id, JSON.stringify({ origem: "scripts/admin-totp-repor.mjs", sessoesTerminadas: sessoes })]);
  await q("commit");
  console.log(`\n✅ TOTP reposto para «${conta.username}»: ${sessoes} sessão(ões) terminada(s). A conta volta a entrar só com a palavra-passe até ativar de novo.`);
  await sair(0);
} catch (e) {
  try { await q("rollback"); } catch { /* ignora */ }
  console.error(`❌ Erro na base de dados (${e?.code ?? e?.name ?? "erro"}). Nada foi alterado.`);
  await sair(3);
}
