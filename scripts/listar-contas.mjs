// Lista TODAS as contas (SÓ LEITURA): id, utilizador, email, role, ativa, criada em, último login, Google ligado e o número de linhas associadas por tipo.
//
//   pnpm --filter @workspace/scripts exec tsx listar-contas.mjs
//
// Nunca mostra hashes, tokens, documentos nem outros dados sensíveis. Liga à base de dados pela configuração que a aplicação já usa (@workspace/db: DATABASE_URL / .env);
// não imprime a ligação nem segredos. Não escreve nada (só um SELECT, numa transação de leitura).
const falha = (msg, codigo = 1) => { console.error(`❌ ${msg}`); process.exit(codigo); };
const args = process.argv.slice(2);
if (args.includes("--ajuda") || args.includes("-h")) { console.log("Uso: listar-contas.mjs   (sem opções; só leitura)"); process.exit(0); }
if (args.length) falha(`Opção não reconhecida: ${args.join(" ")}. Este script não tem opções.`, 2);

let pool;
try { ({ pool } = await import("@workspace/db")); } catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`); }
const destino = (() => { try { const h = new URL(pool.options.connectionString).hostname; return h === "localhost" || h === "127.0.0.1" ? "local" : "remota"; } catch { return "configurada"; } })();

const SQL = `
  select u.id, u.username, u.email, u.role, u.ativo, u.criado_em,
    greatest((select max(a.criada_em) from active_sessions a where a.user_id = u.id), (select max(s.criada_em) from admin_sessoes s where s.user_id = u.id), (select max(g.ultimo_login_em) from user_google_identities g where g.user_id = u.id)) as ultimo_login,
    exists (select 1 from user_google_identities g where g.user_id = u.id) as google,
    (select count(*) from posts p where p.autor_id = u.id)::int as posts,
    (select count(*) from stories s where s.autor_id = u.id)::int as stories,
    (select count(*) from comments c where c.autor_id = u.id)::int as comentarios,
    (select count(*) from messages m where m.autor_id = u.id)::int as mensagens,
    (select count(*) from purchases p where p.comprador_id = u.id or p.vendedor_id = u.id)::int as compras_vendas,
    (select count(*) from subscriptions s where s.subscritor_id = u.id or s.criador_id = u.id)::int as subscricoes,
    (select count(*) from topup_requests t where t.user_id = u.id)::int as carregamentos,
    (select count(*) from withdrawal_requests w where w.creator_id = u.id)::int as levantamentos,
    (select count(*) from live_streams l where l.criador_id = u.id)::int as lives,
    (select count(*) from follows f where f.seguidor_id = u.id or f.seguido_id = u.id)::int as seguidores,
    (select count(*) from kyc_submissions k where k.user_id = u.id)::int as kyc
  from users u order by u.id`;

const cliente = await pool.connect();
let linhas;
try {
  await cliente.query("begin read only");
  linhas = (await cliente.query(SQL)).rows;
  await cliente.query("rollback");
} catch (e) { console.error(`❌ Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`); cliente.release(); await pool.end().catch(() => {}); process.exit(1); }
cliente.release();

const dia = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—");
const col = (v, n) => String(v ?? "").slice(0, n).padEnd(n);
console.log(`Contas (${linhas.length}) — base de dados ${destino}. Só leitura.\n`);
console.log([col("id", 5), col("utilizador", 22), col("email", 34), col("role", 10), col("ativa", 6), col("criada em", 17), col("último login*", 17), col("google", 7), "linhas associadas"].join(" "));
for (const r of linhas) {
  const l = [["posts", r.posts], ["stories", r.stories], ["coment.", r.comentarios], ["msgs", r.mensagens], ["compras/vendas", r.compras_vendas], ["subscr.", r.subscricoes], ["carreg.", r.carregamentos], ["levant.", r.levantamentos], ["lives", r.lives], ["follows", r.seguidores], ["kyc", r.kyc]]
    .filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(" ") || "—";
  console.log([col(r.id, 5), col(r.username, 22), col(r.email, 34), col(r.role, 10), col(r.ativo ? "sim" : "não", 6), col(dia(r.criado_em), 17), col(dia(r.ultimo_login), 17), col(r.google ? "sim" : "não", 7), l].join(" "));
}
const porRole = linhas.reduce((m, r) => ((m[r.role] = (m[r.role] ?? 0) + 1), m), {});
console.log("\n* último login é APROXIMADO: não há uma coluna própria; vem da sessão mais recente ainda guardada (normal ou de admin) e do último login com Google.");
console.log(`Total por role: ${Object.entries(porRole).map(([k, n]) => `${k}=${n}`).join(", ")}. Com Google ligado: ${linhas.filter((r) => r.google).length}.`);
await pool.end().catch(() => {});
