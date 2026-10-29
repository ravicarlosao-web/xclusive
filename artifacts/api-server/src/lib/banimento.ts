import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db, usersTable, kycSubmissionsTable, identifierBlocksTable, accountClosuresTable, auditLogTable,
} from "@workspace/db";
import { suspenderConta } from "./suspensao";
import { logger } from "./logger";

/**
 * Banimento permanente.
 *
 * Banir = a conta fica inacessível e invisível para sempre (ativo=false + banida_em, sessões/tokens/sockets revogados) e os
 * identificadores (email, número de documento do KYC) ficam bloqueados em `identifier_blocks`, SÓ COMO HASH: nunca em claro
 * na BD, nos logs, nas respostas nem no audit. Tudo numa transação, com a linha do utilizador bloqueada (FOR UPDATE).
 *
 * Hash = HMAC-SHA256 com o pepper BAN_HASH_PEPPER como chave; o "sal" é o prefixo fixo de domínio (versão + tipo), o que
 * impede que o hash de um email coincida com o de um documento. O pepper vive só no ambiente do servidor.
 */

export const MSG_CONTA_BANIDA = "A tua conta foi encerrada de forma permanente.";
export const MSG_REGISTO_RECUSADO = "Não foi possível criar a conta.";
export const MSG_PEDIDO_RECUSADO = "Não foi possível processar o pedido.";
const PEPPER_ENV = "BAN_HASH_PEPPER";
const VERSAO_HASH = "xclusive-ban-v1";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;
export type TipoIdentificador = "email" | "documento";

function pepper(): string | null {
  const v = process.env[PEPPER_ENV]?.trim();
  return v ? v : null;
}

/** O banimento (e a verificação nos registos) só funcionam com o pepper configurado. */
export const pepperConfigurado = (): boolean => pepper() !== null;

let avisouSemPepper = false;
/** Aviso seguro (uma vez por processo): o registo e o KYC continuam, mas sem a verificação de bloqueios. */
export function avisarSemPepper(): void {
  if (avisouSemPepper) return;
  avisouSemPepper = true;
  logger.warn({ codigo: "ban_pepper_em_falta" }, `${PEPPER_ENV} não está definido: a verificação de identificadores banidos está desligada.`);
}

/**
 * Email normalizado: minúsculas e sem espaços; em gmail.com/googlemail.com remove também os pontos e o "+etiqueta" da parte
 * local (para a Google são o mesmo endereço) e unifica o domínio em gmail.com. Nos outros fornecedores NÃO se mexe na parte
 * local: "+" e "." podem ser endereços diferentes e bloquear de mais prejudicaria quem não tem nada a ver.
 */
export function normalizarEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const arroba = e.lastIndexOf("@");
  if (arroba < 1) return e;
  let local = e.slice(0, arroba);
  let dominio = e.slice(arroba + 1);
  if (dominio === "gmail.com" || dominio === "googlemail.com") {
    dominio = "gmail.com";
    local = local.split("+")[0].replace(/\./g, "");
  }
  return `${local}@${dominio}`;
}

