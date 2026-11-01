import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, postsTable, storiesTable, commentsTable, liveStreamsTable, postMediaTable, likesTable, messagesTable,
  reportsTable, auditLogTable, usersTable, highlightsTable,
} from "@workspace/db";
import { deleteFile, deletePrivate, getStorageKeyFromPublicUrl, isPaidKey } from "./storage";
import { erroSeguro } from "./erroSeguro";
import { logger } from "./logger";

/**
 * Provas intocáveis: conteúdo retirado ou denunciado não se apaga.
 *
 *  - retirado (retirado_em)                      → ninguém apaga (nem o admin);
 *  - denúncia 'menor' aberta (pendente/em_analise) → ninguém apaga (nem o admin);
 *  - denúncia 'menor' procedente                  → bloqueio PERMANENTE (ninguém);
 *  - qualquer outra denúncia aberta               → o autor não apaga; o admin só com motivo obrigatório;
 *  - post com comentário retirado ou denunciado   → as mesmas regras aplicadas a cada comentário.
 *
 * Tudo corre DENTRO da transação do chamador, com o alvo bloqueado (FOR UPDATE na eliminação; FOR SHARE em criarDenuncia),
 * para uma denúncia concorrente ou entra antes (e bloqueia) ou espera pela eliminação. Os ficheiros no Bunny só se apagam
 * DEPOIS do commit. O trigger proteger_prova() na base de dados é a rede de segurança (cascatas e SQL direto).
 * Nunca se registam em logs IP, User-Agent nem texto do conteúdo: só `erroSeguro`.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;
export type Ator = "autor" | "admin";
export type TipoProtegido = "post" | "story" | "comment" | "live" | "user" | "mensagem";
export type MotivoBloqueio = "retirado" | "denuncia_aberta" | "denuncia_menor_aberta" | "menor_procedente" | "comentario_protegido";

const ABERTA = ["pendente", "em_analise"] as const;
const TABELAS = { post: postsTable, story: storiesTable, comment: commentsTable, live: liveStreamsTable } as const;

export const MSG_AUTOR_RETIRADO = "Este conteúdo foi retirado pela equipa e não pode ser eliminado.";
export const MSG_AUTOR_EM_ANALISE = "Este conteúdo está em análise e não pode ser eliminado de momento. Tenta novamente quando a análise terminar.";
const MSG_ADMIN: Record<MotivoBloqueio, string> = {
  retirado: "Este conteúdo está retirado e não pode ser eliminado: fica retido como prova.",
  denuncia_menor_aberta: "Há uma denúncia de menor por decidir sobre este conteúdo: ninguém o pode eliminar até a denúncia estar decidida e arquivada.",
  menor_procedente: "Este conteúdo foi alvo de uma denúncia de menor considerada procedente e fica retido de forma permanente.",
  comentario_protegido: "Um comentário desta publicação está retirado ou sob denúncia de menor: a publicação não pode ser eliminada enquanto a prova tiver de ser preservada.",
  denuncia_aberta: "Este conteúdo tem uma denúncia aberta.",
};

export class EliminacaoBloqueadaError extends Error {
  readonly httpStatus = 409;
  readonly codigo = "eliminacao_bloqueada";
  constructor(public readonly motivo: MotivoBloqueio, public readonly ator: Ator) {
    super(mensagemDeBloqueio(motivo, ator));
    this.name = "EliminacaoBloqueadaError";
  }
}
export class EliminacaoErro extends Error {
  constructor(msg: string, public readonly httpStatus: number) { super(msg); this.name = "EliminacaoErro"; }
}

/** Mensagem ao autor: não revela a categoria da denúncia. Ao admin: clara e específica. */
export function mensagemDeBloqueio(motivo: MotivoBloqueio, ator: Ator): string {
  if (ator === "admin") return MSG_ADMIN[motivo];
  return motivo === "retirado" || motivo === "menor_procedente" ? MSG_AUTOR_RETIRADO : MSG_AUTOR_EM_ANALISE;
}

