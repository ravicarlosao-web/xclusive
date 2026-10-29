import { and, eq, inArray, sql } from "drizzle-orm";
import { db, postsTable, enquetesTable, enqueteOpcoesTable, enqueteVotosTable, followsTable } from "@workspace/db";
import { lerVisualizador, postVisivelPara } from "./conteudoMais18";

/**
 * Enquetes: um post de texto (tipo 'texto') com uma linha em `enquetes` (pergunta = legenda do post), 2 a 4 opções e votos.
 *
 *  - Voto anónimo para os outros: o criador e os restantes só veem TOTAIS; a ligação voto → conta nunca sai da BD nem entra
 *    em logs, respostas ou no snapshot das denúncias.
 *  - Um voto por conta, sem alterar. O autor não vota. "Só seguidores" exige seguimento aceite.
 *  - O fim é calculado em consulta (termina_em contra a hora do servidor, passada como parâmetro): não há jobs nem polling.
 *  - Os votos por opção só vão na resposta a quem já votou, ao autor, ou quando a enquete terminou (antes, só o total).
 */

export const DURACOES_DIAS = [1, 3, 7] as const;
export const AUDIENCIAS = ["todos", "seguidores"] as const;
export type Audiencia = typeof AUDIENCIAS[number];
export const MAX_TEXTO_OPCAO = 60;
export const MIN_OPCOES = 2;
export const MAX_OPCOES = 4;
const DIA_MS = 24 * 60 * 60 * 1000;

export const MSG_ENQUETE = {
  opcoes: `Uma enquete tem entre ${MIN_OPCOES} e ${MAX_OPCOES} opções.`,
  opcaoVazia: "Nenhuma opção pode estar vazia.",
  opcaoLonga: `Cada opção tem no máximo ${MAX_TEXTO_OPCAO} caracteres.`,
  opcaoRepetida: "As opções não podem ser repetidas.",
  opcaoInvalida: "Uma opção tem caracteres inválidos.",
  duracao: "A duração tem de ser 1, 3 ou 7 dias.",
  audiencia: "Indica quem pode votar: todos ou só seguidores.",
  pergunta: "Escreve a pergunta da enquete.",
  semMedia: "Uma enquete não pode ter fotos nem vídeos.",
  gratuita: "Uma enquete é sempre gratuita: não pode ser exclusiva nem ter preço.",
  soTexto: "Uma enquete é uma publicação de texto.",
  dados: "Dados da enquete inválidos.",
  autor: "Não podes votar na tua própria enquete.",
  seguidores: "Só seguidores podem votar.",
  jaVotou: "Já votaste nesta enquete.",
  terminou: "Esta enquete já terminou.",
  opcaoDeOutra: "Opção inválida.",
  naoExiste: "Não encontrado",
} as const;

export class EnqueteErro extends Error {
  constructor(msg: string, public readonly httpStatus: number, public readonly codigo?: string) { super(msg); this.name = "EnqueteErro"; }
}

export interface NovaEnquete { opcoes: string[]; duracaoDias: 1 | 3 | 7; audiencia: Audiencia }

