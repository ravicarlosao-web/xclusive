// Resolução dos tokens dos textos legais. Módulo SEM dependências: é usado pelo site e, transpilado, pela
// verificação do build (scripts/legal/verificar.mjs), para que ambos resolvam exatamente da mesma maneira.
//
// Sintaxe (ver docs/legal/v1.1/alteracoes.json):
//   {{NOME}}              valor do legal-config
//   {{?NOME}}...{{/}}     cláusula opcional: só aparece se NOME tiver valor (sem aninhamento)

export type LegalConfig = {
  empresaNome: string;
  empresaNif: string | null;
  empresaSede: string | null;
  emailLegal: string;
  minimoLevantamento: number;
  prazoLevantamentoMin: number;
  prazoLevantamentoMax: number;
};

export type Segmento = { tipo: 'texto' | 'email'; t: string };

export const TOKENS = ['EMPRESA_NOME', 'EMPRESA_NIF', 'EMPRESA_SEDE', 'EMAIL_LEGAL', 'MINIMO_LEVANTAMENTO', 'PRAZO_MIN', 'PRAZO_MAX'] as const;
const OPCIONAIS = ['EMPRESA_NIF', 'EMPRESA_SEDE'];

/** "5000" -> "5.000 Kz" (o toLocaleString('pt-PT') não agrupa números de 4 dígitos). */
export function formatarKz(valor: number): string {
  const negativo = valor < 0; const abs = Math.abs(valor);
  const [inteiro, decimais] = abs.toFixed(Number.isInteger(abs) ? 0 : 2).split('.');
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${agrupado}${decimais ? ',' + decimais : ''} Kz`;
}

/** Valida a resposta do legal-config. Lança se faltar algo que o texto precisa (nunca se renderiza com buracos). */
export function validarConfig(cfg: unknown): LegalConfig {
  const c = cfg as Partial<Record<keyof LegalConfig, unknown>> | null;
  const texto = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const opcional = (v: unknown) => v === null || typeof v === 'string';
  const numero = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!c || !texto(c.empresaNome) || !texto(c.emailLegal) || !opcional(c.empresaNif) || !opcional(c.empresaSede)
    || !numero(c.minimoLevantamento) || !numero(c.prazoLevantamentoMin) || !numero(c.prazoLevantamentoMax)) {
    throw new Error('Configuração dos textos legais inválida ou incompleta.');
  }
  return c as LegalConfig;
}

function valorDe(nome: string, cfg: LegalConfig): string {
  switch (nome) {
    case 'EMPRESA_NOME': return cfg.empresaNome;
    case 'EMPRESA_NIF': return cfg.empresaNif ?? '';
    case 'EMPRESA_SEDE': return cfg.empresaSede ?? '';
    case 'EMAIL_LEGAL': return cfg.emailLegal;
    case 'MINIMO_LEVANTAMENTO': return formatarKz(cfg.minimoLevantamento);
    case 'PRAZO_MIN': return String(cfg.prazoLevantamentoMin);
    case 'PRAZO_MAX': return String(cfg.prazoLevantamentoMax);
    default: throw new Error(`Token desconhecido: {{${nome}}}`);
  }
}

/** Resolve um texto com tokens em segmentos (o email sai à parte, para ser apresentado como ligação mailto:). */
export function resolverTemplate(template: string, cfg: LegalConfig): Segmento[] {
  const segmentos: Segmento[] = [];
  const juntar = (s: Segmento) => { const u = segmentos[segmentos.length - 1]; if (u && u.tipo === 'texto' && s.tipo === 'texto') u.t += s.t; else segmentos.push(s); };
  const re = /\{\{(\?)?([A-Z_]+|\/)\}\}/g;
  let ultimo = 0; let omitir = false; let abertoPara: string | null = null; let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (!omitir) juntar({ tipo: 'texto', t: template.slice(ultimo, m.index) });
    ultimo = m.index + m[0].length;
    if (m[2] === '/') {
      if (abertoPara === null) throw new Error('{{/}} sem {{?NOME}} correspondente.');
      abertoPara = null; omitir = false;
    } else if (m[1] === '?') {
      if (abertoPara !== null) throw new Error('Cláusulas opcionais não podem ser aninhadas.');
      if (!OPCIONAIS.includes(m[2])) throw new Error(`O token {{${m[2]}}} não pode ser opcional.`);
      abertoPara = m[2]; omitir = valorDe(m[2], cfg).trim() === '';
    } else if (!omitir) {
      const v = valorDe(m[2], cfg);
      if (v.trim() === '') throw new Error(`O token {{${m[2]}}} está vazio fora de uma cláusula opcional.`);
      juntar({ tipo: m[2] === 'EMAIL_LEGAL' ? 'email' : 'texto', t: v });
    }
  }
  if (abertoPara !== null) throw new Error(`Cláusula opcional {{?${abertoPara}}} sem {{/}}.`);
  if (!omitir) juntar({ tipo: 'texto', t: template.slice(ultimo) });
  const texto = segmentos.map((s) => s.t).join('');
  if (/\{\{|\}\}/.test(texto)) throw new Error('Texto com marcador por resolver.');
  return segmentos;
}

export const textoResolvido = (template: string, cfg: LegalConfig): string => resolverTemplate(template, cfg).map((s) => s.t).join('');
