import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db, postsTable, postMediaTable, likesTable, savedPostsTable, commentsTable, usersTable, followsTable,
  subscriptionsTable, purchasesTable,
} from "@workspace/db";
import { subscricaoComAcesso } from "./exclusiveAccess";
import { resolveMediaUrl, urlMedia } from "./storage";
import { commentVisivel } from "./takedown";
import { lerVisualizador, postVisivelPara } from "./conteudoMais18";
import { postsComInfracaoAtiva } from "./infracoesMais18";
import { lerEnquetesEmLote } from "./enquetes";

/**
 * Feed por separadores: Tudo | Seguindo | Para ti | Em alta.
 *
 * Todos aplicam a MESMA condição de visibilidade (`postVisivelPara`: não retirado, autor ativo — sem encerradas, banidas nem
 * suspensas —, preferência +18) e a paginação atual. A página e o total saem numa só consulta (`count(*) over()`).
 * A formatação dos posts é feita EM LOTE (autores, média, gostos, comentários, "curtido", "guardado", acessos exclusivos e
 * infrações numa consulta cada), em vez de ~8 consultas por post: o custo por carregamento deixa de crescer com o nº de posts.
 */

export const FILTROS_FEED = ["tudo", "seguindo", "para-ti", "em-alta"] as const;
export type FiltroFeed = typeof FILTROS_FEED[number];

const JANELA_ALTA_MS = 72 * 60 * 60 * 1000;

export function lerFiltro(v: unknown): FiltroFeed | null {
  if (v === undefined || v === null || v === "") return "tudo";
  return (FILTROS_FEED as readonly string[]).includes(String(v)) ? (String(v) as FiltroFeed) : null;
}

type Linha = typeof postsTable.$inferSelect;

/** Posts ordenados e já filtrados para o separador pedido, com a contagem total. */
async function paginaDoFeed(o: { userId: number; filtro: FiltroFeed; limit: number; offset: number }): Promise<{ posts: Linha[]; total: number }> {
  const visualizador = await lerVisualizador(o.userId);
  const visivel = postVisivelPara(visualizador);
  const total = sql<number>`count(*) over()::int`;

  if (o.filtro === "tudo") {
    const rows = await db.select({ p: postsTable, total }).from(postsTable).where(visivel).orderBy(desc(postsTable.criadoEm)).limit(o.limit).offset(o.offset);
    return { posts: rows.map((r) => r.p), total: rows[0]?.total ?? 0 };
  }

  const seguidos = db.select({ id: followsTable.seguidoId }).from(followsTable)
    .where(and(eq(followsTable.seguidorId, o.userId), eq(followsTable.estado, "aceite")));

  if (o.filtro === "seguindo") {
    const rows = await db.select({ p: postsTable, total }).from(postsTable)
      .where(and(visivel, inArray(postsTable.autorId, seguidos))).orderBy(desc(postsTable.criadoEm)).limit(o.limit).offset(o.offset);
    return { posts: rows.map((r) => r.p), total: rows[0]?.total ?? 0 };
  }

  // Pontuação das últimas 72 h: gostos + comentários visíveis, por agregação (uma passagem por tabela, sem N+1).
  const desde = new Date(Date.now() - JANELA_ALTA_MS);
  const gostos = db.select({ alvoId: likesTable.alvoId, gn: sql<number>`count(*)::int`.as("gn") }).from(likesTable)
    .where(and(eq(likesTable.alvoTipo, "post"), gt(likesTable.criadoEm, desde))).groupBy(likesTable.alvoId).as("gostos_72h");
  const comentarios = db.select({ postId: commentsTable.postId, cn: sql<number>`count(*)::int`.as("cn") }).from(commentsTable)
    .where(and(gt(commentsTable.criadoEm, desde), commentVisivel())).groupBy(commentsTable.postId).as("coment_72h");
  const pontos = sql<number>`coalesce(${gostos.gn}, 0) + coalesce(${comentarios.cn}, 0)`;
  const base = db.select({ p: postsTable, total }).from(postsTable)
    .leftJoin(gostos, eq(gostos.alvoId, postsTable.id)).leftJoin(comentarios, eq(comentarios.postId, postsTable.id));

  if (o.filtro === "em-alta") {
    const rows = await base.where(and(visivel, sql`${pontos} > 0`)).orderBy(desc(pontos), desc(postsTable.criadoEm)).limit(o.limit).offset(o.offset);
    return { posts: rows.map((r) => r.p), total: rows[0]?.total ?? 0 };
  }

  // "Para ti": posts de quem sigo e os que estão em alta (mais recentes primeiro). Sem algoritmo novo.
  const rows = await base.where(and(visivel, sql`(${postsTable.autorId} IN (${seguidos}) OR ${pontos} > 0)`)).orderBy(desc(postsTable.criadoEm)).limit(o.limit).offset(o.offset);
  return { posts: rows.map((r) => r.p), total: rows[0]?.total ?? 0 };
}

