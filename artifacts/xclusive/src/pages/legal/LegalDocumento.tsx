import { Fragment, type ReactNode } from 'react';
import type { BlocoLegal, DocumentoLegal, RunLegal } from './tipos';
import { resolverTemplate, type LegalConfig } from './resolver';

const REGEX_VERSAO = /^\d{1,2} de [a-zç]+ de \d{4} • Versão \d+(\.\d+)*$/;

type Marcas = {
  /** data-testid da ligação mailto: (por omissão "legal-email"). */
  emailTestId?: string;
  /** data-testid do parágrafo que contém o email. */
  paragrafoComEmailTestId?: string;
};

/** Um run: resolve tokens e aplica negrito/itálico/sublinhado do .docx. O email sai como ligação mailto:. */
function Run({ run, cfg, marcas }: { run: RunLegal; cfg: LegalConfig; marcas: Marcas }) {
  let no: ReactNode = resolverTemplate(run.t, cfg).map((s, i) =>
    s.tipo === 'email'
      ? <a key={i} href={`mailto:${s.t}`} className="text-primary underline underline-offset-2" data-testid={marcas.emailTestId ?? 'legal-email'}>{s.t}</a>
      : <Fragment key={i}>{s.t}</Fragment>);
  if (run.b) no = <strong>{no}</strong>;
  if (run.i) no = <em>{no}</em>;
  if (run.u) no = <u>{no}</u>;
  return <>{no}</>;
}

function temEmail(runs: RunLegal[], cfg: LegalConfig): boolean {
  return runs.some((r) => resolverTemplate(r.t, cfg).some((s) => s.tipo === 'email'));
}

/** Linhas de um parágrafo (o .docx usa quebras de linha dentro do parágrafo: ex. subtítulo + linha de versão). */
function Linhas({ runs, cfg, marcas, versao }: { runs: RunLegal[]; cfg: LegalConfig; marcas: Marcas; versao?: boolean }) {
  const linhas: RunLegal[][] = [[]];
  for (const r of runs) r.t.split('\n').forEach((parte, i) => { if (i > 0) linhas.push([]); if (parte) linhas[linhas.length - 1].push({ ...r, t: parte }); });
  return (
    <>
      {linhas.map((l, i) => {
        const conteudo = l.map((r, j) => <Run key={j} run={r} cfg={cfg} marcas={marcas} />);
        const ehVersao = versao && REGEX_VERSAO.test(l.map((r) => r.t).join(''));
        return (
          <Fragment key={i}>
            {i > 0 && <br />}
            {ehVersao ? <span data-testid="legal-version">{conteudo}</span> : conteudo}
          </Fragment>
        );
      })}
    </>
  );
}

function Bloco({ b, cfg, marcas }: { b: BlocoLegal; cfg: LegalConfig; marcas: Marcas }) {
  if (b.tipo === 'tabela') {
    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {b.linhas.map((linha, i) => (
              <tr key={i}>
                {linha.map((celula, j) => (
                  <td key={j} className="border border-border p-2 align-top">
                    {celula.map((par, k) => <p key={k}><Linhas runs={par} cfg={cfg} marcas={marcas} /></p>)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const alinhamento = b.alinhamento === 'centro' ? 'text-center' : '';
  switch (b.tipo) {
    case 'titulo':
      return <h1 className={`text-3xl font-bold tracking-tight mb-2 ${alinhamento}`} data-testid="legal-title"><Linhas runs={b.runs} cfg={cfg} marcas={marcas} /></h1>;
    case 'subtitulo':
      return <p className={`text-sm text-muted-foreground mb-8 ${alinhamento}`}><Linhas runs={b.runs} cfg={cfg} marcas={marcas} versao /></p>;
    case 'linha-versao':
      return <p className={`text-sm text-muted-foreground mb-8 ${alinhamento}`}><Linhas runs={b.runs} cfg={cfg} marcas={marcas} versao /></p>;
    case 'artigo':
      return <h2 className="text-lg font-semibold mt-8 mb-2"><Linhas runs={b.runs} cfg={cfg} marcas={marcas} /></h2>;
    case 'li':
      return <li className="leading-relaxed"><Linhas runs={b.runs} cfg={cfg} marcas={marcas} /></li>;
    default: {
      const comEmail = temEmail(b.runs, cfg);
      return <p className={`leading-relaxed mb-3 ${alinhamento}`} data-testid={comEmail ? marcas.paragrafoComEmailTestId : undefined}><Linhas runs={b.runs} cfg={cfg} marcas={marcas} /></p>;
    }
  }
}

/** Renderiza um documento legal (JSON gerado do .docx) com os dados do legal-config. Lança se faltar algum dado. */
export function LegalDocumento({ doc, cfg, marcas = {} }: { doc: DocumentoLegal; cfg: LegalConfig; marcas?: Marcas }) {
  const saida: ReactNode[] = [];
  for (let i = 0; i < doc.blocos.length; i++) {
    const b = doc.blocos[i];
    if (b.tipo === 'li') {
      // agrupa itens consecutivos da mesma lista: <ol>/<ul> conforme o formato da numeração do .docx
      const grupo = [b]; while (i + 1 < doc.blocos.length) { const n = doc.blocos[i + 1]; if (n.tipo === 'li' && n.lista.id === b.lista.id) { grupo.push(n); i++; } else break; }
      const Tag = b.lista.formato === 'bullet' ? 'ul' : 'ol';
      saida.push(<Tag key={i} className={`${Tag === 'ul' ? 'list-disc' : 'list-decimal'} pl-6 mb-3 space-y-1`}>{grupo.map((g, k) => <Bloco key={k} b={g} cfg={cfg} marcas={marcas} />)}</Tag>);
    } else saida.push(<Bloco key={i} b={b} cfg={cfg} marcas={marcas} />);
  }
  return <article data-testid="legal-documento" data-doc={doc.documento}>{saida}</article>;
}
