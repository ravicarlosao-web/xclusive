// Apaga contas de TESTE (e os dados delas) de uma LISTA EXPLÍCITA. Simulação por defeito: só com --confirmar apaga.
//
//   pnpm --filter @workspace/scripts exec tsx apagar-contas-teste.mjs <utilizador|email> [...] [--ficheiro lista.txt]                      (simulação)
//   pnpm --filter @workspace/scripts exec tsx apagar-contas-teste.mjs <...> --confirmar --por <email do superadmin>                      (apaga)
//
// Regras:
//  - A lista é SEMPRE explícita (utilizadores ou emails, por argumentos e/ou num ficheiro com um por linha; # comenta). Nunca padrões: «*», «%», «?» e palavras como «todas» são recusados.
//    Cada nome tem de existir e identificar UMA conta; senão recusa tudo. Contas fora da lista nunca são tocadas.
//  - Recusa contas com role admin ou superadmin (ex.: o superadmin e os admins reais). Para apagar um admin de teste, despromove-o primeiro (e nunca por este script).
//  - Simulação (por defeito): faz TODO o apagamento dentro de uma transação e DESFAZ-A no fim (nada fica escrito); mostra, por conta, as linhas apagadas por tabela (incluindo as
//    cascatas) e os ficheiros de armazenamento associados. Com --confirmar mostra o mesmo, pede que escrevas o NÚMERO EXATO de contas e só então grava (uma só transação: se algo
//    falhar, nada é apagado). --por (obrigatório com --confirmar) é o superadmin que fica registado no audit_log (só: quem, quantas contas, quando; sem dados pessoais).
//  - Bloqueios DUROS (a conta é recusada, sem opção): menor_cases; conteúdo protegido como prova (denunciado ou retirado: os triggers da BD impedem o apagamento); movimentos financeiros
//    ou compras/subscrições/gorjetas com contas FORA da lista (apagá-los alteraria o histórico de outra conta); referências por tratar a contas administrativas.
//  - Bloqueios com opção: --incluir-financeiro (a conta tem movimentos financeiros ou saldo: compras, subscrições, carregamentos, levantamentos, gorjetas) e
//    --incluir-auditoria-propria (a conta é autora de linhas do audit_log, que apontam para ela e impedem o apagamento).
//  - Também apaga os likes (de outras contas) que apontam para o conteúdo das contas apagadas (a tabela não tem chave estrangeira; a aplicação também os apaga com o post).
//  - Ficheiros (Bunny): este script NÃO os apaga nem usa chaves; lista as chaves relativas (sem URL, sem segredos) para tu os apagares: --lista-ficheiros <caminho> grava-as num ficheiro.
//  - Liga à base de dados pela configuração que a aplicação já usa (@workspace/db: DATABASE_URL / .env); não imprime a ligação nem segredos.
import fs from "node:fs";
import readline from "node:readline";

const falha = (msg, codigo = 1) => { console.error(`❌ ${msg}`); process.exit(codigo); };
const OPCOES_COM_VALOR = new Set(["--ficheiro", "--por", "--lista-ficheiros"]), OPCOES_SIMPLES = new Set(["--confirmar", "--incluir-financeiro", "--incluir-auditoria-propria", "--ajuda", "-h"]);

// ── argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2), posicionais = [], opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (OPCOES_COM_VALOR.has(a)) { if (i + 1 >= args.length || args[i + 1].startsWith("--")) falha(`A opção ${a} precisa de um valor.`, 2); opt[a] = args[++i]; }
  else if (OPCOES_SIMPLES.has(a)) opt[a] = true;
  else if (a.startsWith("-")) falha(`Opção não reconhecida: ${a}.`, 2);
  else posicionais.push(a);
}
if (opt["--ajuda"] || opt["-h"]) { console.log("Uso: apagar-contas-teste.mjs <utilizador|email> [...] [--ficheiro lista.txt] [--confirmar --por <email do superadmin>] [--incluir-financeiro] [--incluir-auditoria-propria] [--lista-ficheiros caminho]\n  Sem --confirmar é uma simulação (nada fica escrito). Só lista explícita; nunca padrões."); process.exit(0); }
const confirmar = !!opt["--confirmar"], incluirFinanceiro = !!opt["--incluir-financeiro"], incluirAuditoria = !!opt["--incluir-auditoria-propria"];