/** Normaliza para comparar duplicados: sem acentos, minúsculas e espaços colapsados. */
const chaveOpcao = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Valida o objeto `enquete` do POST /posts. Devolve o valor limpo ou a mensagem (400). */
export function validarNovaEnquete(raw: unknown): { ok: true; valor: NovaEnquete } | { ok: false; erro: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, erro: MSG_ENQUETE.dados };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.opcoes) || r.opcoes.some((o) => typeof o !== "string")) return { ok: false, erro: MSG_ENQUETE.opcoes };
  const opcoes = (r.opcoes as string[]).map((o) => o.trim());
  if (opcoes.length < MIN_OPCOES || opcoes.length > MAX_OPCOES) return { ok: false, erro: MSG_ENQUETE.opcoes };
  for (const o of opcoes) {
    if (o.length === 0) return { ok: false, erro: MSG_ENQUETE.opcaoVazia };
    if (Array.from(o).length > MAX_TEXTO_OPCAO) return { ok: false, erro: MSG_ENQUETE.opcaoLonga };
    if (/[\u0000-\u001f\u007f]/.test(o)) return { ok: false, erro: MSG_ENQUETE.opcaoInvalida };
  }
  if (new Set(opcoes.map(chaveOpcao)).size !== opcoes.length) return { ok: false, erro: MSG_ENQUETE.opcaoRepetida };
  const duracaoDias = r.duracaoDias === undefined ? 1 : r.duracaoDias;
  if (!(DURACOES_DIAS as readonly unknown[]).includes(duracaoDias)) return { ok: false, erro: MSG_ENQUETE.duracao };
  const audiencia = r.audiencia === undefined ? "todos" : r.audiencia;
  if (!(AUDIENCIAS as readonly unknown[]).includes(audiencia)) return { ok: false, erro: MSG_ENQUETE.audiencia };
  return { ok: true, valor: { opcoes, duracaoDias: duracaoDias as 1 | 3 | 7, audiencia: audiencia as Audiencia } };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;

/** Cria a enquete (e as opções) para um post já inserido, na transação do chamador. */
export async function criarEnquete(tx: Tx, postId: number, v: NovaEnquete, agora: Date = new Date()): Promise<void> {
  const [e] = await tx.insert(enquetesTable).values({ postId, audiencia: v.audiencia, terminaEm: new Date(agora.getTime() + v.duracaoDias * DIA_MS) }).returning({ id: enquetesTable.id });
  await tx.insert(enqueteOpcoesTable).values(v.opcoes.map((texto, ordem) => ({ enqueteId: e.id, ordem, texto })));
}

/** Percentagens inteiras que somam 100 (método do maior resto; empates pela ordem). Sem votos: tudo a 0. */
export function percentagens(votos: number[]): number[] {
  const total = votos.reduce((a, b) => a + b, 0);
  if (total <= 0) return votos.map(() => 0);
  const base = votos.map((v) => Math.floor((v * 100) / total));
  let falta = 100 - base.reduce((a, b) => a + b, 0);
  const ordem = votos.map((v, i) => ({ i, resto: (v * 100) % total })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of ordem) { if (falta <= 0) break; base[i] += 1; falta -= 1; }
  return base;
}

export type MotivoNaoVota = "autor" | "seguidores" | "encerrada" | "ja_votou";
export interface EnqueteJson {
  id: number;
  audiencia: Audiencia;
  terminaEm: string;
  encerrada: boolean;
  totalVotos: number;
  opcoes: { id: number; texto: string; votos: number | null; percentagem: number | null }[];
  meuVoto: number | null;
  podeVotar: boolean;
  motivo: MotivoNaoVota | null;
}

const lista = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/**
 * Enquetes de uma página de posts, EM LOTE: no máximo 2 consultas (a 0 se a página não tiver posts de texto), em paralelo.
 *   A) enquetes + opções + contagem de votos por opção (agrupada);
 *   B) o meu voto em cada uma e, só se alguma for "só seguidores", quem dos autores eu sigo.
 */
