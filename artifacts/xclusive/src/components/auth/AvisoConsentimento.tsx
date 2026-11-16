import { Link } from 'wouter';

/** Frase de aviso dos ecrãs de login e de registo (único texto de aviso desses ecrãs). As duas ligações são do site e abrem no mesmo separador. */
export function AvisoConsentimento() {
  return (
    <p data-testid="aviso-consentimento" className="text-xs text-center text-muted-foreground">
      Ao fazer login e usar a xclusive, você concorda com os nossos{' '}
      <Link href="/termos" data-testid="aviso-termos" className="text-primary hover:underline">termos de serviços</Link>{' '}
      e{' '}
      <Link href="/privacidade" data-testid="aviso-privacidade" className="text-primary hover:underline">política de privacidade</Link>{' '}
      e confirma que tem pelo menos 18 anos.
    </p>
  );
}
