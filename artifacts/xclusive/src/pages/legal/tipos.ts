import type { PaginaLegalKey } from './useLegalDocs';

export type RunLegal = { t: string; b?: true; i?: true; u?: true };
export type BlocoLegal =
  | { tipo: 'titulo' | 'subtitulo' | 'linha-versao' | 'artigo' | 'p'; alinhamento?: 'centro'; runs: RunLegal[]; alterado?: string }
  | { tipo: 'li'; alinhamento?: 'centro'; lista: { nivel: number; formato: string; id: string }; runs: RunLegal[]; alterado?: string }
  | { tipo: 'tabela'; linhas: RunLegal[][][][] };
export type DocumentoLegal = { documento: PaginaLegalKey; origem: { ficheiro: string; sha256: string }; blocos: BlocoLegal[] };
