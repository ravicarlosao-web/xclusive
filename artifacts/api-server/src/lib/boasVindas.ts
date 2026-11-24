import { sql, eq } from "drizzle-orm";
import { db, boasVindasConfigTable, platformSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import { permissaoMensagem } from "./permissaoMensagem";
import { idadeEmAnos, IDADE_MINIMA_VER } from "./mais18";
import { eContaAdmin } from "./contasPublicas";
import { urlImagemMensagem, verificarImagemMensagem, urlMedia } from "./storage";

/**
 * Mensagem automática de boas-vindas da criadora (PR 1: servidor). Documentação: docs/deploy/boas-vindas.md.
 *
 * Fluxo: o «seguir» (routes/users.ts) só chama agendarBoasVindas(), que NÃO espera e NUNCA lança: grava uma linha em boas_vindas_envios (única por par
 * criadora–seguidor, para sempre) e acorda o trabalhador. O trabalhador (processarFilaBoasVindas) valida as regras, aplica os limites anti-abuso e entrega a
 * mensagem como uma mensagem normal da criadora na conversa criadora→seguidor (tabela messages; a ligação fica em boas_vindas_envios.message_id).
 */

/** Todos os valores configuráveis ficam aqui (e só aqui). */
export const BOAS_VINDAS = {
  /** Interruptor geral em platform_settings: {"value": true} liga; ausente (ou outro valor) = DESLIGADO. */
  CHAVE_INTERRUPTOR: "boas_vindas_ativas",
  TEXTO_MAX: 1000,
  IMAGEM_MAX_BYTES: 5 * 1024 * 1024,
  /** Por seguidor, somando TODAS as criadoras. */
  SEGUIDOR_POR_HORA: 10,
  SEGUIDOR_POR_DIA: 30,
  /** Por criadora (fila: o excedente espera, não se perde). */
  CRIADORA_POR_MINUTO: 60,
  CRIADORA_POR_DIA: 5000,
  /** Um envio em espera descarta-se passadas estas horas. */
  EXPIRA_HORAS: 24,
  /** Erros técnicos repetidos: ao fim destas tentativas o envio fica «falhada». */
  MAX_TENTATIVAS: 5,
  LOTE: 50,
  INTERVALO_MS: 5000,
} as const;

const HORA = 3_600_000, DIA = 86_400_000, MINUTO = 60_000;
const CHAVE_LOCK = 7_314_001;   // pg_advisory_xact_lock: um só trabalhador de cada vez (também com vários processos)

// ── Texto ─────────────────────────────────────────────────────────────────────

/**
 * Texto da mensagem: sem HTML (as etiquetas e os < > soltos são retirados), sem caracteres de controlo nem de direção invisíveis, quebras de linha
 * normalizadas (no máximo 2 seguidas) e aparado. Máximo 1000 caracteres DEPOIS de limpo. Vazio é válido (a mensagem pode ser só a imagem).
 */
export function limparTextoBoasVindas(bruto: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
  if (bruto === undefined || bruto === null) return { ok: true, texto: "" };
  if (typeof bruto !== "string") return { ok: false, erro: "O texto tem de ser uma frase." };
  if (bruto.length > BOAS_VINDAS.TEXTO_MAX * 4) return { ok: false, erro: `O texto pode ter no máximo ${BOAS_VINDAS.TEXTO_MAX} caracteres.` };
  const t = bruto.normalize("NFC").replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/<\/?[A-Za-z!?][^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if ([...t].length > BOAS_VINDAS.TEXTO_MAX) return { ok: false, erro: `O texto pode ter no máximo ${BOAS_VINDAS.TEXTO_MAX} caracteres.` };
  return { ok: true, texto: t };
}

// ── Interruptor geral ─────────────────────────────────────────────────────────

type Leitor = Pick<typeof db, "select">;
/** true SÓ com {"value": true} em platform_settings. Linha em falta, false ou valor estranho = desligado. */
export async function boasVindasLigadas(exec: Leitor = db): Promise<boolean> {
  const [row] = await exec.select({ value: platformSettingsTable.value }).from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, BOAS_VINDAS.CHAVE_INTERRUPTOR)).limit(1);
  return (row?.value as { value?: unknown } | null | undefined)?.value === true;
}

