import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db, messagesTable, messageTipsTable } from "@workspace/db";
import { copiarImagemParaProvas, deletePrivate, getStorageKeyFromPublicUrl, isStorageConfigured } from "./storage";

/**
 * Denúncia de mensagem: prova congelada da conversa. Janela de contexto de até JANELA mensagens antes e depois da denunciada, de AMBOS os
 * lados (papel 'denunciado' = autor da mensagem denunciada; 'denunciante' = o outro participante). As imagens da janela são copiadas para a
 * zona privada (provas/<denúncia>/…) com SHA-256 e tamanho, para a prova não depender do ficheiro original. As gorjetas levam só
 * { valor, comissao, purchaseId } (nunca saldos). Só o tipo 'mensagem' usa este snapshot: o dos outros tipos não muda.
 */
export const JANELA_CONTEXTO = 20;

type CopiaEstado = "ok" | "falhou" | "nao_aplicavel";

export interface ProvaMensagem {
  snapshot: Record<string, unknown>;
  /** Chaves privadas copiadas (para limpar se a denúncia não chegar a ser criada). */
  copias: string[];
}

export async function prepararProvaMensagem(p: { conversationId: number; mensagemId: number; donoId: number; reportId: number }): Promise<ProvaMensagem> {
  const colunas = { m: messagesTable, valorGorjeta: messageTipsTable.valor, comissaoGorjeta: messageTipsTable.comissao, purchaseId: messageTipsTable.purchaseId };
  const base = () => db.select(colunas).from(messagesTable).leftJoin(messageTipsTable, eq(messageTipsTable.messageId, messagesTable.id));
  const [antes, principal, depois] = await Promise.all([
    base().where(and(eq(messagesTable.conversationId, p.conversationId), lt(messagesTable.id, p.mensagemId))).orderBy(desc(messagesTable.id)).limit(JANELA_CONTEXTO),
    base().where(and(eq(messagesTable.conversationId, p.conversationId), eq(messagesTable.id, p.mensagemId))).limit(1),
    base().where(and(eq(messagesTable.conversationId, p.conversationId), gt(messagesTable.id, p.mensagemId))).orderBy(asc(messagesTable.id)).limit(JANELA_CONTEXTO),
  ]);
  const janela = [...antes.reverse(), ...principal, ...depois];

  const copias: string[] = [];
  let falhou = false, haImagens = false;
  const mensagens: Record<string, unknown>[] = [];
  for (const { m, valorGorjeta, comissaoGorjeta, purchaseId } of janela) {
    const item: Record<string, unknown> = {
      id: m.id,
      autorId: m.autorId,
      papel: m.autorId === p.donoId ? "denunciado" : "denunciante",
      tipo: m.tipo,
      conteudo: m.conteudo,
      criadoEm: m.criadoEm.toISOString(),
      retirada: m.retiradoEm !== null,
      principal: m.id === p.mensagemId,
    };
    if (m.tipo === "imagem" && m.mediaUrl) {
      haImagens = true;
      const chaveOriginal = isStorageConfigured() ? getStorageKeyFromPublicUrl(m.mediaUrl) : null;
      const c = chaveOriginal ? await copiarImagemParaProvas(p.reportId, chaveOriginal) : ({ ok: false, motivo: "origem_indisponivel" } as const);
      if (c.ok) { copias.push(c.chaveCopia); item.imagem = { chaveOriginal, chaveCopia: c.chaveCopia, sha256: c.sha256, bytes: c.bytes, copiaEstado: "ok" satisfies CopiaEstado }; }
      else { falhou = true; item.imagem = { chaveOriginal, chaveCopia: null, sha256: null, bytes: null, copiaEstado: "falhou" satisfies CopiaEstado, motivo: c.motivo }; }
    }
    if (m.tipo === "gorjeta" && valorGorjeta != null) {
      item.gorjeta = { valor: Number(valorGorjeta), comissao: Number(comissaoGorjeta), purchaseId };
    }
    mensagens.push(item);
  }

  const copiaEstado: CopiaEstado = !haImagens ? "nao_aplicavel" : falhou ? "falhou" : "ok";
  const dono = principal[0]?.m;
  return {
    copias,
    snapshot: {
      tipo: "mensagem", id: p.mensagemId, donoId: p.donoId, conversaId: p.conversationId, mensagemId: p.mensagemId,
      resumo: null,
      ficheiros: copias.map((chave) => ({ tipo: "imagem", chave })),
      mais18: null,
      criadoEmConteudo: dono ? dono.criadoEm.toISOString() : null,
      capturadoEm: new Date().toISOString(),
      copiaEstado,
      janela: { antes: antes.length, depois: depois.length, maximo: JANELA_CONTEXTO },
      mensagens,
    },
  };
}

/** Apaga as cópias de prova (só quando a denúncia não chegou a ser criada). Melhor esforço: nunca lança. */
export async function apagarCopiasDeProva(chaves: string[]): Promise<void> {
  for (const k of chaves) { try { await deletePrivate(k); } catch { /* melhor esforço */ } }
}

/**
 * Excerto para o admin: SÓ o que está no snapshot congelado (nunca a conversa viva), com as imagens de prova por URL assinado de curta
 * duração. Não há (nem pode haver) forma de ler mensagens fora da janela.
 */
export function excertoParaAdmin(snapshot: unknown, assinar: (chave: string) => string | null): Record<string, unknown> | null {
  const s = snapshot as { conversaId?: number; mensagemId?: number; copiaEstado?: string; janela?: unknown; mensagens?: Record<string, any>[] } | null;
  if (!s || !Array.isArray(s.mensagens)) return null;
  return {
    conversaId: s.conversaId, mensagemId: s.mensagemId, copiaEstado: s.copiaEstado, janela: s.janela,
    mensagens: s.mensagens.map((m) => ({
      ...m,
      ...(m.imagem ? { imagem: { ...m.imagem, provaUrl: m.imagem.chaveCopia ? assinar(m.imagem.chaveCopia) : null } } : {}),
    })),
  };
}
