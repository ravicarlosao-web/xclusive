// Zera a área FINANCEIRA de contas de TESTE (lista explícita), para voltar ao ponto zero antes de entrar dinheiro real.
//
//   pnpm --filter @workspace/scripts exec tsx zerar-financeiro.mjs --contas fanteste,criadorteste                       (simulação)
//   pnpm --filter @workspace/scripts exec tsx zerar-financeiro.mjs --contas a,b --snapshot /caminho/fora/do/repo.json \
//        --confirmar --por <email do superadmin>                                                                         (executa)
//
// O que apaga (só linhas em que uma das contas da lista participa): compras e vendas (purchases), gorjetas de mensagem (message_tips, e a mensagem
// de gorjeta correspondente), gorjetas e bilhetes de lives, subscrições, levantamentos, carregamentos e as notificações financeiras
// (pagamento_recebido, gorjeta_recebida, nova_subscricao). Repõe a 0 users.saldo e users.ganhos dessas contas. NÃO toca em: contas, conteúdo,
// mensagens normais, platform_settings (comissão, mínimo de levantamento, dados bancários), aceitações legais, audit_log (só acrescenta o registo).
// Não há contadores financeiros agregados guardados: KPIs do painel e totais de comissão calculam-se em direto sobre purchases.
//
// Regras:
//  - Lista SEMPRE explícita (--contas a,b). Sem padrões. Contas admin/superadmin são recusadas.
//  - Simulação por defeito: nada é escrito (nem o snapshot). Mostra, por tabela, linhas e somas.
//  - TRAVA: se QUALQUER linha financeira envolver uma conta fora da lista (pagador, recetor, subscritor, criador, destinatário ou aprovador), aborta sem alterar nada e diz qual.
//    Aprovadores (processado_por / processed_by / retido_por) fora da lista só são aceites se os indicares com --aprovadores <contas> (ex.: o superadmin que aprovou).
//  - TRAVA 2: se saldo ou ganhos de uma conta não baterem com o que as linhas explicam (carregamentos aprovados − compras + ajustes; vendas líquidas − levantamentos
//    não rejeitados), aborta. --aceitar-diferenca ignora SÓ esta trava (fica no snapshot o valor anterior).
//  - Execução: exige --snapshot <caminho> (modo 0600, fora do repositório, ficheiro novo), --confirmar --por <superadmin>, um terminal e a frase exata. Uma só transação.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { calcularContas } from "./financeiro-formula.mjs";

const falha = (msg, codigo = 1) => { console.error(`❌ ${msg}`); process.exit(codigo); };
const COM_VALOR = new Set(["--contas", "--snapshot", "--por", "--aprovadores"]), SIMPLES = new Set(["--confirmar", "--aceitar-diferenca", "--ajuda", "-h"]);
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (COM_VALOR.has(a)) { if (i + 1 >= args.length || args[i + 1].startsWith("--")) falha(`A opção ${a} precisa de um valor.`, 2); opt[a] = args[++i]; }
  else if (SIMPLES.has(a)) opt[a] = true;
  else falha(`Argumento não reconhecido: ${a}.`, 2);
}
if (opt["--ajuda"] || opt["-h"]) { console.log("Uso: zerar-financeiro.mjs --contas a,b [--aprovadores x] [--snapshot caminho] [--confirmar --por <email do superadmin>] [--aceitar-diferenca]\n  Sem --confirmar é uma simulação (nada fica escrito)."); process.exit(0); }
const confirmar = !!opt["--confirmar"];

const lista = (v) => [...new Set(String(v ?? "").split(",").map((n) => n.trim()).filter(Boolean))];
const PADRAO = new Set(["todas", "todos", "all", "tudo", "everything"]);
const validarNomes = (nomes, rotulo) => {
  for (const n of nomes) {
    if (/[*%?\\\s]/.test(n) || PADRAO.has(n.toLowerCase())) falha(`«${n}» parece um padrão. ${rotulo} tem de ser explícita: um utilizador ou email por conta.`, 2);
    if (!/^[A-Za-z0-9_]{3,50}$/.test(n) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n)) falha(`«${n}» não é um nome de utilizador nem um email válido.`, 2);
  }
};
const nomes = lista(opt["--contas"]), nomesAprov = lista(opt["--aprovadores"]);
if (!nomes.length) falha("Indica a lista explícita de contas: --contas fanteste,criadorteste", 2);
if (nomes.length > 50) falha("Lista demasiado grande (máximo 50 contas).", 2);
validarNomes(nomes, "A lista"); validarNomes(nomesAprov, "A lista de aprovadores");
if (confirmar && !opt["--por"]) falha("Com --confirmar tens de indicar --por <email do superadmin que autoriza> (fica registado no audit_log).", 2);
if (confirmar && !opt["--snapshot"]) falha("A execução real exige --snapshot <caminho> (cópia das linhas que vão desaparecer). Recusado; nada foi alterado.", 2);
if (confirmar && !(process.stdin.isTTY && process.stdout.isTTY)) falha("A confirmação exige um terminal interativo (tens de escrever a frase exata).", 2);

