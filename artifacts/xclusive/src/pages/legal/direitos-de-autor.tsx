import { LegalLayout } from './LegalLayout';

// O email do pedido de retirada (Art. 4.º) vem do legal-config e aparece como ligação mailto: dentro do próprio texto do documento.
const MARCAS = { emailTestId: 'takedown-email', paragrafoComEmailTestId: 'takedown-contact' };

export default function DireitosAutor() {
  return <LegalLayout docKey="direitosAutor" marcas={MARCAS} />;
}
