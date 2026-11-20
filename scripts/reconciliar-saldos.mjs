// RECONCILIAÇÃO de saldos e ganhos (SÓ DE LEITURA). Compara, para TODAS as contas, o saldo e os ganhos guardados com o que as linhas financeiras explicam (a MESMA fórmula do
// zerar-financeiro, em scripts/financeiro-formula.mjs, incluindo os ajustes de admin da tabela ajustes_saldo).
//
//   pnpm --filter @workspace/scripts exec tsx reconciliar-saldos.mjs [--json] [--incluir-audit-legado]
//
// Também aponta: saldo ou ganhos negativos; carregamentos aprovados sem marca de aprovação (suspeitos de não terem crédito ou de terem sido aprovados à mão); linhas financeiras que
// apontam para contas ou lives que não existem. Saída com código 0 = tudo certo; 1 = há desvios ou achados; 2 = erro de uso; 3 = erro de ligação à base de dados. NUNCA escreve:
// corre numa transação READ ONLY (a própria base de dados recusa qualquer escrita) e só faz SELECTs. Não imprime a ligação nem segredos.
import { calcularContas } from "./financeiro-formula.mjs";

const falha = (msg, codigo = 2) => { console.error(`❌ ${msg}`); process.exit(codigo); };
const args = process.argv.slice(2), opt = {};
for (const a of args) { if (a === "--json" || a === "--incluir-audit-legado" || a === "--ajuda" || a === "-h") opt[a] = true; else falha(`Argumento não reconhecido: ${a}.`); }
if (opt["--ajuda"] || opt["-h"]) { console.log("Uso: reconciliar-saldos.mjs [--json] [--incluir-audit-legado]\n  Só leitura. Código de saída 0 = sem desvios; 1 = desvios ou achados."); process.exit(0); }

let pool;
try { ({ pool } = await import("@workspace/db")); } catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`, 3); }
const sair = async (codigo) => { try { await pool.end(); } catch { /* ignora */ } process.exit(codigo); };
const cliente = await pool.connect().catch(async (e) => { console.error(`❌ Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`); await sair(3); });
const q = (sql, p) => cliente.query(sql, p);
const fmt = (n) => Number(n).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// FKs lógicas das linhas financeiras para contas e lives: se uma linha apontar para algo que já não existe, é um achado (as FKs reais já o impedem; isto apanha constraints em falta)
const REFS = [
  ["purchases", "comprador_id", "users"], ["purchases", "vendedor_id", "users"], ["subscriptions", "subscritor_id", "users"], ["subscriptions", "criador_id", "users"],
  ["live_tips", "remetente_id", "users"], ["live_tips", "stream_id", "live_streams"], ["live_tickets", "user_id", "users"], ["live_tickets", "live_id", "live_streams"],
  ["message_tips", "remetente_id", "users"], ["message_tips", "criador_id", "users"], ["topup_requests", "user_id", "users"], ["withdrawal_requests", "creator_id", "users"],
  ["ajustes_saldo", "user_id", "users"], ["ajustes_saldo", "admin_id", "users"],
];

try {
  await q("begin transaction isolation level repeatable read read only");   // leitura consistente e escrita impossível
  const contas = await calcularContas(q, null, { ajustesAuditLegado: !!opt["--incluir-audit-legado"] });
  const desvios = contas.filter((c) => c.emDesvio);
  const negativos = contas.filter((c) => c.saldoGuardado < 0 || c.ganhosGuardados < 0).map((c) => ({ id: c.id, username: c.username, saldo: c.saldoGuardado, ganhos: c.ganhosGuardados }));
  const semMarca = (await q(`select t.id, t.user_id, t.amount::float8 as amount, t.payment_method from topup_requests t
      where t.status = 'aprovado' and t.payment_method not in ('gpo', 'ref', 'kursipay')
        and not exists (select 1 from audit_log a where a.action = 'topup_approved' and a.target_type = 'topup' and a.target_id = t.id) order by t.id`)).rows;
  const orfas = [];
  for (const [tabela, coluna, ref] of REFS) {
    const n = (await q(`select count(*)::int as n from ${tabela} x where x.${coluna} is not null and not exists (select 1 from ${ref} r where r.id = x.${coluna})`)).rows[0].n;
    if (n > 0) orfas.push({ tabela, coluna, referencia: ref, linhas: n });
  }
  await q("rollback");   // nada a gravar: só termina a transação de leitura
  const achados = desvios.length + negativos.length + semMarca.length + orfas.length;
  const resumo = { contas: contas.length, emDesvio: desvios.length, saldosNegativos: negativos.length, carregamentosSemMarca: semMarca.length, referenciasOrfas: orfas.length, ok: achados === 0 };

  if (opt["--json"]) {
    console.log(JSON.stringify({ resumo, desvios: desvios.map(({ id, username, saldoGuardado, saldoCalculado, difSaldo, ganhosGuardados, ganhosCalculados, difGanhos }) => ({ id, username, saldoGuardado, saldoCalculado, difSaldo, ganhosGuardados, ganhosCalculados, difGanhos })), negativos, carregamentosSemMarca: semMarca, referenciasOrfas: orfas }, null, 2));
  } else {
    console.log(`Reconciliação (só leitura): ${contas.length} conta(s) verificadas.\n`);
    if (desvios.length) {
      console.log("Contas em DESVIO (guardado − calculado):");
      console.log("  id".padEnd(8) + "username".padEnd(24) + "saldo guardado".padStart(16) + "calculado".padStart(14) + "dif.".padStart(12) + "   ganhos guardados".padStart(20) + "calculado".padStart(14) + "dif.".padStart(12));
      for (const c of desvios) console.log(`  ${String(c.id).padEnd(6)}${c.username.padEnd(24)}${fmt(c.saldoGuardado).padStart(16)}${fmt(c.saldoCalculado).padStart(14)}${fmt(c.difSaldo).padStart(12)}   ${fmt(c.ganhosGuardados).padStart(16)}${fmt(c.ganhosCalculados).padStart(14)}${fmt(c.difGanhos).padStart(12)}`);
      console.log("");
    }
    if (negativos.length) { console.log("Saldo ou ganhos NEGATIVOS:"); for (const n of negativos) console.log(`  ${n.id}  ${n.username}  saldo ${fmt(n.saldo)}  ganhos ${fmt(n.ganhos)}`); console.log(""); }
    if (semMarca.length) { console.log("Carregamentos aprovados SEM marca de aprovação (nem registo do admin nem pagamento automático): confirma se o saldo foi creditado:"); for (const t of semMarca) console.log(`  topup #${t.id}  conta #${t.user_id}  ${fmt(t.amount)} Kz  (${t.payment_method})`); console.log(""); }
    if (orfas.length) { console.log("Linhas financeiras que apontam para contas/lives INEXISTENTES:"); for (const o of orfas) console.log(`  ${o.tabela}.${o.coluna} → ${o.referencia}: ${o.linhas} linha(s)`); console.log(""); }
    console.log(`Resumo: ${resumo.contas} contas; em desvio ${resumo.emDesvio}; saldos negativos ${resumo.saldosNegativos}; carregamentos sem marca ${resumo.carregamentosSemMarca}; referências órfãs ${resumo.referenciasOrfas}.`);
    console.log(resumo.ok ? "✅ Tudo certo: os saldos batem com as linhas." : "⚠️  Há desvios ou achados (código de saída 1).");
  }
  cliente.release(); await sair(resumo.ok ? 0 : 1);
} catch (e) {
  try { await q("rollback"); } catch { /* ignora */ } cliente.release();
  console.error(`❌ Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`); await sair(3);
}
