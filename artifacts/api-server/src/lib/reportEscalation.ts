import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, reportsTable } from "@workspace/db";
import { logger } from "./logger";
import { notificarAdmins, TARGET_LABEL } from "./takedown";
import { alertaExternoAtivo, enviarEMarcarAlerta, textoAlerta, type AlertaUrgente } from "./alertaExterno";

/**
 * Escalada de denúncias urgentes (categoria 'menor') por tratar.
 *
 * Uma denúncia urgente que continua 'pendente' (ninguém a abriu em análise) gera um aviso a TODOS os
 * admins ao fim de 1 h e outro ao fim de 24 h.
 *
 * - Idempotente: o aviso e o marcador (escalada_1h_em / escalada_24h_em) saem da MESMA transação; uma
 *   denúncia com o marcador preenchido nunca é reavisada nesse nível. Se já passaram 24 h, envia só o
 *   aviso de 24 h e marca também o de 1 h.
 * - Seguro com várias instâncias: pg_try_advisory_xact_lock + FOR UPDATE SKIP LOCKED.
 * - Canal externo (webhook): entregue com sucesso → reports.alerta_externo_em. O job reenvia as urgentes
 *   pendentes sem esse marcador (webhook em baixo, envio imediato perdido), no máx. LOTE_REENVIO por
 *   corrida e a parar à primeira falha. Reenviar NÃO cria notificações internas. Os envios correm sob o
 *   mesmo lock, para duas instâncias não enviarem o mesmo alerta.
 */
const ADVISORY_LOCK_KEY = 727_001_002;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const HORA = 60 * 60 * 1000;
/** Margem para não reenviar o que o envio imediato (na criação) ainda está a entregar. */
const MARGEM_REENVIO_MS = 2 * 60 * 1000;
const LOTE_REENVIO = 10;

export async function runReportEscalation(now: Date = new Date()): Promise<{ escaladas: number; alertasExternos: number } | null> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS ok`);
    if (!(lock.rows[0] as { ok: boolean } | undefined)?.ok) return null; // outra instância está a correr

    const h1 = new Date(now.getTime() - HORA);
    const h24 = new Date(now.getTime() - 24 * HORA);
    const idade = (criadoEm: Date) => Math.max(0, Math.floor((now.getTime() - criadoEm.getTime()) / 60_000));

    // 1) Escalada (notificações internas + marcadores, atómicas)
    const due = await tx
      .select({
        id: reportsTable.id, targetType: reportsTable.targetType, reason: reportsTable.reason,
        criadoEm: reportsTable.criadoEm,
      })
      .from(reportsTable)
      .where(and(
        eq(reportsTable.urgente, true),
        eq(reportsTable.status, "pendente"),
        or(
          and(isNull(reportsTable.escalada1hEm), lte(reportsTable.criadoEm, h1)),
          and(isNull(reportsTable.escalada24hEm), lte(reportsTable.criadoEm, h24)),
        ),
      ))
      .for("update", { skipLocked: true });

    const envios: AlertaUrgente[] = [];
    for (const d of due) {
      const nivel = d.criadoEm <= h24 ? "24h" : "1h";
      const alerta: AlertaUrgente = { reportId: d.id, alvo: TARGET_LABEL[d.targetType], motivo: d.reason, nivel, idadeMin: idade(d.criadoEm) };
      await notificarAdmins(tx, textoAlerta(alerta), d.id);
      await tx.update(reportsTable).set(
        nivel === "24h" ? { escalada1hEm: now, escalada24hEm: now } : { escalada1hEm: now },
      ).where(eq(reportsTable.id, d.id));
      envios.push(alerta);
    }

    // 2) Canal externo: os avisos desta corrida + reenvio das urgentes pendentes sem entrega confirmada.
    //    Tudo sob o mesmo lock (duas instâncias nunca enviam o mesmo); pára à primeira falha.
    let enviados = 0;
    if (alertaExternoAtivo()) {
      const jaNaLista = new Set(envios.map((e) => e.reportId));
      const pend = await tx
        .select({
          id: reportsTable.id, targetType: reportsTable.targetType, reason: reportsTable.reason,
          criadoEm: reportsTable.criadoEm, e1: reportsTable.escalada1hEm, e24: reportsTable.escalada24hEm,
        })
        .from(reportsTable)
        .where(and(
          eq(reportsTable.urgente, true),
          eq(reportsTable.status, "pendente"),
          isNull(reportsTable.alertaExternoEm),
          lte(reportsTable.criadoEm, new Date(now.getTime() - MARGEM_REENVIO_MS)),
        ))
        .orderBy(asc(reportsTable.criadoEm))
        .limit(LOTE_REENVIO)
        .for("update", { skipLocked: true });
      for (const d of pend) {
        if (jaNaLista.has(d.id)) continue;
        envios.push({
          reportId: d.id, alvo: TARGET_LABEL[d.targetType], motivo: d.reason, idadeMin: idade(d.criadoEm),
          nivel: d.e24 ? "24h" : d.e1 ? "1h" : "nova",
        });
      }
      for (const a of envios) {
        if (!(await enviarEMarcarAlerta(a, tx))) break;
        enviados++;
      }
    }
    return { escaladas: due.length, alertasExternos: enviados };
  });
}

export function startReportEscalationJob(): void {
  const intervalMs = Number(process.env.REPORT_ESCALATION_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const tick = () => {
    runReportEscalation()
      .then((r) => { if (r && (r.escaladas > 0 || r.alertasExternos > 0)) logger.info(r, "Denúncias urgentes escaladas"); })
      .catch((err) => logger.error({ err }, "Falha no job de escalada de denúncias urgentes"));
  };
  tick();
  setInterval(tick, intervalMs).unref();
}