/** Mesma forma que `formatPost` (routes/posts.ts), calculada em lote para a página inteira. */
export async function formatarPostsEmLote(posts: Linha[], userId: number) {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const autorIds = [...new Set(posts.map((p) => p.autorId))];

  const [autores, medias, gostos, comentarios, meusGostos, meusGuardados, enquetes] = await Promise.all([
    db.select().from(usersTable).where(inArray(usersTable.id, autorIds)),
    db.select().from(postMediaTable).where(inArray(postMediaTable.postId, ids)).orderBy(postMediaTable.ordem),
    db.select({ id: likesTable.alvoId, n: sql<number>`count(*)::int` }).from(likesTable).where(and(eq(likesTable.alvoTipo, "post"), inArray(likesTable.alvoId, ids))).groupBy(likesTable.alvoId),
    db.select({ id: commentsTable.postId, n: sql<number>`count(*)::int` }).from(commentsTable).where(and(inArray(commentsTable.postId, ids), commentVisivel())).groupBy(commentsTable.postId),
    db.select({ id: likesTable.alvoId }).from(likesTable).where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "post"), inArray(likesTable.alvoId, ids))),
    db.select({ id: savedPostsTable.postId }).from(savedPostsTable).where(and(eq(savedPostsTable.utilizadorId, userId), inArray(savedPostsTable.postId, ids))),
    // Enquetes (posts de texto): no máximo 2 consultas, em paralelo; a 0 se a página não tiver posts de texto.
    lerEnquetesEmLote(posts, userId),
  ]);

  // Conteúdo exclusivo: acesso do próprio autor, por subscrição com acesso ou por compra PPV (uma consulta cada, em lote).
  const exclusivos = posts.filter((p) => p.exclusivo && p.autorId !== userId);
  const comSubscricao = new Set<number>();
  const comCompra = new Set<string>();
  if (exclusivos.length > 0) {
    const subs = await db.select({ criadorId: subscriptionsTable.criadorId }).from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.subscriitorId, userId), inArray(subscriptionsTable.criadorId, [...new Set(exclusivos.map((p) => p.autorId))]), subscricaoComAcesso()));
    for (const s of subs) comSubscricao.add(s.criadorId);
    const compras = await db.select({ conteudoId: purchasesTable.conteudoId, vendedorId: purchasesTable.vendedorId }).from(purchasesTable)
      .where(and(eq(purchasesTable.compradorId, userId), eq(purchasesTable.tipo, "ppv"), inArray(purchasesTable.conteudoId, exclusivos.map((p) => p.id))));
    for (const c of compras) if (c.conteudoId !== null) comCompra.add(`${c.vendedorId}:${c.conteudoId}`);
  }

  // Infração +18 ativa: só importa nos posts da própria pessoa (esconde "Tirar +18").
  const meus = posts.filter((p) => p.autorId === userId).map((p) => p.id);
  const comInfracao = meus.length > 0 ? await postsComInfracaoAtiva(db, meus) : new Set<number>();

  const autorPor = new Map(autores.map((a) => [a.id, a]));
  const mediaPor = new Map<number, typeof medias>();
  for (const m of medias) { const l = mediaPor.get(m.postId) ?? []; l.push(m); mediaPor.set(m.postId, l); }
  const nGostos = new Map(gostos.map((g) => [g.id, g.n]));
  const nComentarios = new Map(comentarios.map((c) => [c.id, c.n]));
  const curtidos = new Set(meusGostos.map((g) => g.id));
  const guardados = new Set(meusGuardados.map((g) => g.id));

  return posts.map((post) => {
    const user = autorPor.get(post.autorId);
    const acesso = !post.exclusivo || post.autorId === userId || comSubscricao.has(post.autorId) || comCompra.has(`${post.autorId}:${post.id}`);
    const media = mediaPor.get(post.id) ?? [];
    const mediaSegura = acesso
      ? media.map((m) => ({ id: m.id, url: resolveMediaUrl(m.url), tipo: m.tipo, ordem: m.ordem }))
      : media.map((m) => ({ id: m.id, url: null, tipo: m.tipo, ordem: m.ordem, bloqueado: true }));
    return {
      id: post.id,
      autor: user ? {
        id: user.id, username: user.username, nomeExibicao: user.nomeExibicao,
        avatarUrl: urlMedia(user.avatarUrl), verificado: user.verificado, tipoConta: user.tipoConta,
        estaASeguir: false, segueVoce: false, totalSeguidores: 0,
      } : null,
      legenda: post.legenda,
      localizacao: post.localizacao,
      tipo: post.tipo,
      media: mediaSegura,
      exclusivo: post.exclusivo,
      mais18: post.mais18,
      mais18Bloqueado: post.autorId === userId ? comInfracao.has(post.id) : false,
      bloqueado: post.exclusivo && !acesso,
      precoDesbloqueio: post.precoDesbloqueio ? parseFloat(post.precoDesbloqueio) : null,
      totalCurtidas: nGostos.get(post.id) ?? 0,
      totalComentarios: nComentarios.get(post.id) ?? 0,
      curtido: curtidos.has(post.id),
      guardado: guardados.has(post.id),
      criadoEm: post.criadoEm.toISOString(),
      ...(enquetes.has(post.id) ? { enquete: enquetes.get(post.id) } : {}),
    };
  });
}

