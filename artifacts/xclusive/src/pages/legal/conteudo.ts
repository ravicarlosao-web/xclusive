// Textos legais (do advogado: v2.2 termos, privacidade e cookies; v2.3 conteúdo, reembolsos, direitos de autor e criadoras; v1.1 só o Modelo de Consentimento), gerados a partir dos .docx por scripts/legal/docx-para-json.mjs.
// NÃO editar os JSON à mão: scripts/legal/verificar.mjs (corre no build) falha se divergirem do .docx + manifesto.
import termos from '../../../../../docs/legal/v2.2/01-termos.json';
import privacidade from '../../../../../docs/legal/v2.2/02-privacidade.json';
import cookies from '../../../../../docs/legal/v2.2/03-politica-de-cookies.json';
import conteudo from '../../../../../docs/legal/v2.3/04-politica-de-conteudo.json';
import reembolsos from '../../../../../docs/legal/v2.3/05-reembolsos.json';
import direitosAutor from '../../../../../docs/legal/v2.3/06-direitos-de-autor.json';
import criadoras from '../../../../../docs/legal/v2.3/12-termos-criadoras.json';
import consentimento from '../../../../../docs/legal/v1.1/07-consentimento-terceiros.json';
import type { PaginaLegalKey } from './useLegalDocs';
import type { DocumentoLegal } from './tipos';

export const DOCUMENTOS_LEGAIS: Record<PaginaLegalKey, DocumentoLegal> = {
  termos: termos as unknown as DocumentoLegal,
  privacidade: privacidade as unknown as DocumentoLegal,
  cookies: cookies as unknown as DocumentoLegal,
  conteudo: conteudo as unknown as DocumentoLegal,
  direitosAutor: direitosAutor as unknown as DocumentoLegal,
  reembolsos: reembolsos as unknown as DocumentoLegal,
  criadoras: criadoras as unknown as DocumentoLegal,
  consentimento: consentimento as unknown as DocumentoLegal,
};
