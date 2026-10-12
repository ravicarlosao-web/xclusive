import { useEffect, useState } from 'react';
import { LegalLayout } from './LegalLayout';

/** Lê o e-mail de contacto para pedidos de retirada (GET /api/reports/contact). Devolve null se falhar. */
async function lerEmailContacto(): Promise<string | null> {
  try {
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
    const res = await fetch(`${base}/api/reports/contact`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const { email } = (await res.json()) as { email?: unknown };
    // Só aceita algo com forma de e-mail (nunca injeta texto arbitrário num link mailto).
    return typeof email === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

export default function DireitosAutor() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    lerEmailContacto().then((e) => { if (vivo) setEmail(e); });
    return () => { vivo = false; };
  }, []);

  return (
    <LegalLayout docKey="direitosAutor">
      <div className="rounded-xl border border-dashed border-yellow-500/50 bg-yellow-500/5 p-6 text-sm space-y-3" data-testid="legal-placeholder">
        <p className="text-foreground" data-testid="takedown-contact">
          Para pedir a retirada de conteúdo, escreve{' '}
          {email ? (
            <>para <a href={`mailto:${email}`} className="font-semibold text-primary underline" data-testid="takedown-email">{email}</a></>
          ) : (
            'à equipa'
          )}{' '}
          indicando o link do conteúdo e o motivo. Texto jurídico em preparação.
        </p>
        <p className="text-muted-foreground">
          Em pedidos por direitos de autor, inclui também a prova de titularidade.
        </p>
      </div>
    </LegalLayout>
  );
}