// ── Configuração da criadora ──────────────────────────────────────────────────

export interface ConfigBoasVindasVista {
  configurada: boolean;
  texto: string;
  midiaTipo: "nenhuma" | "imagem";
  midiaUrl: string | null;
  ativa: boolean;
  desativadaPorAdmin: boolean;
  atualizadoEm: string | null;
}

const VAZIA: ConfigBoasVindasVista = { configurada: false, texto: "", midiaTipo: "nenhuma", midiaUrl: null, ativa: false, desativadaPorAdmin: false, atualizadoEm: null };

export async function lerConfigBoasVindas(criadoraId: number): Promise<ConfigBoasVindasVista> {
  const [c] = await db.select().from(boasVindasConfigTable).where(eq(boasVindasConfigTable.criadoraId, criadoraId)).limit(1);
  if (!c) return VAZIA;
  return {
    configurada: c.texto !== "" || c.midiaTipo !== "nenhuma",
    texto: c.texto, midiaTipo: c.midiaTipo as "nenhuma" | "imagem", midiaUrl: urlMedia(c.midiaUrl), ativa: c.ativa && !c.desativadaAdminEm,
    desativadaPorAdmin: !!c.desativadaAdminEm, atualizadoEm: c.atualizadoEm.toISOString(),
  };
}

export class BoasVindasErro extends Error {
  constructor(readonly httpStatus: number, message: string, readonly codigo?: string) { super(message); this.name = "BoasVindasErro"; }
}

/**
 * Guarda a configuração (cria ou substitui). A imagem passa pelo MESMO circuito da imagem de uma mensagem (URL do nosso CDN, pasta da própria criadora,
 * jpg/png/webp, verificada por HEAD) com o limite de 5 MB; nunca é um ficheiro pago/exclusivo (esses são «private://»). A imagem fica guardada UMA vez: todas as
 * mensagens apontam para o mesmo URL. Se um admin a desativou, `ativa` fica falso (a criadora não a reativa).
 */
export async function guardarConfigBoasVindas(criadoraId: number, dados: { texto?: unknown; midiaTipo?: unknown; midiaUrl?: unknown; ativa?: unknown }): Promise<ConfigBoasVindasVista> {
  const t = limparTextoBoasVindas(dados.texto);
  if (!t.ok) throw new BoasVindasErro(400, t.erro, "texto_invalido");
  const tipo = dados.midiaTipo === undefined ? "nenhuma" : dados.midiaTipo;
  if (tipo !== "nenhuma" && tipo !== "imagem") throw new BoasVindasErro(400, "O tipo de mídia tem de ser «nenhuma» ou «imagem».", "midia_tipo_invalido");
  if (dados.ativa !== undefined && typeof dados.ativa !== "boolean") throw new BoasVindasErro(400, "O campo «ativa» tem de ser verdadeiro ou falso.", "ativa_invalida");
  let midia: string | null = null;
  if (tipo === "imagem") {
    if (typeof dados.midiaUrl !== "string" || !dados.midiaUrl) throw new BoasVindasErro(400, "A imagem é obrigatória.", "midia_em_falta");
    const canonico = urlImagemMensagem(dados.midiaUrl, criadoraId);
    if (!canonico) throw new BoasVindasErro(400, "Imagem inválida.", "midia_invalida");
    const estado = await verificarImagemMensagem(canonico, BOAS_VINDAS.IMAGEM_MAX_BYTES);
    if (estado === "grande") throw new BoasVindasErro(400, "A imagem excede o limite de 5 MB.", "midia_grande");
    if (estado !== "ok") throw new BoasVindasErro(400, "Imagem inválida ou indisponível.", "midia_invalida");
    midia = canonico;
  } else if (dados.midiaUrl !== undefined && dados.midiaUrl !== null && dados.midiaUrl !== "") {
    throw new BoasVindasErro(400, "Sem imagem, não indiques um endereço de imagem.", "midia_inesperada");
  }
  if (dados.ativa === true && t.texto === "" && !midia) throw new BoasVindasErro(400, "Escreve um texto ou escolhe uma imagem antes de ativar.", "sem_conteudo");

  await db.transaction(async (tx) => {
    const [atual] = await tx.select().from(boasVindasConfigTable).where(eq(boasVindasConfigTable.criadoraId, criadoraId)).for("update").limit(1);
    const bloqueada = !!atual?.desativadaAdminEm;
    const ativa = bloqueada ? false : (dados.ativa as boolean | undefined) ?? (atual?.ativa ?? false);
    const ativaFinal = ativa && (t.texto !== "" || !!midia);
    if (atual) await tx.update(boasVindasConfigTable).set({ texto: t.texto, midiaTipo: tipo, midiaUrl: midia, ativa: ativaFinal, atualizadoEm: new Date() }).where(eq(boasVindasConfigTable.criadoraId, criadoraId));
    else await tx.insert(boasVindasConfigTable).values({ criadoraId, texto: t.texto, midiaTipo: tipo, midiaUrl: midia, ativa: ativaFinal });
  });
  return lerConfigBoasVindas(criadoraId);
}

