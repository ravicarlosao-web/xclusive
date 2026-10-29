import { formatDistanceToNowStrict } from 'date-fns';
import { pt } from 'date-fns/locale';

/** "há 5 minutos", "há 2 horas", "há 3 dias" (pt-PT). Menos de um minuto: "agora mesmo". Data inválida: texto vazio. */
export function haTempo(iso: string, agora: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (agora - d.getTime() < 60_000) return 'agora mesmo';
  return formatDistanceToNowStrict(d, { locale: pt, addSuffix: true });
}

/** Tempo que falta para uma enquete terminar: "Termina em 3 dias", "Termina em 5 h", "Termina em 12 min"; "Encerrada" depois do fim. */
export function terminaEmTexto(iso: string, agora: number = Date.now()): string {
  const ms = new Date(iso).getTime() - agora;
  if (!Number.isFinite(ms) || ms <= 0) return 'Encerrada';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `Termina em ${Math.max(1, min)} min`;
  const h = Math.ceil(ms / 3600000);
  if (h < 24) return `Termina em ${h} h`;
  const d = Math.ceil(ms / 86400000);
  return `Termina em ${d} ${d === 1 ? 'dia' : 'dias'}`;
}
