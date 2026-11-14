import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Proteção do login de admin: bloqueio temporário por CONTA e por IP, persistido na BD (tabela admin_login_controlo).
 *  - conta: 5 falhas na janela de 15 min bloqueiam essa conta; IP: 20 falhas (vários admins podem partilhar um IP de escritório).
 *  - bloqueio temporário com escalada: 15, 30, 60, 120 e 240 min (teto) se voltar a falhar; volta ao início após 24 h sem falhas.
 *  - durante o bloqueio a palavra-passe certa também é recusada e as tentativas NÃO contam (não prolongam o bloqueio: ninguém o mantém para sempre).
 *  - a chave da conta é o SHA-256 do email normalizado: contas inexistentes não ficam guardadas em claro nem se distinguem das existentes.
 * Todas as decisões de tempo usam o relógio da BD (now()); cada falha corre numa transação com a linha trancada (sem corridas).
 */
export const JANELA_MIN = 15;
export const LIMITE_CONTA = 5;
export const LIMITE_IP = 20;
export const BLOQUEIO_BASE_MIN = 15;
export const BLOQUEIO_MAX_MIN = 240;
export const NIVEL_CADUCA_HORAS = 24;

export type Escopo = "conta" | "ip";
export const chaveConta = (emailNormalizado: string): string => createHash("sha256").update(emailNormalizado).digest("hex");
export const chaveIp = (ip: string | undefined): string => (ip ?? "desconhecido").slice(0, 45);

/** Minutos de bloqueio para um nível (0 → 15, 1 → 30, 2 → 60, 3 → 120, 4+ → 240). */
export const minutosDeBloqueio = (nivel: number): number => Math.min(BLOQUEIO_MAX_MIN, BLOQUEIO_BASE_MIN * 2 ** Math.max(0, nivel));

/** Segundos que faltam para o fim do bloqueio (0 = sem bloqueio), por conta e por IP. */
export async function segundosBloqueado(conta: string, ip: string): Promise<{ conta: number; ip: number }> {
  const r = await db.execute(sql`select tipo, greatest(0, ceil(extract(epoch from (bloqueado_ate - now()))))::int as s
    from admin_login_controlo where bloqueado_ate > now() and ((tipo = 'conta' and chave = ${conta}) or (tipo = 'ip' and chave = ${ip}))`);
  const out = { conta: 0, ip: 0 };
  for (const l of r.rows as { tipo: Escopo; s: number }[]) out[l.tipo] = l.s;
  return out;
}

export interface ResultadoFalha { bloqueouAgora: boolean; minutos?: number; nivel?: number; falhas: number }

/** Conta uma falha. Se a conta/IP já está bloqueado não conta (devolve falhas 0 e bloqueouAgora false). */
export async function registarFalha(escopo: Escopo, chave: string): Promise<ResultadoFalha> {
  const limite = escopo === "conta" ? LIMITE_CONTA : LIMITE_IP;
  return db.transaction(async (tx) => {
    await tx.execute(sql`insert into admin_login_controlo (tipo, chave) values (${escopo}, ${chave}) on conflict (tipo, chave) do nothing`);
    const [c] = (await tx.execute(sql`select falhas, nivel, (bloqueado_ate is not null and bloqueado_ate > now()) as bloqueado,
        (janela_inicio <= now() - make_interval(mins => ${JANELA_MIN})) as janela_expirada,
        (atualizado_em <= now() - make_interval(hours => ${NIVEL_CADUCA_HORAS})) as nivel_caducado
      from admin_login_controlo where tipo = ${escopo} and chave = ${chave} for update`)).rows as { falhas: number; nivel: number; bloqueado: boolean; janela_expirada: boolean; nivel_caducado: boolean }[];
    if (c.bloqueado) return { bloqueouAgora: false, falhas: 0 };
    const falhas = c.janela_expirada ? 1 : c.falhas + 1;
    const nivelAtual = c.nivel_caducado ? 0 : c.nivel;
    if (falhas >= limite) {
      const minutos = minutosDeBloqueio(nivelAtual);
      await tx.execute(sql`update admin_login_controlo set falhas = 0, janela_inicio = now(), nivel = ${nivelAtual + 1}, atualizado_em = now(),
        bloqueado_ate = now() + make_interval(mins => ${minutos}) where tipo = ${escopo} and chave = ${chave}`);
      return { bloqueouAgora: true, minutos, nivel: nivelAtual + 1, falhas };
    }
    await tx.execute(sql`update admin_login_controlo set falhas = ${falhas}, nivel = ${nivelAtual}, atualizado_em = now(),
      janela_inicio = case when ${c.janela_expirada} then now() else janela_inicio end where tipo = ${escopo} and chave = ${chave}`);
    // Limpeza oportunista (limita o crescimento da tabela): linhas sem bloqueio ativo e sem falhas há mais de 24 h.
    await tx.execute(sql`delete from admin_login_controlo where atualizado_em <= now() - make_interval(hours => ${NIVEL_CADUCA_HORAS}) and (bloqueado_ate is null or bloqueado_ate <= now())`);
    return { bloqueouAgora: false, falhas };
  });
}

/** Login certo: zera as falhas seguidas da conta (o nível de escalada só caduca com o tempo). O IP nunca é zerado por um sucesso. */
export async function limparFalhasConta(conta: string): Promise<void> {
  await db.execute(sql`update admin_login_controlo set falhas = 0 where tipo = 'conta' and chave = ${conta} and (bloqueado_ate is null or bloqueado_ate <= now())`);
}