/** Ativa/desativa. Sem configuração: 404. Desativada por um admin: 403 (a criadora não a reativa). Ativar sem conteúdo: 400. */
export async function definirAtivaBoasVindas(criadoraId: number, ativa: boolean): Promise<ConfigBoasVindasVista> {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(boasVindasConfigTable).where(eq(boasVindasConfigTable.criadoraId, criadoraId)).for("update").limit(1);
    if (!c) throw new BoasVindasErro(404, "Ainda não configuraste a mensagem de boas-vindas.", "sem_configuracao");
    if (ativa && c.desativadaAdminEm) throw new BoasVindasErro(403, "Esta mensagem foi desativada pela equipa da plataforma.", "desativada_admin");
    if (ativa && c.texto === "" && c.midiaTipo === "nenhuma") throw new BoasVindasErro(400, "Escreve um texto ou escolhe uma imagem antes de ativar.", "sem_conteudo");
    await tx.update(boasVindasConfigTable).set({ ativa, atualizadoEm: new Date() }).where(eq(boasVindasConfigTable.criadoraId, criadoraId));
  });
  return lerConfigBoasVindas(criadoraId);
}

/**
 * Apaga a configuração. Não apaga a imagem do CDN (mensagens já entregues apontam para ela). Se um admin a tinha desativado, a linha fica só com a marca
 * do admin e sem conteúdo (apagar e criar de novo não contorna a desativação).
 */
export async function apagarConfigBoasVindas(criadoraId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(boasVindasConfigTable).where(eq(boasVindasConfigTable.criadoraId, criadoraId)).for("update").limit(1);
    if (!c) return;
    if (c.desativadaAdminEm) await tx.update(boasVindasConfigTable).set({ texto: "", midiaTipo: "nenhuma", midiaUrl: null, ativa: false, atualizadoEm: new Date() }).where(eq(boasVindasConfigTable.criadoraId, criadoraId));
    else await tx.delete(boasVindasConfigTable).where(eq(boasVindasConfigTable.criadoraId, criadoraId));
  });
}

// ── Agendar (chamado pelo «seguir»; nunca espera, nunca lança) ───────────────

/** Texto do erro sem dados: só o código/nome (a mensagem de um erro da BD pode conter valores). */
const codigoDe = (err: unknown): string => String((err as { code?: unknown })?.code ?? (err as Error)?.name ?? "erro").slice(0, 40);

export function agendarBoasVindas(criadoraId: number, seguidorId: number): void {
  void (async () => {
    try {
      if (!(await boasVindasLigadas())) return;
      const r = await db.execute(sql`
        INSERT INTO boas_vindas_envios (criadora_id, seguidor_id, texto, midia_url)
        SELECT c.criadora_id, ${seguidorId}, c.texto, c.midia_url FROM boas_vindas_config c
        WHERE c.criadora_id = ${criadoraId} AND c.ativa AND c.desativada_admin_em IS NULL AND (c.texto <> '' OR c.midia_url IS NOT NULL)
        ON CONFLICT (criadora_id, seguidor_id) DO NOTHING
        RETURNING id`);
      if (r.rows.length > 0) acordarBoasVindas();
    } catch (err) {
      logger.warn({ codigo: codigoDe(err) }, "Boas-vindas: não foi possível agendar o envio");
    }
  })();
}