export async function lerEnquetesEmLote(posts: { id: number; autorId: number; tipo: string }[], userId: number, agora: Date = new Date()): Promise<Map<number, EnqueteJson>> {
  const out = new Map<number, EnqueteJson>();
  const candidatos = posts.filter((p) => p.tipo === "texto");
  if (candidatos.length === 0) return out;
  const idsPost = candidatos.map((p) => p.id);

  const linhas = await db.select({
    enqueteId: enquetesTable.id, postId: enquetesTable.postId, audiencia: enquetesTable.audiencia, terminaEm: enquetesTable.terminaEm,
    opcaoId: enqueteOpcoesTable.id, ordem: enqueteOpcoesTable.ordem, texto: enqueteOpcoesTable.texto, votos: sql<number>`count(${enqueteVotosTable.id})::int`,
  }).from(enquetesTable)
    .innerJoin(enqueteOpcoesTable, eq(enqueteOpcoesTable.enqueteId, enquetesTable.id))
    .leftJoin(enqueteVotosTable, eq(enqueteVotosTable.opcaoId, enqueteOpcoesTable.id))
    .where(inArray(enquetesTable.postId, idsPost))
    .groupBy(enquetesTable.id, enqueteOpcoesTable.id)
    .orderBy(enquetesTable.id, enqueteOpcoesTable.ordem);
  if (linhas.length === 0) return out;

  const porEnquete = new Map<number, typeof linhas>();
  for (const l of linhas) { const a = porEnquete.get(l.enqueteId) ?? []; a.push(l); porEnquete.set(l.enqueteId, a); }
  const autorDoPost = new Map(candidatos.map((p) => [p.id, p.autorId]));
  const idsEnquete = [...porEnquete.keys()];
  const autoresSeguidores = [...new Set([...porEnquete.values()].filter((ls) => ls[0].audiencia === "seguidores").map((ls) => autorDoPost.get(ls[0].postId)!).filter((a) => a !== userId))];

  const r = await db.execute(autoresSeguidores.length > 0
    ? sql`select 'voto' as k, v.enquete_id as a, v.opcao_id as b from enquete_votos v where v.user_id = ${userId} and v.enquete_id in (${lista(idsEnquete)})
          union all
          select 'segue' as k, f.seguido_id as a, 0 as b from follows f where f.seguidor_id = ${userId} and f.estado = 'aceite' and f.seguido_id in (${lista(autoresSeguidores)})`
    : sql`select 'voto' as k, v.enquete_id as a, v.opcao_id as b from enquete_votos v where v.user_id = ${userId} and v.enquete_id in (${lista(idsEnquete)})`);
  const meuVoto = new Map<number, number>();
  const sigo = new Set<number>();
  for (const row of r.rows as { k: string; a: number; b: number }[]) { if (row.k === "voto") meuVoto.set(Number(row.a), Number(row.b)); else sigo.add(Number(row.a)); }

  for (const [enqueteId, ls] of porEnquete) {
    const e = ls[0];
    const autorId = autorDoPost.get(e.postId)!;
    const encerrada = e.terminaEm.getTime() <= agora.getTime();
    const voto = meuVoto.get(enqueteId) ?? null;
    const ehAutor = autorId === userId;
    const total = ls.reduce((a, l) => a + l.votos, 0);
    const mostra = encerrada || ehAutor || voto !== null;
    const pct = percentagens(ls.map((l) => l.votos));
    let motivo: MotivoNaoVota | null = null;
    if (ehAutor) motivo = "autor";
    else if (encerrada) motivo = "encerrada";
    else if (voto !== null) motivo = "ja_votou";
    else if (e.audiencia === "seguidores" && !sigo.has(autorId)) motivo = "seguidores";
    out.set(e.postId, {
      id: enqueteId, audiencia: e.audiencia as Audiencia, terminaEm: e.terminaEm.toISOString(), encerrada, totalVotos: total,
      opcoes: ls.map((l, i) => ({ id: l.opcaoId, texto: l.texto, votos: mostra ? l.votos : null, percentagem: mostra ? pct[i] : null })),
      meuVoto: voto, podeVotar: motivo === null, motivo,
    });
  }
  return out;
}

