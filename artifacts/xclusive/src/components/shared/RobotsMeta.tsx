import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { politicaRobots } from '@/lib/robots';

/** Atualiza <meta name="robots"> a cada mudança de rota (política em lib/robots.ts). Não desenha nada. */
export function RobotsMeta() {
  const [caminho] = useLocation();
  useEffect(() => {
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'robots'; document.head.appendChild(meta); }
    meta.content = politicaRobots(caminho);
  }, [caminho]);
  return null;
}