// ── Trabalhador ───────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export interface ResumoLote {
  desligado: boolean; ocupado: boolean;
  enviadas: number; adiadas: number; ignoradas: number; descartadas: number; falhadas: number; erros: number;
}
const novoResumo = (): ResumoLote => ({ desligado: false, ocupado: false, enviadas: 0, adiadas: 0, ignoradas: 0, descartadas: 0, falhadas: 0, erros: 0 });

type Veredicto =
  | { acao: "enviar" }
  | { acao: "adiar"; ate: Date; motivo: string }
  | { acao: "ignorar" | "descartar"; motivo: string };

interface Envio { id: number; criadora_id: number; seguidor_id: number; texto: string; midia_url: string | null; criado_em: Date | string; tentativas: number }

/** O driver devolve os timestamp sem fuso como texto (UTC): converte para Date. */
const aData = (v: Date | string): Date => v instanceof Date ? v : new Date(v.replace(" ", "T").replace(/Z?$/, "Z"));

/** Quando é que um tecto de envios («max» na janela) volta a ter vaga? null = há vaga já. */
async function vagaEm(tx: Tx, coluna: "seguidor_id" | "criadora_id", id: number, janelaMs: number, max: number, agora: Date): Promise<Date | null> {
  const desde = new Date(agora.getTime() - janelaMs).toISOString();
  const col = sql.raw(coluna);
  const r = await tx.execute(sql`SELECT enviado_em FROM boas_vindas_envios WHERE estado = 'enviada' AND ${col} = ${id} AND enviado_em > ${desde}::timestamp ORDER BY enviado_em DESC LIMIT ${max}`);
  if (r.rows.length < max) return null;
  const mais_antigo = aData((r.rows[r.rows.length - 1] as { enviado_em: Date | string }).enviado_em);
  return new Date(mais_antigo.getTime() + janelaMs + 1000);
}