/** Documento normalizado: sem acentos, espaços nem pontuação, em maiúsculas (só A–Z e 0–9). */
export function normalizarDocumento(doc: string): string {
  return doc.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Hash do identificador (já normalizado pela função própria do tipo). Lança se não houver pepper. */
export function hashIdentificador(tipo: TipoIdentificador, valorNormalizado: string): string {
  const p = pepper();
  if (!p) throw new BanimentoErro(`O banimento permanente não está disponível: falta configurar ${PEPPER_ENV} no servidor.`, 503, "pepper_em_falta");
  return createHmac("sha256", p).update(`${VERSAO_HASH}:${tipo}:${valorNormalizado}`).digest("hex");
}

export const hashEmail = (email: string): string => hashIdentificador("email", normalizarEmail(email));
export const hashDocumento = (doc: string): string => hashIdentificador("documento", normalizarDocumento(doc));

/** O identificador está bloqueado? Sem pepper devolve false (e avisa uma vez); nunca falha o fluxo por isso. */
export async function identificadorBloqueado(q: Q, tipo: TipoIdentificador, valor: string): Promise<boolean> {
  if (!pepperConfigurado()) { avisarSemPepper(); return false; }
  const norm = tipo === "email" ? normalizarEmail(valor) : normalizarDocumento(valor);
  if (!norm) return false;
  const [b] = await q.select({ id: identifierBlocksTable.id }).from(identifierBlocksTable)
    .where(and(eq(identifierBlocksTable.tipo, tipo), eq(identifierBlocksTable.hash, hashIdentificador(tipo, norm)))).limit(1);
  return !!b;
}

export class BanimentoErro extends Error {
  constructor(msg: string, public readonly httpStatus: number, public readonly codigo?: string) { super(msg); this.name = "BanimentoErro"; }
}

export type BanirOpcoes = { userId: number; adminId: number; motivo: string; ip: string | null; origem?: "banimento" | "menor"; casoId?: number };
export type BanirResultado = { hashesEmail: number; hashesDocumento: number };

/**
 * Bane a conta DENTRO da transação do chamador (o chamador bloqueia a linha do utilizador antes, se precisar).
 * Sem pepper não se bane (nada é alterado). Funciona sobre contas ativas, suspensas ou encerradas.
 */
export async function banirContaNaTransacao(tx: Tx, o: BanirOpcoes): Promise<BanirResultado> {
  if (!pepperConfigurado()) hashIdentificador("email", "x");
  if (o.userId === o.adminId) throw new BanimentoErro("Não podes banir a tua própria conta.", 403);

  const [u] = await tx.select().from(usersTable).where(eq(usersTable.id, o.userId)).for("update");
  if (!u) throw new BanimentoErro("Utilizador não encontrado.", 404);
  if (u.role === "admin" || u.role === "superadmin") throw new BanimentoErro("Não é possível banir uma conta de administrador.", 403);
  if (u.banidaEm) throw new BanimentoErro("Esta conta já está banida.", 409);

  // Hashes ANTES de qualquer escrita: o email da conta e todos os números de documento que já submeteu ao KYC.
  const documentos = await tx.select({ n: kycSubmissionsTable.numeroDocumento }).from(kycSubmissionsTable).where(eq(kycSubmissionsTable.userId, o.userId));
  const hDocs = [...new Set(documentos.map((d) => normalizarDocumento(d.n)).filter((n) => n.length > 0))].map((n) => hashIdentificador("documento", n));
  const hEmail = hashEmail(u.email);
  const origem = o.origem ?? "banimento";

  // Suspensão partilhada (ativo=false, sessões e refresh tokens revogados) e só depois a marca de banida (CHECK da BD).
  await suspenderConta(tx, o.userId, { adminId: o.adminId, ip: o.ip, origem: origem === "menor" ? "menor" : "banimento" });
  await tx.update(usersTable).set({ banidaEm: new Date() }).where(eq(usersTable.id, o.userId));

  const base = { origem, userId: o.userId, banidaPor: o.adminId, motivo: o.motivo, casoId: o.casoId ?? null };
  await tx.insert(identifierBlocksTable).values([
    { ...base, tipo: "email", hash: hEmail },
    ...hDocs.map((h) => ({ ...base, tipo: "documento" as const, hash: h })),
  ]).onConflictDoNothing();

  // Encerramento pendente deste utilizador: sai da fila de purga (os dados de um banido conservam-se como prova).
  await tx.update(accountClosuresTable).set({ estado: "banida", processadaEm: new Date() })
    .where(and(eq(accountClosuresTable.userId, o.userId), eq(accountClosuresTable.estado, "pendente")));

  await tx.insert(auditLogTable).values({
    adminId: o.adminId, action: "conta_banida", targetType: "user", targetId: o.userId,
    details: { motivo: o.motivo, bloqueios: { email: 1, documento: hDocs.length }, estavaEncerrada: !!u.encerradaEm, origem },
    ipAddress: o.ip,
  });
  return { hashesEmail: 1, hashesDocumento: hDocs.length };
}

/** Bane a conta de forma permanente (só o admin), numa transação própria. */
export async function banirConta(o: BanirOpcoes): Promise<BanirResultado> {
  // Sem pepper não se bane (nada é alterado): falha clara ANTES de abrir a transação.
  if (!pepperConfigurado()) hashIdentificador("email", "x");
  if (o.userId === o.adminId) throw new BanimentoErro("Não podes banir a tua própria conta.", 403);
  return db.transaction((tx) => banirContaNaTransacao(tx, o));
}