/** Bloqueia a linha do alvo (FOR UPDATE na eliminação, FOR SHARE ao denunciar). false se não existe. */
export async function bloquearAlvo(tx: Tx, tipo: TipoProtegido, id: number, modo: "update" | "share"): Promise<boolean> {
  if (tipo === "user") return true;
  const t = (tipo === "mensagem" ? messagesTable : TABELAS[tipo]) as typeof postsTable;
  const q = tx.select({ id: t.id }).from(t).where(eq(t.id, id));
  const rows = await (modo === "update" ? q.for("update") : q.for("share"));
  return rows.length > 0;
}

/** Há denúncia 'menor' aberta sobre o alvo? (usado também para bloquear o "repor conteúdo"). */
export async function temMenorAberta(q: Q, tipo: TipoProtegido, id: number): Promise<boolean> {
  const r = await q.select({ id: reportsTable.id }).from(reportsTable)
    .where(and(eq(reportsTable.targetType, tipo), eq(reportsTable.targetId, id), eq(reportsTable.reason, "menor"), inArray(reportsTable.status, [...ABERTA])))
    .limit(1);
  return r.length > 0;
}

/** Há alguma denúncia 'menor' julgada PROCEDENTE sobre o alvo? (bloqueia a reposição, sem exceção). */
export async function temMenorProcedente(q: Q, tipo: TipoProtegido, id: number): Promise<boolean> {
  const r = await q.select({ id: reportsTable.id }).from(reportsTable)
    .where(and(eq(reportsTable.targetType, tipo), eq(reportsTable.targetId, id), eq(reportsTable.reason, "menor"), eq(reportsTable.status, "procedente")))
    .limit(1);
  return r.length > 0;
}

function avaliar(retirado: boolean, reports: { reason: string; status: string }[], ator: Ator): MotivoBloqueio | null {
  if (retirado) return "retirado";
  if (reports.some((r) => r.reason === "menor" && r.status === "procedente")) return "menor_procedente";
  if (reports.some((r) => r.reason === "menor" && (ABERTA as readonly string[]).includes(r.status))) return "denuncia_menor_aberta";
  if (ator === "autor" && reports.some((r) => (ABERTA as readonly string[]).includes(r.status))) return "denuncia_aberta";
  return null;
}

/** Motivo pelo qual o alvo (ou, num post, algum dos seus comentários) NÃO pode ser eliminado; null se pode. */
export async function motivoDeBloqueio(q: Q, tipo: Exclude<TipoProtegido, "user" | "mensagem">, id: number, ator: Ator): Promise<MotivoBloqueio | null> {
  const t = TABELAS[tipo] as typeof postsTable;
  const [linha] = await q.select({ retiradoEm: t.retiradoEm }).from(t).where(eq(t.id, id)).limit(1);
  if (!linha) return null;
  const reports = await q.select({ reason: reportsTable.reason, status: reportsTable.status }).from(reportsTable)
    .where(and(eq(reportsTable.targetType, tipo), eq(reportsTable.targetId, id)));
  const direto = avaliar(!!linha.retiradoEm, reports, ator);
  if (direto) return direto;

  if (tipo === "post") {
    const comentarios = await q.select({ id: commentsTable.id, retiradoEm: commentsTable.retiradoEm }).from(commentsTable).where(eq(commentsTable.postId, id));
    if (comentarios.length > 0) {
      const rep = await q.select({ alvo: reportsTable.targetId, reason: reportsTable.reason, status: reportsTable.status }).from(reportsTable)
        .where(and(eq(reportsTable.targetType, "comment"), inArray(reportsTable.targetId, comentarios.map((c) => c.id))));
      for (const c of comentarios) {
        if (avaliar(!!c.retiradoEm, rep.filter((r) => r.alvo === c.id), ator)) return "comentario_protegido";
      }
    }
  }
  return null;
}

/** O trigger proteger_prova() da BD (rede de segurança) respondeu com "prova_protegida". */
function eErroDoTrigger(err: unknown): boolean {
  const e = err as { message?: unknown; cause?: { message?: unknown } };
  return String(e?.message ?? "").includes("prova_protegida") || String(e?.cause?.message ?? "").includes("prova_protegida");
}

/** Regista a tentativa recusada em audit_log (fora da transação que reverteu). IP só na BD. Nunca falha a resposta. */
async function registarRecusa(userId: number, tipo: string, id: number, e: EliminacaoBloqueadaError, ip: string | null): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      adminId: userId, action: "eliminacao_recusada", targetType: tipo, targetId: id,
      details: { motivo: e.motivo, ator: e.ator }, ipAddress: ip,
    });
  } catch (err) {
    logger.warn(erroSeguro(err), "Não foi possível registar a tentativa de eliminação recusada");
  }
}