async function avaliar(tx: Tx, e: Envio, agora: Date): Promise<Veredicto> {
  if (aData(e.criado_em).getTime() < agora.getTime() - BOAS_VINDAS.EXPIRA_HORAS * HORA) return { acao: "descartar", motivo: "expirou_24h" };

  const r = await tx.execute(sql`
    SELECT c.ativo AS c_ativo, c.tipo_conta AS c_tipo, c.verificado AS c_verif, c.role AS c_role,
           f.ativo AS f_ativo, f.role AS f_role, f.data_nascimento AS f_nasc, (f.email_verificado_em IS NOT NULL) AS f_email,
           EXISTS (SELECT 1 FROM follows WHERE seguidor_id = f.id AND seguido_id = c.id) AS segue,
           EXISTS (SELECT 1 FROM user_legal_acceptances a WHERE a.user_id = f.id AND a.maioridade_confirmada = true) AS aceitou,
           (g.criadora_id IS NOT NULL) AS tem_cfg, COALESCE(g.ativa, false) AS cfg_ativa, (g.desativada_admin_em IS NOT NULL) AS cfg_admin
    FROM users c JOIN users f ON f.id = ${e.seguidor_id} LEFT JOIN boas_vindas_config g ON g.criadora_id = c.id
    WHERE c.id = ${e.criadora_id}`);
  const x = r.rows[0] as Record<string, unknown> | undefined;
  if (!x) return { acao: "descartar", motivo: "conta_inexistente" };

  if (!x.tem_cfg) return { acao: "ignorar", motivo: "sem_configuracao" };
  if (x.cfg_admin) return { acao: "ignorar", motivo: "desativada_admin" };
  if (!x.cfg_ativa) return { acao: "ignorar", motivo: "desativada" };
  if (!x.c_ativo) return { acao: "ignorar", motivo: "criadora_inativa" };
  if (x.c_tipo !== "criador" || !x.c_verif || eContaAdmin({ role: String(x.c_role) })) return { acao: "ignorar", motivo: "criadora_invalida" };
  if (!x.f_ativo) return { acao: "ignorar", motivo: "seguidor_inativo" };
  if (eContaAdmin({ role: String(x.f_role) })) return { acao: "ignorar", motivo: "seguidor_admin" };
  if (!x.segue) return { acao: "descartar", motivo: "deixou_de_seguir" };
  const idade = idadeEmAnos(typeof x.f_nasc === "string" ? x.f_nasc : null);
  if (idade === null || idade < IDADE_MINIMA_VER || !x.aceitou) return { acao: "ignorar", motivo: "sem_requisito_idade" };
  if (!x.f_email) return { acao: "ignorar", motivo: "email_nao_verificado" };
  const perm = await permissaoMensagem(e.criadora_id, { destinatarioId: e.seguidor_id }, tx);
  if (perm.estado === "fui_bloqueado" || perm.estado === "bloqueaste") return { acao: "ignorar", motivo: "bloqueio" };
  if (perm.estado === "regra") return { acao: "ignorar", motivo: "regra_do_destinatario" };

  // Limites anti-abuso: o excedente espera (não se perde) até a janela libertar.
  const limites: [("seguidor_id" | "criadora_id"), number, number, number, string][] = [
    ["seguidor_id", e.seguidor_id, HORA, BOAS_VINDAS.SEGUIDOR_POR_HORA, "limite_seguidor_hora"],
    ["seguidor_id", e.seguidor_id, DIA, BOAS_VINDAS.SEGUIDOR_POR_DIA, "limite_seguidor_dia"],
    ["criadora_id", e.criadora_id, MINUTO, BOAS_VINDAS.CRIADORA_POR_MINUTO, "limite_criadora_minuto"],
    ["criadora_id", e.criadora_id, DIA, BOAS_VINDAS.CRIADORA_POR_DIA, "limite_criadora_dia"],
  ];
  let adiar: { ate: Date; motivo: string } | null = null;
  for (const [col, id, janela, max, motivo] of limites) {
    const ate = await vagaEm(tx, col, id, janela, max, agora);
    if (ate && (!adiar || ate > adiar.ate)) adiar = { ate, motivo };
  }
  if (adiar) return { acao: "adiar", ...adiar };
  return { acao: "enviar" };
}

async function conversaDoPar(tx: Tx, criadoraId: number, seguidorId: number): Promise<number> {
  const r = await tx.execute(sql`
    SELECT c.id FROM conversations c
    JOIN conversation_participants a ON a.conversation_id = c.id AND a.utilizador_id = ${criadoraId}
    JOIN conversation_participants b ON b.conversation_id = c.id AND b.utilizador_id = ${seguidorId}
    WHERE c.tipo = 'privada' ORDER BY c.id LIMIT 1`);
  if (r.rows.length > 0) return Number((r.rows[0] as { id: number }).id);
  const n = await tx.execute(sql`INSERT INTO conversations (tipo) VALUES ('privada') RETURNING id`);
  const id = Number((n.rows[0] as { id: number }).id);
  await tx.execute(sql`INSERT INTO conversation_participants (conversation_id, utilizador_id) VALUES (${id}, ${criadoraId}), (${id}, ${seguidorId})`);
  return id;
}

