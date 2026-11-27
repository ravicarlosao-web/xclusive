import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { politicaRobots, canonicoDe } from '@/lib/robots';

/** Atualiza <meta name="robots"> e o <link rel="canonical"> a cada mudança de rota (política em lib/robots.ts). Não desenha nada. */
export function RobotsMeta() {
  const [caminho] = useLocation();
  useEffect(() => {
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'robots'; document.head.appendChild(meta); }
    meta.content = politicaRobots(caminho);
    // Canónico só na página inicial (o index.html é o mesmo para todas as rotas, por isso não pode ter um canónico fixo).
    const canonico = canonicoDe(caminho);
    let ligacao = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonico) {
      if (!ligacao) { ligacao = document.createElement('link'); ligacao.rel = 'canonical'; document.head.appendChild(ligacao); }
      ligacao.href = canonico;
    } else if (ligacao) {
      ligacao.remove();
    }
  }, [caminho]);
  return null;
}
