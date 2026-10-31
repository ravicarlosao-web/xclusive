import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, purchasesTable, messagesTable, messageTipsTable, notificationsTable } from "@workspace/db";
import { getCommissionRate, taxaComDuasCasas } from "./commission";
import { jsonCanonico, sha256Hex } from "./hashCanonico";
import { permissaoMensagem, textoRegra, TEXTO_BLOQUEASTE, type PermissaoMensagem } from "./permissaoMensagem";

/**
 * Gorjeta numa conversa privada (mensagem tipo 'gorjeta'). Só para mensagens: as gorjetas de posts e de lives têm as suas próprias regras.
 * Limites num sítio único (alterar aqui):
 */
export const GORJETA_MENSAGEM = {
  MIN_KZ: 50,
  MAX_KZ: 100_000,
  /** Soma máxima das gorjetas de mensagens de um remetente nas últimas JANELA_HORAS. */
  LIMITE_DIARIO_KZ: 300_000,
  JANELA_HORAS: 24,
  MENSAGEM_MAX: 255,
} as const;

export const formatarKz = (v: number): string => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export class GorjetaErro extends Error {
  constructor(msg: string, public readonly httpStatus: number, public readonly codigo?: string, public readonly extra?: Record<string, unknown>) {
    super(msg);
    this.name = "GorjetaErro";
  }
}

const ROLES_ADMIN = ["admin", "superadmin"];

/**
 * Comissão em CÊNTIMOS inteiros (sem vírgula flutuante), com a mesma regra de arredondamento das gorjetas de posts
 * (calcComissao: Math.round(valor × taxa) / 100, meio para cima). valor em Kz inteiros; taxa em percentagem (0-100).
 */
export function comissaoEmCentimos(valorKz: number, taxaPercentagem: number): { comissaoCent: number; criadorCent: number } {
  const totalCent = valorKz * 100;
  const comissaoCent = taxaComDuasCasas(taxaPercentagem)
    ? Math.floor((valorKz * Math.round(taxaPercentagem * 100) + 50) / 100) // inteiros: valor × (taxa em centésimas de %) / 100, meio para cima
    : Math.round(valorKz * taxaPercentagem); // taxa com mais de 2 casas (não deve existir): mesmo cálculo dos posts
  return { comissaoCent, criadorCent: totalCent - comissaoCent };
}
const centParaDecimal = (c: number): string => (c / 100).toFixed(2);

/** Erro pelo qual esta gorjeta não pode ser enviada (bloqueio, regra, admin, auto-gorjeta, destinatário), ou null. */
export function erroDePermissaoGorjeta(perm: PermissaoMensagem, remetenteId: number): GorjetaErro | null {
  if (perm.estado === "fui_bloqueado") return new GorjetaErro("Conversa indisponível.", 404); // igual à conta inativa
  if (perm.estado === "bloqueaste") return new GorjetaErro(TEXTO_BLOQUEASTE, 403, "bloqueaste");
  if (perm.estado === "regra") return new GorjetaErro(textoRegra(perm), 403, "mensagens_restritas", { regra: perm.regra });
  if (perm.destinatarioId === null || perm.destinatarioId === remetenteId || !perm.destinatario) return new GorjetaErro("Não podes dar gorjeta a ti próprio.", 400);
  if (ROLES_ADMIN.includes(perm.remetenteRole ?? "") || ROLES_ADMIN.includes(perm.destinatario.role)) {
    return new GorjetaErro("Esta operação não está disponível para esta conta.", 403, "conta_nao_permitida");
  }
  const d = perm.destinatario;
  if (d.tipoConta !== "criador" || !d.verificado || !d.ativo) return new GorjetaErro("Este criador ainda não pode receber gorjetas.", 403, "destinatario_invalido");
  return null;
}

export interface GorjetaPedido {
  remetenteId: number;
  destinatarioId: number;
  conversationId: number;
  valor: number;
  mensagem: string | null;
  chave: string;
}

/**
 * Envia a gorjeta numa única transação atómica:
 *  1. bloqueia as DUAS linhas de utilizador por id crescente (serializa o mesmo remetente e evita deadlock A→B / B→A);
 *  2. idempotência: a mesma (remetente, chave) devolve a mensagem original (criada=false); com outro pedido → 409;
 *  3. revalida sob lock (bloqueio, regra, admin, destinatário criador+verificado+ativo) e o limite diário (soma das últimas 24 h);
 *  4. comissão (sem taxa → CommissionNotConfiguredError, antes de qualquer débito) em cêntimos inteiros;
 *  5. UPDATE condicional do saldo (saldo ≥ valor); crédito dos ganhos líquidos do criador;
 *  6. purchases (tipo 'gorjeta', conteudo_id NULL), mensagem 'gorjeta', message_tips, notificação 'gorjeta_recebida'.
 * Qualquer falha desfaz tudo: nunca há mensagem sem cobrança nem cobrança sem mensagem.
 */
