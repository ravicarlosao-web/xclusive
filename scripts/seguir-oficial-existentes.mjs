// Seguir a conta oficial em contas JÁ EXISTENTES (uso único). Só leitura por defeito (simulação): só com --confirmar grava.
//
//   pnpm --filter @workspace/scripts exec tsx seguir-oficial-existentes.mjs                 (simulação: só conta e lista as exclusões)
//   pnpm --filter @workspace/scripts exec tsx seguir-oficial-existentes.mjs --confirmar     (executa)
//
// Regras:
//  - A conta oficial vem de platform_settings (`conta_oficial_username`, por defeito «xclusive») e tem de existir, estar ativa e não ser de administração; senão recusa tudo.
//    NÃO depende do interruptor `seguir_oficial_ativo` (esse é só para contas novas no registo); mostra o estado dele.
//  - Exclui: contas admin/superadmin, a própria conta oficial, contas inativas (encerradas, banidas ou suspensas), contas com bloqueio com a oficial (em qualquer sentido)
//    e quem já a segue (não duplica).
//  - Passa pelo MESMO caminho de «seguir» da aplicação (lib/seguir.ts), sem a notificação de «novo seguidor» para a conta oficial. Isso enfileira a mensagem de boas-vindas,
//    que respeita o interruptor geral, a elegibilidade (idade e aceitação) e os limites anti-abuso (o que exceder os limites espera na fila e caduca ao fim de 24 h).
//  - Idempotente: uma segunda execução não duplica nada e NÃO volta a seguir quem deixou de seguir depois da primeira: no fim de uma execução completa guarda em
//    platform_settings (`seguir_oficial_script_ate_id`) o maior id de conta tratado, e as execuções seguintes só olham para contas com id superior.
//  - Imprime um resumo (números; nunca nomes, emails ou outros dados pessoais). Liga à base de dados pela configuração que a aplicação já usa; não imprime a ligação.
//  - NÃO executar em produção sem a tua revisão.
const falha = (msg, codigo = 1) => { console.error(`❌ ${msg}`); process.exit(codigo); };
const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirmar");
for (const a of args) if (a !== "--confirmar") falha(`Opção desconhecida: ${a}. Só existe --confirmar.`, 2);

let pool, lib, seguirOficialConta;
try {
  ({ pool } = await import("@workspace/db"));
  lib = await import("../artifacts/api-server/src/lib/seguirOficial.ts");
  seguirOficialConta = lib.seguirOficialConta;
} catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`); }

const { SEGUIR_OFICIAL } = lib;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const cfg = await lib.lerSeguirOficial();
  const oficial = await lib.contaOficial(cfg.username);
  if ("erro" in oficial) falha(`A conta oficial «${cfg.username}» ${oficial.erro === "inexistente" ? "não existe" : oficial.erro === "inativa" ? "está inativa" : "é de administração e não pode ser seguida"}. Nada foi feito.`);

  const marca = await pool.query("SELECT value FROM platform_settings WHERE key = $1", [SEGUIR_OFICIAL.CHAVE_SCRIPT_ATE_ID]);
  const ateId = Number(marca.rows[0]?.value?.value) || 0;
  const maxId = Number((await pool.query("SELECT COALESCE(MAX(id), 0) AS m FROM users")).rows[0].m);

  const r = (await pool.query(`
    SELECT count(*)::int AS consideradas,
      count(*) FILTER (WHERE u.id = $1)::int AS e_a_oficial,
      count(*) FILTER (WHERE u.id <> $1 AND u.role IN ('admin','superadmin'))::int AS admin,
      count(*) FILTER (WHERE u.id <> $1 AND u.role NOT IN ('admin','superadmin') AND NOT u.ativo)::int AS inativas,
      count(*) FILTER (WHERE u.id <> $1 AND u.role NOT IN ('admin','superadmin') AND u.ativo AND EXISTS (SELECT 1 FROM follows f WHERE f.seguidor_id = u.id AND f.seguido_id = $1))::int AS ja_seguem,
      count(*) FILTER (WHERE u.id <> $1 AND u.role NOT IN ('admin','superadmin') AND u.ativo AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.seguidor_id = u.id AND f.seguido_id = $1)
                       AND EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = $1) OR (b.blocker_id = $1 AND b.blocked_id = u.id)))::int AS com_bloqueio
    FROM users u WHERE u.id > $2 AND u.id <= $3`, [oficial.id, ateId, maxId])).rows[0];
  const aSeguir = r.consideradas - r.e_a_oficial - r.admin - r.inativas - r.ja_seguem - r.com_bloqueio;

  console.log(`${CONFIRMAR ? "EXECUÇÃO" : "SIMULAÇÃO (nada é gravado)"} — conta oficial «${cfg.username}»; interruptor do seguir automático no registo: ${cfg.ativo ? "ligado" : "desligado"}`);
  console.log(`Contas consideradas (ids > ${ateId}): ${r.consideradas}`);
  console.log(`  a seguir: ${aSeguir}`);
  console.log(`  excluídas — admin: ${r.admin}; a própria oficial: ${r.e_a_oficial}; inativas/suspensas/encerradas: ${r.inativas}; com bloqueio: ${r.com_bloqueio}; já seguem (não duplica): ${r.ja_seguem}`);
  if (!CONFIRMAR) { console.log("Para executar: acrescenta --confirmar."); process.exit(0); }

  const tot = { seguiu: 0, ja_segue: 0, bloqueio: 0, conta_inativa: 0, conta_admin: 0, e_a_oficial: 0, conta_oficial_invalida: 0, erros: 0 };
  let ultimo = ateId;
  for (;;) {
    const lote = (await pool.query("SELECT id FROM users WHERE id > $1 AND id <= $2 AND ativo AND role NOT IN ('admin','superadmin') AND id <> $3 ORDER BY id LIMIT 200", [ultimo, maxId, oficial.id])).rows.map((x) => Number(x.id));
    if (lote.length === 0) break;
    for (const id of lote) {
      try { const m = await seguirOficialConta(id, oficial); if (m === "ok") tot.seguiu++; else tot[m] = (tot[m] ?? 0) + 1; }
      catch { tot.erros++; }
      ultimo = id;
    }
    await dorme(50);
  }
  if (tot.erros === 0) {
    await pool.query("INSERT INTO platform_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()", [SEGUIR_OFICIAL.CHAVE_SCRIPT_ATE_ID, JSON.stringify({ value: maxId })]);
  }
  console.log(`Resumo: seguiram agora ${tot.seguiu}; já seguiam ${tot.ja_segue}; bloqueio ${tot.bloqueio}; erros ${tot.erros}${tot.erros ? " (a marca de «já tratadas» NÃO foi atualizada: volta a correr)" : `; marca atualizada para o id ${maxId}`}.`);
  console.log("A mensagem de boas-vindas segue a fila da aplicação (limites anti-abuso; o excedente espera e caduca ao fim de 24 h).");
  await dorme(1500);   // deixa terminar um ciclo de boas-vindas em curso
  process.exit(tot.erros ? 1 : 0);
} catch (e) {
  falha(`Erro: ${e?.code ?? e?.name ?? "erro"}`);
} finally {
  try { await pool.end(); } catch { /* ignorar */ }
}
