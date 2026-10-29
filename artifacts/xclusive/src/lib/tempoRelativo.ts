import { formatDistanceToNowStrict } from 'date-fns';
import { pt } from 'date-fns/locale';

/** "há 5 minutos", "há 2 horas", "há 3 dias" (pt-PT). Menos de um minuto: "agora mesmo". Data inválida: texto vazio. */
export function haTempo(iso: string, agora: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (agora - d.getTime() < 60_000) return 'agora mesmo';
  return formatDistanceToNowStrict(d, { locale: pt, addSuffix: true });
}