/** Vota (atómico). Devolve a enquete atualizada para quem votou. */
export async function votar(o: { postId: number; userId: number; opcaoId: number; agora?: Date }): Promise<EnqueteJson> {
  const agora = o.agora ?? new Date();
  const visualizador = await lerVisualizador(o.userId);
  const [post] = await db.select({ id: postsTable.id, autorId: postsTable.autorId, tipo: postsTable.tipo }).from(postsTable)
    .where(and(eq(postsTable.id, o.postId), postVisivelPara(visualizador))).limit(1);
  if (!post) throw new EnqueteErro(MSG_ENQUETE.naoExiste, 404);
  const [e] = await db.select().from(enquetesTable).where(eq(enquetesTable.postId, post.id)).limit(1);
  if (!e) throw new EnqueteErro(MSG_ENQUETE.naoExiste, 404);
  if (post.autorId === o.userId) throw new EnqueteErro(MSG_ENQUETE.autor, 403, "enquete_autor");
  if (e.audiencia === "seguidores") {
    const [f] = await db.select({ id: followsTable.id }).from(followsTable)
      .where(and(eq(followsTable.seguidorId, o.userId), eq(followsTable.seguidoId, post.autorId), eq(followsTable.estado, "aceite"))).limit(1);
    if (!f) throw new EnqueteErro(MSG_ENQUETE.seguidores, 403, "enquete_so_seguidores");
  }
  const [opcao] = await db.select({ id: enqueteOpcoesTable.id }).from(enqueteOpcoesTable)
    .where(and(eq(enqueteOpcoesTable.id, o.opcaoId), eq(enqueteOpcoesTable.enqueteId, e.id))).limit(1);
  if (!opcao) throw new EnqueteErro(MSG_ENQUETE.opcaoDeOutra, 400);

  // Um só comando: só insere se ainda não terminou (hora do servidor, como parâmetro) e se a conta ainda não votou.
  const iso = agora.toISOString();
  const ins = await db.execute(sql`insert into enquete_votos (enquete_id, opcao_id, user_id, criado_em)
    select e.id, ${opcao.id}, ${o.userId}, ${iso}::timestamp from enquetes e where e.id = ${e.id} and e.termina_em > ${iso}::timestamp
    on conflict (enquete_id, user_id) do nothing returning id`);
  if (ins.rows.length === 0) {
    if (e.terminaEm.getTime() <= agora.getTime()) throw new EnqueteErro(MSG_ENQUETE.terminou, 409, "enquete_encerrada");
    throw new EnqueteErro(MSG_ENQUETE.jaVotou, 409, "enquete_ja_votou");
  }
  const m = await lerEnquetesEmLote([{ id: post.id, autorId: post.autorId, tipo: post.tipo }], o.userId, agora);
  return m.get(post.id)!;
}

export interface AlvoEnquete {
  audiencia: Audiencia;
  terminaEm: string;
  totalVotos: number;
  opcoes: { ordem: number; texto: string; votos: number }[];
}

/** Dados da enquete para o snapshot da denúncia e para o admin: pergunta é a legenda (já no resumo); totais, nunca votantes. */
export async function enquetePara(q: Q, postId: number): Promise<AlvoEnquete | null> {
  const linhas = await q.select({
    audiencia: enquetesTable.audiencia, terminaEm: enquetesTable.terminaEm, ordem: enqueteOpcoesTable.ordem, texto: enqueteOpcoesTable.texto,
    votos: sql<number>`count(${enqueteVotosTable.id})::int`,
  }).from(enquetesTable)
    .innerJoin(enqueteOpcoesTable, eq(enqueteOpcoesTable.enqueteId, enquetesTable.id))
    .leftJoin(enqueteVotosTable, eq(enqueteVotosTable.opcaoId, enqueteOpcoesTable.id))
    .where(eq(enquetesTable.postId, postId))
    .groupBy(enquetesTable.id, enqueteOpcoesTable.id)
    .orderBy(enqueteOpcoesTable.ordem);
  if (linhas.length === 0) return null;
  return {
    audiencia: linhas[0].audiencia as Audiencia, terminaEm: linhas[0].terminaEm.toISOString(),
    totalVotos: linhas.reduce((a, l) => a + l.votos, 0),
    opcoes: linhas.map((l) => ({ ordem: l.ordem, texto: l.texto, votos: l.votos })),
  };
}