export async function enviarGorjetaMensagem(p: GorjetaPedido) {
  const pedidoHash = sha256Hex(jsonCanonico({ conversa: p.conversationId, valor: p.valor, mensagem: p.mensagem }));
  return db.transaction(async (tx) => {
    // 1. Bloqueio ordenado das duas linhas (S e R), por id crescente
    const bloqueadas = await tx.execute(sql`SELECT id FROM users WHERE id IN (${p.remetenteId}, ${p.destinatarioId}) ORDER BY id FOR UPDATE`);
    if (bloqueadas.rows.length !== 2) throw new GorjetaErro("Conversa indisponível.", 404);

    // 2. Idempotência
    const [anterior] = await tx.select({ tip: messageTipsTable, m: messagesTable }).from(messageTipsTable)
      .innerJoin(messagesTable, eq(messagesTable.id, messageTipsTable.messageId))
      .where(and(eq(messageTipsTable.remetenteId, p.remetenteId), eq(messageTipsTable.chaveIdempotencia, p.chave)));
    if (anterior) {
      if (anterior.tip.pedidoHash !== pedidoHash) throw new GorjetaErro("Esta chave já foi usada com outro pedido de gorjeta.", 409, "chave_reutilizada");
      return { criada: false as const, mensagem: anterior.m, valor: Number(anterior.tip.valor) };
    }

    // 3. Revalidação sob lock
    const perm = await permissaoMensagem(p.remetenteId, { conversationId: p.conversationId }, tx);
    const erro = erroDePermissaoGorjeta(perm, p.remetenteId);
    if (erro) throw erro;
    if (perm.destinatarioId !== p.destinatarioId) throw new GorjetaErro("Conversa indisponível.", 404);

    const [{ soma }] = (await tx.execute(sql`SELECT coalesce(sum(valor), 0)::float AS soma FROM message_tips WHERE remetente_id = ${p.remetenteId} AND criado_em > now() - (${GORJETA_MENSAGEM.JANELA_HORAS} * interval '1 hour')`)).rows as { soma: number }[];
    if (Number(soma) + p.valor > GORJETA_MENSAGEM.LIMITE_DIARIO_KZ) {
      throw new GorjetaErro(`Atingiste o limite diário de gorjetas (${formatarKz(GORJETA_MENSAGEM.LIMITE_DIARIO_KZ)} Kz em ${GORJETA_MENSAGEM.JANELA_HORAS} horas). Tenta novamente mais tarde.`, 429, "limite_diario");
    }

    // 4. Comissão (lança CommissionNotConfiguredError ANTES de qualquer débito)
    const taxa = await getCommissionRate(tx, p.destinatarioId);
    const { comissaoCent, criadorCent } = comissaoEmCentimos(p.valor, taxa);

    // 5. Débito condicional e crédito
    const debitado = await tx.update(usersTable).set({ saldo: sql`${usersTable.saldo} - ${p.valor}` })
      .where(and(eq(usersTable.id, p.remetenteId), sql`${usersTable.saldo} >= ${p.valor}`)).returning({ id: usersTable.id });
    if (debitado.length === 0) throw new GorjetaErro("Saldo insuficiente para enviar esta gorjeta.", 402, "saldo_insuficiente");
    await tx.update(usersTable).set({ ganhos: sql`${usersTable.ganhos} + ${centParaDecimal(criadorCent)}::numeric` }).where(eq(usersTable.id, p.destinatarioId));

    // 6. Ledger, mensagem, ligação e notificação
    const [compra] = await tx.insert(purchasesTable).values({
      compradorId: p.remetenteId, vendedorId: p.destinatarioId, tipo: "gorjeta",
      valor: String(p.valor), comissao: centParaDecimal(comissaoCent), taxaComissao: String(taxa),
      conteudoId: null, descricao: "Gorjeta numa conversa",
    }).returning({ id: purchasesTable.id });
    const [mensagem] = await tx.insert(messagesTable).values({
      conversationId: p.conversationId, autorId: p.remetenteId, tipo: "gorjeta", conteudo: p.mensagem, mediaUrl: null,
    }).returning();
    await tx.insert(messageTipsTable).values({
      messageId: mensagem.id, conversationId: p.conversationId, remetenteId: p.remetenteId, criadorId: p.destinatarioId, purchaseId: compra.id,
      valor: String(p.valor), comissao: centParaDecimal(comissaoCent), taxaComissao: String(taxa), chaveIdempotencia: p.chave, pedidoHash,
    });
    await tx.insert(notificationsTable).values({
      destinatarioId: p.destinatarioId, tipo: "gorjeta_recebida", atorId: p.remetenteId, alvoId: p.conversationId,
      mensagem: `enviou-te uma gorjeta de ${formatarKz(p.valor)} Kz`,
    });
    return { criada: true as const, mensagem, valor: p.valor };
  });
}
