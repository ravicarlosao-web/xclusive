import { asc, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { calcComissao } from "./commission";
import { comissaoEmCentimos } from "./gorjetaMensagem";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface UtilizadorBloqueado { id: number; saldo: string; ganhos: string }

/**
 * Bloqueia (FOR UPDATE), dentro da transação do chamador, as linhas de utilizador envolvidas num movimento de dinheiro.
 *
 * REGRA DE ORDEM: as linhas bloqueiam-se SEMPRE por id crescente (ORDER BY id), numa única instrução. Duas transações que precisem
 * das mesmas duas contas em sentidos opostos (A→B e B→A) pedem os locks pela mesma ordem e esperam uma pela outra em vez de
 * entrarem em deadlock. Quem debita um utilizador e credita outro NUNCA deve bloquear só o pagador e atualizar depois o recetor.
 *
 * Devolve os dados que as rotas já liam (saldo e ganhos como vêm da BD), por id; um id inexistente não aparece no mapa.
 * Ids repetidos ou ausentes (null/undefined) são ignorados.
 */
export async function bloquearUtilizadores(tx: Tx, ids: ReadonlyArray<number | null | undefined>): Promise<Map<number, UtilizadorBloqueado>> {
  const unicos = [...new Set(ids.filter((i): i is number => Number.isInteger(i)))];
  if (unicos.length === 0) return new Map();
  const linhas = await tx
    .select({ id: usersTable.id, saldo: usersTable.saldo, ganhos: usersTable.ganhos })
    .from(usersTable)
    .where(inArray(usersTable.id, unicos))
    .orderBy(asc(usersTable.id))
    .for("update");
  return new Map(linhas.map((l) => [l.id, l]));
}

/**
 * Comissão e parte do criador para um pagamento, prontas a gravar (texto numérico).
 *
 * Valores INTEIROS em Kz (o que o front envia): contas em cêntimos inteiros (comissaoEmCentimos), sem vírgula flutuante; com taxas
 * de até 2 casas decimais o resultado é igual ao de calcComissao (Math.round(valor × taxa) / 100). Valores com decimais (a API
 * aceita-os em gorjetas de posts, preços de PPV e planos) mantêm o cálculo antigo (calcComissao), para o comportamento ser idêntico.
 */
export function comissaoParaCobranca(valor: number, taxa: number): { comissao: string; valorCriador: string } {
  if (Number.isInteger(valor)) {
    const { comissaoCent, criadorCent } = comissaoEmCentimos(valor, taxa);
    return { comissao: (comissaoCent / 100).toFixed(2), valorCriador: (criadorCent / 100).toFixed(2) };
  }
  const { comissao, valorCriador } = calcComissao(valor, taxa);
  return { comissao: String(comissao), valorCriador: String(valorCriador) };
}