export async function lerFeed(o: { userId: number; filtro: FiltroFeed; page: number; limit: number }) {
  const offset = (o.page - 1) * o.limit;
  const { posts, total } = await paginaDoFeed({ userId: o.userId, filtro: o.filtro, limit: o.limit, offset });
  const formatados = await formatarPostsEmLote(posts, o.userId);
  return { posts: formatados, total, page: o.page, hasMore: offset + posts.length < total };
}

/**
 * Publicações de um perfil, mais recentes primeiro, paginadas. Mesma visibilidade (`postVisivelPara`) e mesma formatação em
 * lote do feed: `curtido` e `guardado` são os do visitante e o nº de consultas não cresce com o nº de posts.
 */
export async function lerPostsDoAutor(o: { viewerId: number; autorId: number; page: number; limit: number }) {
  const offset = (o.page - 1) * o.limit;
  const visualizador = await lerVisualizador(o.viewerId);
  const total = sql<number>`count(*) over()::int`;
  const rows = await db.select({ p: postsTable, total }).from(postsTable)
    .where(and(eq(postsTable.autorId, o.autorId), postVisivelPara(visualizador)))
    .orderBy(desc(postsTable.criadoEm), desc(postsTable.id)).limit(o.limit).offset(offset);
  const posts = await formatarPostsEmLote(rows.map((r) => r.p), o.viewerId);
  // Fora do fim da lista a janela vem vazia e o `count(*) over()` não existe: o total só é exato dentro do intervalo.
  const totalReal = rows[0]?.total ?? (offset === 0 ? 0 : await totalDoAutor(o.viewerId, o.autorId, visualizador));
  return { posts, total: totalReal, page: o.page, hasMore: offset + posts.length < totalReal };
}

async function totalDoAutor(_viewerId: number, autorId: number, visualizador: Awaited<ReturnType<typeof lerVisualizador>>): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(postsTable).where(and(eq(postsTable.autorId, autorId), postVisivelPara(visualizador)));
  return r?.n ?? 0;
}