let nomes = [...posicionais];
if (opt["--ficheiro"]) {
  let texto; try { texto = fs.readFileSync(opt["--ficheiro"], "utf8"); } catch { falha("Não foi possível ler o ficheiro da lista.", 2); }
  nomes.push(...texto.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean));
}
nomes = [...new Set(nomes.map((n) => n.trim()).filter(Boolean))];
if (!nomes.length) falha("Indica a lista explícita de contas a apagar (utilizadores ou emails, por argumentos ou com --ficheiro).", 2);
if (nomes.length > 200) falha("Lista demasiado grande (máximo 200 contas por execução).", 2);
const PALAVRAS_PADRAO = new Set(["todas", "todos", "all", "tudo", "everything"]);
for (const n of nomes) {
  if (/[*%?\\\s]/.test(n) || PALAVRAS_PADRAO.has(n.toLowerCase())) falha(`«${n}» parece um padrão. A lista tem de ser explícita: um utilizador ou email por conta, sem «*», «%», «?» nem «todas».`, 2);
  if (!/^[A-Za-z0-9_]{3,50}$/.test(n) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n)) falha(`«${n}» não é um nome de utilizador nem um email válido.`, 2);
}
if (confirmar && !opt["--por"]) falha("Com --confirmar tens de indicar --por <email do superadmin que autoriza> (fica registado no audit_log).", 2);
if (confirmar && !process.stdin.isTTY) falha("A confirmação exige um terminal interativo (tens de escrever o número de contas).", 2);

