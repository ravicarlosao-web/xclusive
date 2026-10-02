import { useEffect } from 'react';

const SITE_URL = 'https://xclusive.ao';
const DEFAULT_TITLE = 'Xclusive — Conteúdo Exclusivo para Criadores Angolanos';
const DEFAULT_DESCRIPTION =
  'Xclusive é a primeira plataforma angolana de conteúdo exclusivo. Monetiza o teu conteúdo, cresce a tua audiência e ganha dinheiro diretamente dos teus fãs — sem intermediários.';

interface PageMeta {
  title: string;
  description?: string;
  /** Caminho canónico (ex.: '/registo'). Omitir para não alterar o canonical. */
  path?: string;
  /** true = páginas que não devem ser indexadas (404, fluxos privados). */
  noindex?: boolean;
}

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Atualiza title, description, canonical, Open Graph e robots por página
 * (a SPA só tem um index.html). Repõe os valores por defeito ao desmontar.
 */
export function usePageMeta({ title, description, path, noindex }: PageMeta) {
  useEffect(() => {
    const desc = description ?? DEFAULT_DESCRIPTION;
    document.title = title;
    setMeta('meta[name="description"]', 'name', 'description', desc);
    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', desc);
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', desc);

    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const ogUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (path !== undefined) {
      const url = `${SITE_URL}${path}`;
      canonical?.setAttribute('href', url);
      ogUrl?.setAttribute('content', url);
    }

    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const prevRobots = robots?.getAttribute('content') ?? null;
    if (noindex && robots) robots.setAttribute('content', 'noindex, nofollow');

    return () => {
      document.title = DEFAULT_TITLE;
      setMeta('meta[name="description"]', 'name', 'description', DEFAULT_DESCRIPTION);
      if (robots && prevRobots !== null) robots.setAttribute('content', prevRobots);
      canonical?.setAttribute('href', `${SITE_URL}/`);
      ogUrl?.setAttribute('content', `${SITE_URL}/`);
    };
  }, [title, description, path, noindex]);
}