async function executar<T>(userId: number, ator: Ator, tipo: string, id: number, ip: string | null, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const bloqueio = err instanceof EliminacaoBloqueadaError ? err : eErroDoTrigger(err) ? new EliminacaoBloqueadaError("denuncia_aberta", ator) : null;
    if (bloqueio) { await registarRecusa(userId, tipo, id, bloqueio, ip); throw bloqueio; }
    throw err;
  }
}

/**
 * O ficheiro (chave no armazenamento) ainda é usado por outro conteúdo? Procura a chave em post_media, avatar e capa de utilizadores,
 * stories, mensagens e capas de destaques. Em caso de dúvida (erro na consulta) devolve true: mais vale não apagar. Corre DEPOIS de o post
 * ter sido eliminado, por isso as linhas encontradas são sempre de OUTROS conteúdos.
 */
async function ficheiroEmUso(key: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      select 1 where exists (select 1 from ${postMediaTable} where strpos(url, ${key}) > 0)
        or exists (select 1 from ${usersTable} where strpos(coalesce(avatar_url, ''), ${key}) > 0 or strpos(coalesce(capa_url, ''), ${key}) > 0)
        or exists (select 1 from ${storiesTable} where strpos(media_url, ${key}) > 0)
        or exists (select 1 from ${messagesTable} where strpos(coalesce(media_url, ''), ${key}) > 0)
        or exists (select 1 from ${highlightsTable} where strpos(coalesce(capa_url, ''), ${key}) > 0)`);
    return r.rows.length > 0;
  } catch (err) { void err; return true; }
}

/**
 * Apaga os ficheiros no Bunny DEPOIS do commit (melhor esforço). SÓ apaga chaves do AUTOR DO POST (users/<autor>/… ou paid/<autor>/…, nunca do
 * ator que apagou, que pode ser um admin) e SÓ se nenhum outro conteúdo usar o mesmo ficheiro. O resto fica no armazenamento.
 * Falhas: só contagens em log e uma linha de audit.
 */
async function apagarFicheirosDepoisDoCommit(urls: string[], userId: number, postId: number, autorId: number): Promise<void> {
  let falhas = 0, preservados = 0;
  for (const url of urls) {
    try {
      const privado = isPaidKey(url);
      const key = privado ? url : getStorageKeyFromPublicUrl(url);
      if (!key) continue;
      if (!key.startsWith(`${privado ? "paid" : "users"}/${autorId}/`) || key.includes("..")) { preservados++; continue; }   // ficheiro de outro utilizador: nunca se apaga
      if (await ficheiroEmUso(key)) { preservados++; continue; }                                                           // ainda usado por outro conteúdo
      if (privado) await deletePrivate(url); else await deleteFile(key);
    } catch (err) { falhas++; void err; }
  }
  if (preservados > 0) logger.info({ preservados, total: urls.length }, "Eliminação de ficheiros após o commit: ficheiros preservados (de outro utilizador ou em uso)");
  if (falhas > 0) {
    logger.warn({ falhas, total: urls.length }, "Eliminação de ficheiros após o commit: falhas (melhor esforço)");
    try {
      await db.insert(auditLogTable).values({ adminId: userId, action: "post_ficheiros_apagar_falhou", targetType: "post", targetId: postId, details: { falhas, total: urls.length } });
    } catch (err) { logger.warn(erroSeguro(err), "Não foi possível auditar a falha na eliminação de ficheiros"); }
  }
}

/**
 * Elimina um post. `ator` 'autor': só o próprio autor. `ator` 'admin': motivo obrigatório (já validado pela rota).
 * Transação única: bloqueio da linha, regras, audit_log e remoção. Ficheiros só depois do commit.
 */
export async function eliminarPost(o: { postId: number; userId: number; ator: Ator; motivo?: string; ip: string | null }): Promise<{ ficheiros: number }> {
  let autorDoPost = o.userId;
  const urls = await executar(o.userId, o.ator, "post", o.postId, o.ip, () => db.transaction(async (tx) => {
    const [post] = await tx.select().from(postsTable).where(eq(postsTable.id, o.postId)).for("update");
    if (!post) throw new EliminacaoErro("Post não encontrado", 404);
    autorDoPost = post.autorId;
    if (o.ator === "autor" && post.autorId !== o.userId) throw new EliminacaoErro("Sem permissão", 403);
    const bloqueio = await motivoDeBloqueio(tx, "post", o.postId, o.ator);
    if (bloqueio) throw new EliminacaoBloqueadaError(bloqueio, o.ator);
    // O admin (com motivo) pode apagar com denúncias abertas de outras categorias: avisa o trigger proteger_prova() só nesta
    // transação (set_config local). Retirado, menor aberta e menor procedente continuam bloqueados pelo trigger.
    if (o.ator === "admin") await tx.execute(sql`select set_config('xclusive.admin_apaga', 'on', true)`);

    const media = await tx.select({ url: postMediaTable.url }).from(postMediaTable).where(eq(postMediaTable.postId, o.postId));
    await tx.insert(auditLogTable).values({
      adminId: o.userId, action: o.ator === "admin" ? "post_delete" : "conteudo_eliminado_autor", targetType: "post", targetId: o.postId,
      details: { ...(o.ator === "admin" ? { motivo: o.motivo } : {}), autorId: post.autorId, ficheiros: media.length }, ipAddress: o.ip,
    });
    await tx.delete(likesTable).where(and(eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, o.postId)));
    await tx.delete(postsTable).where(eq(postsTable.id, o.postId));
    return media.map((m) => m.url);
  }));
  await apagarFicheirosDepoisDoCommit(urls, o.userId, o.postId, autorDoPost);
  return { ficheiros: urls.length };
}

/** Elimina um story do próprio autor (só a linha, como antes: os ficheiros não se tocam). */
export async function eliminarStory(o: { storyId: number; userId: number; ip: string | null }): Promise<void> {
  await executar(o.userId, "autor", "story", o.storyId, o.ip, () => db.transaction(async (tx) => {
    const [story] = await tx.select().from(storiesTable).where(eq(storiesTable.id, o.storyId)).for("update");
    if (!story || story.autorId !== o.userId) throw new EliminacaoErro("Sem permissão", 403);
    const bloqueio = await motivoDeBloqueio(tx, "story", o.storyId, "autor");
    if (bloqueio) throw new EliminacaoBloqueadaError(bloqueio, "autor");
    await tx.insert(auditLogTable).values({ adminId: o.userId, action: "conteudo_eliminado_autor", targetType: "story", targetId: o.storyId, details: { autorId: story.autorId }, ipAddress: o.ip });
    await tx.delete(storiesTable).where(eq(storiesTable.id, o.storyId));
  }));
}

/** Elimina um comentário do próprio autor. */
export async function eliminarComentario(o: { commentId: number; userId: number; ip: string | null }): Promise<void> {
  await executar(o.userId, "autor", "comment", o.commentId, o.ip, () => db.transaction(async (tx) => {
    const [c] = await tx.select().from(commentsTable).where(eq(commentsTable.id, o.commentId)).for("update");
    if (!c || c.autorId !== o.userId) throw new EliminacaoErro("Sem permissão", 403);
    const bloqueio = await motivoDeBloqueio(tx, "comment", o.commentId, "autor");
    if (bloqueio) throw new EliminacaoBloqueadaError(bloqueio, "autor");
    await tx.insert(auditLogTable).values({ adminId: o.userId, action: "conteudo_eliminado_autor", targetType: "comment", targetId: o.commentId, details: { autorId: c.autorId }, ipAddress: o.ip });
    await tx.delete(commentsTable).where(eq(commentsTable.id, o.commentId));
  }));
}

/** Traduz os erros de eliminação em respostas HTTP (409 com `codigo: "eliminacao_bloqueada"`); o resto é 500 com log seguro. */
export function responderErroEliminacao(err: unknown, res: import("express").Response, log?: { error: (...a: any[]) => void }): void {
  if (err instanceof EliminacaoBloqueadaError) { res.status(409).json({ error: err.message, codigo: err.codigo }); return; }
  if (err instanceof EliminacaoErro) { res.status(err.httpStatus).json({ error: err.message }); return; }
  (log ?? logger).error(erroSeguro(err), "Erro ao eliminar conteúdo");
  res.status(500).json({ error: "Erro interno." });
}
