// Textos legais v1.1 (do advogado), gerados a partir dos .docx por scripts/legal/docx-para-json.mjs.
// NÃO editar os JSON à mão: scripts/legal/verificar.mjs (corre no build) falha se divergirem do .docx + manifesto.
import termos from '../../../../../docs/legal/v1.1/01-termos.json';
import privacidade from '../../../../../docs/legal/v1.1/02-privacidade.json';
import conteudo from '../../../../../docs/legal/v1.1/03-politica-de-conteudo.json';
import direitosAutor from '../../../../../docs/legal/v1.1/04-direitos-de-autor.json';
import reembolsos from '../../../../../docs/legal/v1.1/05-reembolsos.json';
import type { LegalDocKey } from './useLegalDocs';
import type { DocumentoLegal } from './tipos';

export const DOCUMENTOS_LEGAIS: Record<LegalDocKey, DocumentoLegal> = {
  termos: termos as unknown as DocumentoLegal,
  privacidade: privacidade as unknown as DocumentoLegal,
  conteudo: conteudo as unknown as DocumentoLegal,
  direitosAutor: direitosAutor as unknown as DocumentoLegal,
  reembolsos: reembolsos as unknown as DocumentoLegal,
};
