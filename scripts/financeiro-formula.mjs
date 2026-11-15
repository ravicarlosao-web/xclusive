// FÓRMULA ÚNICA do saldo e dos ganhos que as linhas financeiras explicam. Partilhada por zerar-financeiro.mjs e reconciliar-saldos.mjs (nunca duplicar: se a regra mudar, muda aqui).
//
//   saldo  = Σ carregamentos aprovados (topup_requests.status = 'aprovado')  −  Σ compras como comprador (purchases.valor)  +  Σ ajustes do admin com campo = 'saldo' (ajustes_saldo.valor, com sinal)
//   ganhos = Σ vendas líquidas como vendedor (purchases.valor − comissao)    −  Σ levantamentos NÃO rejeitados (withdrawal_requests.amount)  +  Σ ajustes do admin com campo = 'ganhos'
//
// Os ajustes lêem-se da tabela ajustes_saldo (escrita na mesma transação do UPDATE do saldo). Os ajustes ANTIGOS que só existem no audit_log (action = 'balance_adjustment', anteriores
// à tabela) NÃO entram, porque a tabela começou vazia depois de o financeiro ser zerado; quem quiser vê-los pode pedir `ajustesAuditLegado: true` (só para investigação).
// Só leitura: este módulo apenas faz SELECTs.
export const TOLERANCIA = 0.005;

/** SELECT por conta: id, saldo e ganhos guardados e calculados. Parâmetro $1 = lista de ids (ou NULL = todas as contas). */
export function sqlCalculado({ ajustesAuditLegado = false } = {}) {
  const legado = ajustesAuditLegado
    ? "+ (select coalesce(sum((a.details->>'valor')::numeric), 0) from audit_log a where a.action = 'balance_adjustment' and a.target_type = 'user' and a.target_id = u.id)"
    : "";
  return `select u.id, u.username, u.role, u.saldo as saldo_guardado, u.ganhos as ganhos_guardados,
    ((select coalesce(sum(t.amount), 0) from topup_requests t where t.user_id = u.id and t.status = 'aprovado')
      - (select coalesce(sum(p.valor), 0) from purchases p where p.comprador_id = u.id)
      + (select coalesce(sum(j.valor), 0) from ajustes_saldo j where j.user_id = u.id and j.campo = 'saldo') ${legado}) as saldo_calculado,
    ((select coalesce(sum(p.valor - p.comissao), 0) from purchases p where p.vendedor_id = u.id)
      - (select coalesce(sum(w.amount), 0) from withdrawal_requests w where w.creator_id = u.id and w.status::text <> 'rejeitado')
      + (select coalesce(sum(j.valor), 0) from ajustes_saldo j where j.user_id = u.id and j.campo = 'ganhos')) as ganhos_calculados
  from users u where ($1::int[] is null or u.id = any($1)) order by u.id`;
}

/** Calcula (sem escrever) para as contas dadas (ou todas se ids for null). `q` = (sql, params) => Promise<{rows}>. Devolve números e as diferenças (guardado − calculado). */
export async function calcularContas(q, ids = null, opcoes = {}) {
  const { rows } = await q(sqlCalculado(opcoes), [ids]);
  return rows.map((r) => {
    const o = { id: r.id, username: r.username, role: r.role, saldoGuardado: Number(r.saldo_guardado), ganhosGuardados: Number(r.ganhos_guardados), saldoCalculado: Number(r.saldo_calculado), ganhosCalculados: Number(r.ganhos_calculados) };
    o.difSaldo = Math.round((o.saldoGuardado - o.saldoCalculado) * 100) / 100; o.difGanhos = Math.round((o.ganhosGuardados - o.ganhosCalculados) * 100) / 100;
    o.emDesvio = Math.abs(o.difSaldo) > TOLERANCIA || Math.abs(o.difGanhos) > TOLERANCIA;
    return o;
  });
}
