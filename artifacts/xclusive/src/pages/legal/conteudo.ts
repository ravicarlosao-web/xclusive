// Textos legais v1.1 (do advogado), gerados a partir dos .docx por scripts/legal/docx-para-json.mjs.
// NÃO editar os JSON à mão: scripts/legal/verificar.mjs (corre no build) falha se divergirem do .docx + manifesto.
import termos from '../../../../../docs/legal/v1.1/01-termos.json';
import privacidade from '../../../../../docs/legal/v1.1/02-privacidade.json';
import conteudo from '../../../../../docs/legal/v1.1/03-politica-de-conteudo.json';
import direitosAutor from '../../../../../docs/legal/v1.1/04-direitos-de-autor.json';
import reembolsos from '../../../../../docs/legal/v1.1/05-reembolsos.json';
import criadoras from '../../../../../docs/legal/v1.1/06-termos-criadoras.json';
import consentimento from '../../../../../docs/legal/v1.1/07-consentimento-terceiros.json';
import type { PaginaLegalKey } from './useLegalDocs';
import type { DocumentoLegal } from './tipos';

export const DOCUMENTOS_LEGAIS: Record<PaginaLegalKey, DocumentoLegal> = {
  termos: termos as unknown as DocumentoLegal,
  privacidade: privacidade as unknown as DocumentoLegal,
  conteudo: conteudo as unknown as DocumentoLegal,
  direitosAutor: direitosAutor as unknown as DocumentoLegal,
  reembolsos: reembolsos as unknown as DocumentoLegal,
  criadoras: criadoras as unknown as DocumentoLegal,
  consentimento: consentimento as unknown as DocumentoLegal,
};