async function processarUm(tx: Tx, e: Envio, agora: Date, resumo: ResumoLote): Promise<void> {
  const iso = agora.toISOString();
  const v = await avaliar(tx, e, agora);
  if (v.acao === "adiar") {
    await tx.execute(sql`UPDATE boas_vindas_envios SET proxima_em = ${v.ate.toISOString()}::timestamp, motivo = ${v.motivo} WHERE id = ${e.id}`);
    resumo.adiadas++; return;
  }
  if (v.acao === "ignorar" || v.acao === "descartar") {
    await tx.execute(sql`UPDATE boas_vindas_envios SET estado = ${v.acao === "ignorar" ? "ignorada" : "descartada"}, motivo = ${v.motivo} WHERE id = ${e.id}`);
    if (v.acao === "ignorar") resumo.ignoradas++; else resumo.descartadas++;
    return;
  }
  const conversaId = await conversaDoPar(tx, e.criadora_id, e.seguidor_id);
  const m = await tx.execute(sql`
    INSERT INTO messages (conversation_id, autor_id, tipo, conteudo, media_url, criado_em)
    VALUES (${conversaId}, ${e.criadora_id}, ${e.midia_url ? "imagem" : "texto"}::message_tipo, ${e.texto === "" ? null : e.texto}, ${e.midia_url}, ${iso}::timestamp) RETURNING id`);
  const mensagemId = Number((m.rows[0] as { id: number }).id);
  await tx.execute(sql`UPDATE boas_vindas_envios SET estado = 'enviada', motivo = NULL, message_id = ${mensagemId}, enviado_em = ${iso}::timestamp WHERE id = ${e.id}`);
  resumo.enviadas++;
}

/**
 * Processa um lote da fila (um trabalhador de cada vez: lock consultivo + SKIP LOCKED). Cada envio corre num savepoint: se um falha (erro técnico), regista-se
 * a tentativa (sem dados) e os outros seguem. `agora` só existe para os testes poderem avançar o relógio.
 */
export async function processarFilaBoasVindas(opcoes: { agora?: Date; lote?: number } = {}): Promise<ResumoLote> {
  const agora = opcoes.agora ?? new Date();
  const resumo = novoResumo();
  await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${CHAVE_LOCK}) AS ok`);
    if (!(lock.rows[0] as { ok: boolean }).ok) { resumo.ocupado = true; return; }
    if (!(await boasVindasLigadas(tx))) { resumo.desligado = true; return; }
    const fila = await tx.execute(sql`
      SELECT id, criadora_id, seguidor_id, texto, midia_url, criado_em, tentativas FROM boas_vindas_envios
      WHERE estado = 'pendente' AND proxima_em <= ${agora.toISOString()}::timestamp ORDER BY criado_em, id LIMIT ${opcoes.lote ?? BOAS_VINDAS.LOTE} FOR UPDATE SKIP LOCKED`);
    for (const linha of fila.rows as unknown as Envio[]) {
      try {
        await tx.transaction(async (sp) => { await processarUm(sp, linha, agora, resumo); });
      } catch (err) {
        resumo.erros++;
        const tentativas = Number(linha.tentativas) + 1, falhou = tentativas >= BOAS_VINDAS.MAX_TENTATIVAS;
        const espera = Math.min(30_000 * 2 ** (tentativas - 1), 15 * MINUTO);
        logger.warn({ envioId: linha.id, tentativas, codigo: codigoDe(err) }, "Boas-vindas: erro ao enviar");
        await tx.execute(sql`UPDATE boas_vindas_envios SET tentativas = ${tentativas}, motivo = 'erro_envio', estado = ${falhou ? "falhada" : "pendente"}, proxima_em = ${new Date(agora.getTime() + espera).toISOString()}::timestamp WHERE id = ${linha.id}`);
        if (falhou) resumo.falhadas++;
      }
    }
  });
  return resumo;
}

// ── Arranque do trabalhador (no próprio processo da API) ──────────────────────

let aCorrer = false, repetir = false;
async function ciclo(): Promise<void> {
  if (aCorrer) { repetir = true; return; }
  aCorrer = true;
  try {
    do {
      repetir = false;
      const r = await processarFilaBoasVindas();
      if (r.enviadas > 0 || r.falhadas > 0) logger.info({ enviadas: r.enviadas, falhadas: r.falhadas, adiadas: r.adiadas }, "Boas-vindas: lote processado");
    } while (repetir);
  } catch (err) {
    logger.error({ codigo: codigoDe(err) }, "Boas-vindas: falha no ciclo");
  } finally { aCorrer = false; }
}

/** Pede um ciclo já (depois de agendar). Nunca lança. */
export function acordarBoasVindas(): void { void ciclo(); }

export function startBoasVindasJob(): void {
  setInterval(() => { void ciclo(); }, BOAS_VINDAS.INTERVALO_MS).unref();
}