// ── base de dados ────────────────────────────────────────────────────────────
let pool;
try { ({ pool } = await import("@workspace/db")); } catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`); }
const destino = (() => { try { const h = new URL(pool.options.connectionString).hostname; return h === "localhost" || h === "127.0.0.1" ? "local" : "remota"; } catch { return "configurada"; } })();
const sair = async (codigo) => { try { await pool.end(); } catch { /* ignora */ } process.exit(codigo); };
const erroBd = (e) => `Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`;   // nunca a mensagem nem os parâmetros
const cliente = await pool.connect().catch(async (e) => { console.error(`❌ ${erroBd(e)}`); await sair(1); });
const q = (sql, p) => cliente.query(sql, p);
const reverter = async () => { try { await q("rollback"); } catch { /* ignora */ } };
const abortar = async (msg, codigo = 1) => { await reverter(); cliente.release(); console.error(`❌ ${msg}`); await sair(codigo); };

try {
  await q("begin");
  // ── resolver a lista: cada nome tem de identificar UMA conta existente ──
  const minusculas = nomes.map((n) => n.toLowerCase());
  const achadas = (await q("select id, username, email, role, saldo, ganhos from users where lower(username) = any($1) or lower(email) = any($1) order by id", [minusculas])).rows;
  const porNome = new Map();
  for (const n of minusculas) {
    const c = achadas.filter((a) => a.username.toLowerCase() === n || a.email.toLowerCase() === n);
    const ids = [...new Set(c.map((a) => a.id))];
    if (ids.length === 0) await abortar(`A conta «${nomes[minusculas.indexOf(n)]}» não existe. Nada foi alterado.`);
    if (ids.length > 1) await abortar(`«${nomes[minusculas.indexOf(n)]}» identifica mais de uma conta. Nada foi alterado.`);
    porNome.set(n, c[0]);
  }
  const contas = [...new Map([...porNome.values()].map((c) => [c.id, c])).values()].sort((a, b) => a.id - b.id);
  const ids = contas.map((c) => c.id);
  const admins = contas.filter((c) => c.role === "admin" || c.role === "superadmin");
  if (admins.length) await abortar(`Recusado: contas de administração não se apagam por aqui (${admins.map((a) => `${a.username} [${a.role}]`).join(", ")}). Nada foi alterado.`);

  let actor = null;
  if (confirmar) {
    actor = (await q("select id from users where lower(email) = lower($1) and role = 'superadmin'", [opt["--por"]])).rows[0]?.id;
    if (!actor) await abortar("--por tem de ser o email de um superadmin existente.", 2);
  }
  await q("select id from users where id = any($1) for update", [ids]);   // ninguém altera estas contas enquanto se decide

  // ── bloqueios ──────────────────────────────────────────────────────────────
  const duros = [], opcao = [];   // { conta, motivo }
  const nome = (id) => contas.find((c) => c.id === id)?.username ?? `#${id}`;
  const dur = (id, motivo) => duros.push({ conta: id, motivo });
  const cnt = async (sql, p = [ids]) => (await q(sql, p)).rows;

  // referências por chave estrangeira com RESTRICT / NO ACTION: as conhecidas tratam-se abaixo; qualquer outra é um bloqueio duro (não se adivinha)
  const TRATADAS = new Set(["account_closures.user_id", "creator_terms_acceptances.user_id", "identifier_blocks.user_id", "infracoes_mais18.user_id", "withdrawal_requests.creator_id", "message_tips.criador_id", "message_tips.remetente_id", "audit_log.admin_id"]);
  const fks = (await q("select c.conrelid::regclass::text as tabela, a.attname as coluna from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.confrelid = 'users'::regclass and c.confdeltype in ('r', 'a')")).rows;
  for (const { tabela, coluna } of fks) {
    if (/^menor_cases\./.test(`${tabela}.${coluna}`)) {
      for (const r of await cnt(`select ${coluna} as id, count(*)::int as n from ${tabela} where ${coluna} = any($1) group by 1`)) dur(r.id, `tem casos de menores associados (${tabela}.${coluna}: ${r.n}); nunca se apagam`);
    } else if (!TRATADAS.has(`${tabela}.${coluna}`)) {
      for (const r of await cnt(`select ${coluna} as id, count(*)::int as n from ${tabela} where ${coluna} = any($1) group by 1`)) dur(r.id, `é referenciada em ${tabela}.${coluna} (${r.n} linhas) e o script não trata essa tabela`);
    }
  }
  // conteúdo protegido como prova (os triggers da BD recusariam o apagamento)
  for (const [tabela, dono, tipo] of [["posts", "autor_id", "post"], ["stories", "autor_id", "story"], ["comments", "autor_id", "comment"], ["messages", "autor_id", "mensagem"], ["live_streams", "criador_id", "live"]]) {
    const linhas = (await q(`select t.${dono} as id, count(*)::int as n from ${tabela} t where t.${dono} = any($1) and (t.retirado_em is not null or exists (select 1 from reports r where r.target_type::text = $2 and r.target_id = t.id and ((r.reason = 'menor' and r.status in ('pendente', 'em_analise', 'procedente')) or r.status in ('pendente', 'em_analise')))) group by 1`, [ids, tipo])).rows;
    for (const r of linhas) dur(r.id, `tem ${r.n} ${tabela} protegidos como prova (denunciados ou retirados); os triggers da base de dados impedem o apagamento`);
  }
  // movimentos com contas FORA da lista (apagá-los alteraria o histórico de outra conta)
  const fora = (a, b, tabela, extra = "") => `select ${a} as a, ${b} as b, count(*)::int as n from ${tabela} ${extra} where (${a} = any($1) and coalesce(${b}, 0) <> all($1)) or (${b} = any($1) and coalesce(${a}, 0) <> all($1)) group by 1, 2`;
  for (const [a, b, tabela, rotulo] of [["comprador_id", "vendedor_id", "purchases", "compras/vendas"], ["subscritor_id", "criador_id", "subscriptions", "subscrições"], ["remetente_id", "criador_id", "message_tips", "gorjetas em mensagens"]]) {
    for (const r of (await q(fora(a, b, tabela), [ids])).rows) { const dentro = ids.includes(r.a) ? r.a : r.b; dur(dentro, `tem ${r.n} ${rotulo} com uma conta FORA da lista (${ids.includes(r.a) ? "outra parte" : "a outra parte"} não está na lista)`); }
  }
  for (const r of (await q("select lt.user_id as a, ls.criador_id as b, count(*)::int as n from live_tickets lt join live_streams ls on ls.id = lt.live_id where (lt.user_id = any($1) and ls.criador_id <> all($1)) or (ls.criador_id = any($1) and lt.user_id <> all($1)) group by 1, 2", [ids])).rows) dur(ids.includes(r.a) ? r.a : r.b, `tem ${r.n} bilhetes de live com uma conta FORA da lista`);
  for (const r of (await q("select lt.remetente_id as a, ls.criador_id as b, count(*)::int as n from live_tips lt join live_streams ls on ls.id = lt.stream_id where (lt.remetente_id = any($1) and ls.criador_id <> all($1)) or (ls.criador_id = any($1) and lt.remetente_id <> all($1)) group by 1, 2", [ids])).rows) dur(ids.includes(r.a) ? r.a : r.b, `tem ${r.n} gorjetas de live com uma conta FORA da lista`);

  // bloqueios com opção
  const fin = (await q(`select u.id,
      (select count(*) from purchases p where p.comprador_id = u.id or p.vendedor_id = u.id)::int
      + (select count(*) from subscriptions s where s.subscritor_id = u.id or s.criador_id = u.id)::int
      + (select count(*) from topup_requests t where t.user_id = u.id)::int
      + (select count(*) from withdrawal_requests w where w.creator_id = u.id)::int
      + (select count(*) from message_tips m where m.remetente_id = u.id or m.criador_id = u.id)::int
      + (select count(*) from live_tips l where l.remetente_id = u.id)::int
      + (select count(*) from live_tickets k where k.user_id = u.id)::int as n, (u.saldo <> 0 or u.ganhos <> 0) as saldo
    from users u where u.id = any($1)`, [ids])).rows;
  if (!incluirFinanceiro) for (const r of fin) if (r.n > 0 || r.saldo) opcao.push({ conta: r.id, motivo: `tem movimentos financeiros (${r.n} linhas${r.saldo ? ", saldo ou ganhos ≠ 0" : ""}); para os apagar junto usa --incluir-financeiro` });
  const aud = (await q("select admin_id as id, count(*)::int as n from audit_log where admin_id = any($1) group by 1", [ids])).rows;
  if (!incluirAuditoria) for (const r of aud) opcao.push({ conta: r.id, motivo: `é autora de ${r.n} linhas do audit_log; para as apagar com a conta usa --incluir-auditoria-propria` });

  const bloqueadas = [...new Set([...duros, ...opcao].map((b) => b.conta))];
  if (bloqueadas.length) {
    console.log(`Contas recusadas (${bloqueadas.length} de ${contas.length}):`);
    for (const id of bloqueadas) { console.log(`  ${nome(id)}`); for (const b of [...duros, ...opcao].filter((x) => x.conta === id)) console.log(`    - ${b.motivo}`); }
    await abortar("Nada foi apagado. Corrige a lista (ou usa as opções indicadas) e repete.");
  }

  // ── ficheiros de armazenamento associados (chaves relativas; sem URLs nem segredos) ──
  const chaveDe = (v) => { if (!v) return null; try { if (/^https?:\/\//i.test(v)) return new URL(v).pathname.replace(/^\/+/, ""); } catch { return null; } return String(v).split("?")[0].replace(/^\/+/, ""); };
  const FONTES = [["users.avatar_url", "select id as dono, avatar_url as v from users where id = any($1)"], ["users.capa_url", "select id as dono, capa_url as v from users where id = any($1)"],
    ["post_media.url", "select p.autor_id as dono, m.url as v from post_media m join posts p on p.id = m.post_id where p.autor_id = any($1)"], ["stories.media_url", "select autor_id as dono, media_url as v from stories where autor_id = any($1)"],
    ["messages.media_url", "select autor_id as dono, media_url as v from messages where autor_id = any($1)"], ["highlights.capa_url", "select utilizador_id as dono, capa_url as v from highlights where utilizador_id = any($1)"],
    ["kyc_submissions.documento_key", "select user_id as dono, documento_key as v from kyc_submissions where user_id = any($1)"], ["kyc_submissions.selfie_key", "select user_id as dono, selfie_key as v from kyc_submissions where user_id = any($1)"],
    ["kyc_submissions.liveness_key", "select user_id as dono, liveness_key as v from kyc_submissions where user_id = any($1)"]];
  const ficheiros = new Map();   // dono -> Map(chave -> origem)
  for (const [origem, sql] of FONTES) for (const r of (await q(sql, [ids])).rows) { const k = chaveDe(r.v); if (!k) continue; if (!ficheiros.has(r.dono)) ficheiros.set(r.dono, new Map()); ficheiros.get(r.dono).set(k, origem); }

  // ── apagar (dentro da transação; em simulação desfaz-se no fim) ──
  const snap = async () => Object.fromEntries((await q("select relname, n_tup_del::int as d from pg_stat_xact_user_tables")).rows.map((r) => [r.relname, r.d]));
  const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - (a[k] ?? 0)]).filter(([, n]) => n > 0));
  const conversas = (await q("select distinct conversation_id as id from conversation_participants where utilizador_id = any($1)", [ids])).rows.map((r) => r.id);
  const resultado = [], falhas = [];
  let s0 = await snap();
  await q("delete from message_tips where criador_id = any($1) or remetente_id = any($1)", [ids]);   // RESTRICT: gorjetas entre contas da lista
  let s1 = await snap(); const partilhado = diff(s0, s1); s0 = s1;
  for (const c of contas) {
    await q("savepoint conta");
    try {
      // likes são polimórficos (alvo_tipo/alvo_id, sem chave estrangeira): a aplicação apaga os likes de um post com o post; aqui apagam-se os que apontam para conteúdo desta conta
      await q("delete from likes where alvo_tipo = 'post' and alvo_id in (select id from posts where autor_id = $1)", [c.id]);
      await q("delete from likes where alvo_tipo in ('comentario', 'comment') and alvo_id in (select id from comments where autor_id = $1 or post_id in (select id from posts where autor_id = $1))", [c.id]);
      await q("delete from account_closures where user_id = $1", [c.id]);
      await q("delete from creator_terms_acceptances where user_id = $1", [c.id]);
      await q("delete from identifier_blocks where user_id = $1", [c.id]);
      await q("delete from infracoes_mais18 where user_id = $1", [c.id]);
      await q("delete from withdrawal_requests where creator_id = $1", [c.id]);
      if (incluirAuditoria) await q("delete from audit_log where admin_id = $1", [c.id]);
      await q("delete from users where id = $1", [c.id]);
      await q("release savepoint conta");
      s1 = await snap(); resultado.push({ conta: c, apagadas: diff(s0, s1) }); s0 = s1;
    } catch (e) {
      await q("rollback to savepoint conta"); s0 = await snap();
      falhas.push({ conta: c, motivo: /prova_protegida/.test(e?.message ?? "") ? "conteúdo protegido como prova (os triggers da base de dados recusam)" : `erro da base de dados (${e?.code ?? "erro"})` });
    }
  }
  // conversas que ficaram sem ninguém (só as que tinham participantes da lista)
  if (conversas.length) await q("delete from conversations c where c.id = any($1) and not exists (select 1 from conversation_participants p where p.conversation_id = c.id)", [conversas]);
  s1 = await snap(); const conversasVazias = diff(s0, s1);
  if (falhas.length) {
    for (const f of falhas) console.log(`  ✗ ${f.conta.username}: ${f.motivo}`);
    await abortar("Falhou o apagamento de pelo menos uma conta: NADA foi apagado (transação desfeita).");
  }
  const nUsers = resultado.reduce((n, r) => n + (r.apagadas.users ?? 0), 0);
  if (nUsers !== contas.length) await abortar(`Verificação falhou: ${nUsers} contas apagadas em vez de ${contas.length}. NADA foi apagado (transação desfeita).`);

  // ── relatório ──
  console.log(`${confirmar ? "APAGAR" : "SIMULAÇÃO (nada será escrito)"} — ${contas.length} conta(s), base de dados ${destino}.\n`);
  const fmt = (o) => Object.entries(o).filter(([k]) => k !== "users").sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}=${n}`).join("  ") || "—";
  for (const r of resultado) {
    console.log(`• ${r.conta.username} (id ${r.conta.id}, role ${r.conta.role})`);
    console.log(`    linhas apagadas: ${fmt(r.apagadas)}`);
    const fs_ = ficheiros.get(r.conta.id); console.log(`    ficheiros de armazenamento: ${fs_ ? fs_.size : 0}`);
  }
  if (Object.keys(partilhado).length) console.log(`• gorjetas entre contas da lista: ${fmt(partilhado)}`);
  if (Object.keys(conversasVazias).length) console.log(`• conversas que ficam vazias: ${fmt(conversasVazias)}`);
  const totalFich = new Set([...ficheiros.values()].flatMap((m) => [...m.keys()]));
  console.log(`\nFicheiros no armazenamento (Bunny) a apagar À MÃO (este script não os apaga nem usa chaves): ${totalFich.size}`);
  for (const [dono, m] of ficheiros) { if (m.size) console.log(`  ${nome(dono)}:`); for (const [k, origem] of m) console.log(`    ${k}   (${origem})`); }
  if (opt["--lista-ficheiros"]) { fs.writeFileSync(opt["--lista-ficheiros"], [...totalFich].join("\n") + (totalFich.size ? "\n" : ""), { mode: 0o600 }); console.log(`Lista gravada em ${opt["--lista-ficheiros"]}.`); }

  if (!confirmar) {
    await reverter();
    console.log("\nSimulação concluída: nada foi apagado. Para apagar repete com --confirmar --por <email do superadmin>.");
    cliente.release(); await sair(0);
  }
  // ── confirmar: o número EXATO de contas ──
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await new Promise((res) => rl.question(`\nVais apagar ${contas.length} conta(s) de forma IRREVERSÍVEL. Escreve o número exato de contas para confirmar: `, (r) => { rl.close(); res(r.trim()); }));
  if (resposta !== String(contas.length)) await abortar("Número de confirmação errado. Nada foi apagado.");
  await q("insert into audit_log (admin_id, action, target_type, details) values ($1, 'contas_teste_apagadas', 'platform', $2::jsonb)", [actor, JSON.stringify({ contas: contas.length, origem: "scripts/apagar-contas-teste.mjs", incluirFinanceiro, incluirAuditoriaPropria: incluirAuditoria })]);
  await q("commit");
  console.log(`✅ ${contas.length} conta(s) apagada(s). Registado no audit_log (quem autorizou, quantas, quando).`);
  cliente.release(); await sair(0);
} catch (e) {
  await reverter(); cliente.release();
  console.error(`❌ ${erroBd(e)} Nada foi apagado.`); await sair(1);
}
