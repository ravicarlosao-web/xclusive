import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, usersTable, postsTable, storiesTable, liveStreamsTable } from "@workspace/db";
import { postVisivel } from "./takedown";

/**
 * Filtro de conteúdo +18 NO SERVIDOR (PR 2), no mesmo padrão de postVisivel(): uma condição SQL por tipo,
 * que recebe o visualizador. Aplica-se na própria query (paginação, totais e hasMore ficam coerentes).
 *
 * Regras: só preferencia_mais18 = 'ver' vê conteúdo +18 (nulo e 'filtrar' não veem); a autora vê sempre o
 * seu; admin/superadmin veem tudo. A preferência é lida da base de dados a cada pedido (não vai no JWT).
 */

export const CODIGO_CONTEUDO_MAIS18 = "conteudo_mais18";
export const MSG_CONTEUDO_MAIS18 = "Este conteúdo é +18. Podes ativá-lo em Definições.";

export const MSG_MAIS18_INVALIDO = "O campo mais18 é obrigatório e tem de ser verdadeiro ou falso.";

/** Lê a marcação enviada pela criadora: só um boolean estrito é válido; em falta ou de outro tipo => inválido (400). */
export function lerMarcacaoMais18(valor: unknown): { ok: true; mais18: boolean } | { ok: false } {
  return typeof valor === "boolean" ? { ok: true, mais18: valor } : { ok: false };
}

export interface Visualizador {
  userId: number | null;
  /** 'ver' escolhido, ou admin/superadmin: não filtra nada. */
  veTudo: boolean;
}

export async function lerVisualizador(userId: number | null | undefined): Promise<Visualizador> {
  if (!userId) return { userId: null, veTudo: false };
  const [u] = await db
    .select({ pref: usersTable.preferenciaMais18, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return { userId, veTudo: u?.pref === "ver" || u?.role === "admin" || u?.role === "superadmin" };
}

function permitido(colMais18: unknown, colAutor: unknown, v: Visualizador): SQL {
  if (v.veTudo) return sql`true`;
  if (v.userId !== null) return sql`(${colMais18} = false OR ${colAutor} = ${v.userId})`;
  return sql`${colMais18} = false`;
}

// ── Uma condição por tipo (juntar com postVisivel() & companhia) ─────────────
export const postPermitido = (v: Visualizador): SQL => permitido(postsTable.mais18, postsTable.autorId, v);
export const storyPermitida = (v: Visualizador): SQL => permitido(storiesTable.mais18, storiesTable.autorId, v);
export const livePermitida = (v: Visualizador): SQL => permitido(liveStreamsTable.mais18, liveStreamsTable.criadorId, v);

/** Visível (não retirado, autor ativo) E permitido ao visualizador. */
export const postVisivelPara = (v: Visualizador): SQL => and(postVisivel(), postPermitido(v))!;

// ── Verificação por linha (leitura direta e rotas por ID) ────────────────────
/** true se a linha é +18 e o visualizador não a pode ver (a autora vê sempre o seu). */
export function bloqueadoMais18(v: Visualizador, linha: { mais18: boolean; autorId: number }): boolean {
  return !v.veTudo && linha.mais18 && linha.autorId !== v.userId;
}

export async function postBloqueado(id: number, v: Visualizador): Promise<boolean> {
  if (v.veTudo) return false;
  const [r] = await db.select({ mais18: postsTable.mais18, autorId: postsTable.autorId }).from(postsTable).where(eq(postsTable.id, id)).limit(1);
  return !!r && bloqueadoMais18(v, r);
}
export async function storyBloqueada(id: number, v: Visualizador): Promise<boolean> {
  if (v.veTudo) return false;
  const [r] = await db.select({ mais18: storiesTable.mais18, autorId: storiesTable.autorId }).from(storiesTable).where(eq(storiesTable.id, id)).limit(1);
  return !!r && bloqueadoMais18(v, r);
}
export function liveBloqueada(v: Visualizador, live: { mais18: boolean; criadorId: number }): boolean {
  return bloqueadoMais18(v, { mais18: live.mais18, autorId: live.criadorId });
}
