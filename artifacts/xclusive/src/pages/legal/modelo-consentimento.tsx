import { LegalLayout } from './LegalLayout';
import { CONSENTIMENTO_DOCX } from './useLegalDocs';

export default function ModeloConsentimento() {
  const href = `${(import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')}/${CONSENTIMENTO_DOCX}`;
  return (
    <LegalLayout
      docKey="consentimento"
      semTokens
      acao={
        <a
          href={href}
          download
          data-testid="descarregar-docx"
          className="inline-flex items-center justify-center min-h-[44px] rounded-xl border border-border px-5 text-sm font-semibold hover:bg-secondary transition-colors"
        >
          Descarregar (.docx)
        </a>
      }
    />
  );
}