// o snapshot nunca pode ficar dentro do repositório
let snapshotCaminho = null;
if (opt["--snapshot"]) {
  snapshotCaminho = path.resolve(opt["--snapshot"]);
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const dirReal = real(path.dirname(snapshotCaminho)), raizReal = real(raiz);
  if (dirReal === raizReal || dirReal.startsWith(raizReal + path.sep)) falha("O snapshot não pode ser escrito dentro do repositório. Escolhe um caminho fora dele.", 2);
  if (!fs.existsSync(path.dirname(snapshotCaminho))) falha("A pasta do snapshot não existe.", 2);
  if (fs.existsSync(snapshotCaminho)) falha("O ficheiro do snapshot já existe; não é sobrescrito. Escolhe um caminho novo.", 2);
}

let pool;
try { ({ pool } = await import("@workspace/db")); } catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`); }
const sair = async (codigo) => { try { await pool.end(); } catch { /* ignora */ } process.exit(codigo); };
const erroBd = (e) => `Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`;   // nunca a mensagem nem os parâmetros
const cliente = await pool.connect().catch(async (e) => { console.error(`❌ ${erroBd(e)}`); await sair(1); });
const q = (sql, p) => cliente.query(sql, p);
const reverter = async () => { try { await q("rollback"); } catch { /* ignora */ } };
const abortar = async (msg, codigo = 1) => { await reverter(); cliente.release(); console.error(`❌ ${msg}`); await sair(codigo); };
const NOTIF = ["pagamento_recebido", "gorjeta_recebida", "nova_subscricao"];
const fmt = (n) => Number(n ?? 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

try {
  await q("begin");
  const resolver = async (lst, rotulo) => {
    const mi = lst.map((n) => n.toLowerCase());
    const achadas = (await q("select id, username, email, role, saldo, ganhos from users where lower(username) = any($1) or lower(email) = any($1) order by id", [mi])).rows;
    const out = [];
    for (const n of mi) {
      const c = [...new Map(achadas.filter((a) => a.username.toLowerCase() === n || a.email.toLowerCase() === n).map((a) => [a.id, a])).values()];
      if (c.length === 0) await abortar(`${rotulo} «${lst[mi.indexOf(n)]}» não existe. Nada foi alterado.`);
      if (c.length > 1) await abortar(`${rotulo} «${lst[mi.indexOf(n)]}» identifica mais de uma conta. Nada foi alterado.`);
      out.push(c[0]);
    }
    return [...new Map(out.map((c) => [c.id, c])).values()].sort((a, b) => a.id - b.id);
  };
  const contas = await resolver(nomes, "A conta");
  const ids = contas.map((c) => c.id);
  const admins = contas.filter((c) => c.role === "admin" || c.role === "superadmin");
  if (admins.length) await abortar(`Recusado: contas de administração não se zeram por aqui (${admins.map((a) => `${a.username} [${a.role}]`).join(", ")}). Nada foi alterado.`);
  const aprov = nomesAprov.length ? await resolver(nomesAprov, "O aprovador") : [];
  const idsAprov = aprov.map((a) => a.id);
  let actor = null;
  if (confirmar) {
    actor = (await q("select id from users where lower(email) = lower($1) and role = 'superadmin'", [opt["--por"]])).rows[0]?.id;
    if (!actor) await abortar("--por tem de ser o email de um superadmin existente.", 2);
  }
  await q("select id from users where id = any($1) for update", [ids]);   // ninguém mexe nestas contas enquanto se decide
  const nome = async (id) => (await q("select username from users where id = $1", [id])).rows[0]?.username ?? `#${id}`;

  // ── linhas financeiras em que alguma das contas participa ──
  const sel = async (sql) => (await q(sql, [ids])).rows.map((r) => r.id);
  const ID = {
    purchases: await sel("select id from purchases where comprador_id = any($1) or vendedor_id = any($1)"),
    message_tips: await sel("select id from message_tips where remetente_id = any($1) or criador_id = any($1)"),
    live_tips: await sel("select t.id from live_tips t join live_streams s on s.id = t.stream_id where t.remetente_id = any($1) or s.criador_id = any($1)"),
    live_tickets: await sel("select t.id from live_tickets t join live_streams s on s.id = t.live_id where t.user_id = any($1) or s.criador_id = any($1)"),
    subscriptions: await sel("select id from subscriptions where subscritor_id = any($1) or criador_id = any($1)"),
    withdrawal_requests: await sel("select id from withdrawal_requests where creator_id = any($1) or processed_by = any($1) or retido_por = any($1)"),
    topup_requests: await sel("select id from topup_requests where user_id = any($1) or processado_por = any($1)"),
    ajustes_saldo: await sel("select id from ajustes_saldo where user_id = any($1) or admin_id = any($1)"),
  };
  // gorjetas/bilhetes cuja compra está no âmbito, mesmo que as partes sejam outras (a trava abaixo trata-as)
  const extra = async (tab, col, ref) => (await q(`select id from ${tab} where ${col} = any($1) and not (id = any($2))`, [ID.purchases, ID[ref]])).rows.map((r) => r.id);
  ID.message_tips.push(...await extra("message_tips", "purchase_id", "message_tips"));
  ID.live_tickets.push(...await extra("live_tickets", "purchase_id", "live_tickets"));
  ID.messages = (await q("select m.id from messages m where m.id in (select message_id from message_tips where id = any($1))", [ID.message_tips])).rows.map((r) => r.id);
  ID.notifications = (await q("select id from notifications where tipo::text = any($2) and (destinatario_id = any($1) or ator_id = any($1))", [ids, NOTIF])).rows.map((r) => r.id);

  // ── TRAVA 1: nenhuma linha financeira pode envolver contas fora da lista ──
  const fora = [];   // { tabela, papel, linhas, contaId }
  const partes = [
    ["purchases", "comprador", "select comprador_id as c, count(*)::int n from purchases where id = any($1) group by 1", false],
    ["purchases", "vendedor", "select vendedor_id as c, count(*)::int n from purchases where id = any($1) group by 1", false],
    ["message_tips", "remetente", "select remetente_id as c, count(*)::int n from message_tips where id = any($1) group by 1", false],
    ["message_tips", "criador", "select criador_id as c, count(*)::int n from message_tips where id = any($1) group by 1", false],
    ["live_tips", "remetente", "select remetente_id as c, count(*)::int n from live_tips where id = any($1) group by 1", false],
    ["live_tips", "criador da live", "select s.criador_id as c, count(*)::int n from live_tips t join live_streams s on s.id = t.stream_id where t.id = any($1) group by 1", false],
    ["live_tickets", "comprador", "select user_id as c, count(*)::int n from live_tickets where id = any($1) group by 1", false],
    ["live_tickets", "criador da live", "select s.criador_id as c, count(*)::int n from live_tickets t join live_streams s on s.id = t.live_id where t.id = any($1) group by 1", false],
    ["subscriptions", "subscritor", "select subscritor_id as c, count(*)::int n from subscriptions where id = any($1) group by 1", false],
    ["subscriptions", "criador", "select criador_id as c, count(*)::int n from subscriptions where id = any($1) group by 1", false],
    ["withdrawal_requests", "criador", "select creator_id as c, count(*)::int n from withdrawal_requests where id = any($1) group by 1", false],
    ["withdrawal_requests", "aprovador", "select processed_by as c, count(*)::int n from withdrawal_requests where id = any($1) and processed_by is not null group by 1", true],
    ["withdrawal_requests", "retido por", "select retido_por as c, count(*)::int n from withdrawal_requests where id = any($1) and retido_por is not null group by 1", true],
    ["topup_requests", "titular", "select user_id as c, count(*)::int n from topup_requests where id = any($1) group by 1", false],
    ["topup_requests", "aprovador", "select processado_por as c, count(*)::int n from topup_requests where id = any($1) and processado_por is not null group by 1", true],
    ["ajustes_saldo", "conta ajustada", "select user_id as c, count(*)::int n from ajustes_saldo where id = any($1) group by 1", false],
    ["ajustes_saldo", "admin do ajuste", "select admin_id as c, count(*)::int n from ajustes_saldo where id = any($1) group by 1", true],
  ];
  for (const [tabela, papel, sql, eAprovador] of partes) {
    for (const r of (await q(sql, [ID[tabela]])).rows) {
      if (ids.includes(r.c)) continue;
      if (eAprovador && idsAprov.includes(r.c)) continue;
      fora.push({ tabela, papel, linhas: r.n, c: r.c, eAprovador });
    }
  }
  const notifFora = (await q("select destinatario_id, ator_id from notifications where id = any($1)", [ID.notifications])).rows.filter((r) => (r.destinatario_id != null && !ids.includes(r.destinatario_id)) || (r.ator_id != null && !ids.includes(r.ator_id))).length;
  if (fora.length || notifFora) {
    console.error("❌ TRAVA: há dados financeiros que envolvem contas FORA da lista. Nada foi alterado.");
    for (const f of fora) console.error(`   - ${f.tabela}: ${f.linhas} linha(s) com ${f.papel} = «${await nome(f.c)}»${f.eAprovador ? " (se for um aprovador esperado, indica-o com --aprovadores)" : " (inclui-a em --contas ou resolve à mão)"}`);
    if (notifFora) console.error(`   - notifications: ${notifFora} notificação(ões) financeira(s) entre uma conta da lista e outra fora dela`);
    await abortar("Aborta sem alterar nada.");
  }
  // gorjetas de mensagem protegidas como prova (denunciadas/retiradas) não se apagam
  const prot = (await q("select count(*)::int n from messages m where m.id = any($1) and (m.retirado_em is not null or exists (select 1 from reports r where r.target_type = 'mensagem' and r.target_id = m.id and r.status in ('pendente','em_analise','procedente')))", [ID.messages])).rows[0].n;
  if (prot) await abortar(`TRAVA: ${prot} mensagem(ns) de gorjeta estão protegidas como prova (denunciadas ou retiradas). Nada foi alterado.`);

  // ── TRAVA 2: saldo e ganhos têm de bater com o que as linhas explicam ──
  const dif = (await calcularContas(q, ids)).filter((c) => c.emDesvio).map((c) => ({ c: contas.find((x) => x.id === c.id), ds: c.difSaldo, dg: c.difGanhos }));
  if (dif.length) {
    const msg = dif.map((d) => `   - ${d.c.username}: saldo difere ${fmt(d.ds)} Kz, ganhos difere ${fmt(d.dg)} Kz (guardado vs explicado pelas linhas)`).join("\n");
    if (!opt["--aceitar-diferenca"]) { console.error(`❌ TRAVA: saldo/ganhos que as linhas não explicam. Nada foi alterado.\n${msg}\n   (--aceitar-diferenca ignora só esta trava.)`); await abortar("Aborta sem alterar nada."); }
    console.log(`⚠️  Diferenças aceites com --aceitar-diferenca:\n${msg}`);
  }

  // ── relatório (linhas e somas) ──
  const soma = async (tab, col, idl) => Number((await q(`select coalesce(sum(${col}),0) s from ${tab} where id = any($1)`, [idl])).rows[0].s);
  const resumo = [
    ["purchases", ID.purchases.length, await soma("purchases", "valor", ID.purchases)],
    ["message_tips", ID.message_tips.length, await soma("message_tips", "valor", ID.message_tips)],
    ["messages (gorjetas)", ID.messages.length, null],
    ["live_tips", ID.live_tips.length, await soma("live_tips", "valor", ID.live_tips)],
    ["live_tickets", ID.live_tickets.length, await soma("live_tickets", "valor", ID.live_tickets)],
    ["subscriptions", ID.subscriptions.length, null],
    ["withdrawal_requests", ID.withdrawal_requests.length, await soma("withdrawal_requests", "amount", ID.withdrawal_requests)],
    ["topup_requests", ID.topup_requests.length, await soma("topup_requests", "amount", ID.topup_requests)],
    ["ajustes_saldo", ID.ajustes_saldo.length, await soma("ajustes_saldo", "valor", ID.ajustes_saldo)],
    ["notifications (financeiras)", ID.notifications.length, null],
  ];
  console.log(`Contas: ${contas.map((c) => c.username).join(", ")}`);
  console.log(`\n${confirmar ? "Vai ser apagado" : "Seria apagado"} (tabela: linhas, soma de valores):`);
  for (const [t, n, s] of resumo) console.log(`  ${t.padEnd(28)} ${String(n).padStart(6)}${s == null ? "" : `   soma ${fmt(s)}`}`);
  console.log(`\nSaldo e ganhos que ${confirmar ? "vão ser repostos" : "seriam repostos"} a 0:`);
  for (const c of contas) console.log(`  ${c.username.padEnd(20)} saldo ${fmt(c.saldo)}   ganhos ${fmt(c.ganhos)}`);

  if (!confirmar) {
    await reverter();
    console.log("\nSimulação concluída: nada foi escrito" + (snapshotCaminho ? " (nem o snapshot)" : "") + ". Para executar: --snapshot <caminho fora do repo> --confirmar --por <email do superadmin>.");
    cliente.release(); await sair(0);
  }

  // ── confirmar: frase exata ──
  const frase = `ZERAR FINANCEIRO DE ${contas.length} CONTA${contas.length === 1 ? "" : "S"}`;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await new Promise((res) => rl.question(`\nIsto apaga o historial financeiro de forma IRREVERSÍVEL (exceto pelo snapshot). Escreve exatamente «${frase}» para confirmar: `, (r) => { rl.close(); res(r.trim()); }));
  if (resposta !== frase) await abortar("Frase de confirmação errada. Nada foi alterado.");

  // ── snapshot (0600, ficheiro novo) ANTES de apagar ──
  const dump = { geradoEm: new Date().toISOString(), contas: contas.map((c) => ({ id: c.id, username: c.username, saldo: c.saldo, ganhos: c.ganhos })), tabelas: {} };
  for (const t of ["purchases", "message_tips", "messages", "live_tips", "live_tickets", "subscriptions", "withdrawal_requests", "topup_requests", "ajustes_saldo", "notifications"]) {
    dump.tabelas[t] = (await q(`select to_jsonb(x) as r from ${t} x where id = any($1) order by id`, [ID[t]])).rows.map((r) => r.r);
  }
  try {
    const fd = fs.openSync(snapshotCaminho, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(dump)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.chmodSync(snapshotCaminho, 0o600);
  } catch { await abortar("Não foi possível escrever o snapshot. Nada foi alterado."); }
  console.log(`Snapshot escrito (modo 0600). Guarda-o em local seguro; contém dados pessoais.`);

  // ── apagar, por ordem (RESTRICT/NO ACTION: filhos antes dos pais) ──
  const apagados = {};
  const del = async (tab, idl) => { const r = await q(`delete from ${tab} where id = any($1)`, [idl]); apagados[tab] = r.rowCount; if (r.rowCount !== idl.length) throw Object.assign(new Error("contagem"), { code: "CONTAGEM" }); };
  await del("notifications", ID.notifications);
  await del("message_tips", ID.message_tips);      // RESTRICT → messages, purchases
  await del("messages", ID.messages);
  await del("live_tips", ID.live_tips);
  await del("live_tickets", ID.live_tickets);
  await del("subscriptions", ID.subscriptions);
  await del("purchases", ID.purchases);
  await del("withdrawal_requests", ID.withdrawal_requests);   // NO ACTION → users
  await del("topup_requests", ID.topup_requests);
  await del("ajustes_saldo", ID.ajustes_saldo);
  await q("update users set saldo = 0, ganhos = 0 where id = any($1)", [ids]);

  // verificação final dentro da transação: tudo a zero, senão reverte
  const resto = (await q(`select
    (select count(*)::int from purchases where comprador_id = any($1) or vendedor_id = any($1)) +
    (select count(*)::int from message_tips where remetente_id = any($1) or criador_id = any($1)) +
    (select count(*)::int from subscriptions where subscritor_id = any($1) or criador_id = any($1)) +
    (select count(*)::int from withdrawal_requests where creator_id = any($1)) +
    (select count(*)::int from topup_requests where user_id = any($1)) +
    (select count(*)::int from ajustes_saldo where user_id = any($1)) +
    (select count(*)::int from users where id = any($1) and (saldo <> 0 or ganhos <> 0)) as n`, [ids])).rows[0].n;
  if (resto) throw Object.assign(new Error("resto"), { code: "RESTO" });

  await q("insert into audit_log (admin_id, action, target_type, details) values ($1, 'financeiro_zerado', 'platform', $2::jsonb)", [actor, JSON.stringify({ contas: contas.length, linhas: apagados, origem: "scripts/zerar-financeiro.mjs" })]);
  await q("commit");
  console.log(`✅ Financeiro zerado em ${contas.length} conta(s). Registado no audit_log (quem autorizou, quando, contagens).`);
  cliente.release(); await sair(0);
} catch (e) {
  await reverter(); cliente.release();
  console.error(`❌ ${e?.code === "CONTAGEM" || e?.code === "RESTO" ? "Verificação interna falhou." : erroBd(e)} Nada foi alterado na base de dados.${snapshotCaminho && fs.existsSync(snapshotCaminho) ? " (O ficheiro de snapshot já tinha sido escrito; podes apagá-lo.)" : ""}`);
  await sair(1);
}
