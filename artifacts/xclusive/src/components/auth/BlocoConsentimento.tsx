import type { Control } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { LEGAL_PAGES, type LegalDocKey } from '@/pages/legal/useLegalDocs';

// Nomes, na frase de aceite, dos 5 documentos (a rota de cada um vem de LEGAL_PAGES).
const DOCS_ACEITE: { key: LegalDocKey; nome: string }[] = [
  { key: 'termos', nome: 'Termos e Condições de Utilização' },
  { key: 'privacidade', nome: 'Política de Privacidade' },
  { key: 'conteudo', nome: 'Política de Conteúdo' },
  { key: 'direitosAutor', nome: 'Política de Direitos de Autor' },
  { key: 'reembolsos', nome: 'Política de Reembolsos' },
];
const rotaDoc = (key: LegalDocKey) => LEGAL_PAGES.find((p) => p.key === key)!.path;

/**
 * Bloco de consentimento do registo (o MESMO texto, escrito com o advogado): aceite dos 5 documentos legais, cookies/armazenamento local e declaração de
 * maioridade. Usado pelo registo e pelo ecrã de conclusão da conta criada com o Google. O formulário tem de ter os campos `documentos`, `cookies` e `maioridade`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BlocoConsentimento({ control }: { control: Control<any> }) {
  return (
    <>
  {/* Aceite dos 5 documentos legais: obrigatório (uma só caixa, cada nome liga à sua página) */}
  <FormField control={control} name="documentos" render={({ field }) => (
    <FormItem className="flex flex-row items-center space-x-3 space-y-0 min-h-[44px]">
      <FormControl>
        <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true ? true : undefined)} data-testid="aceite-documentos" />
      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel className="text-sm font-normal text-muted-foreground">
          Li e aceito os{' '}
          {DOCS_ACEITE.map((d, i) => (
            <span key={d.key}>
              {i > 0 && (i === DOCS_ACEITE.length - 1 ? ' e a ' : ', a ')}
              <a href={rotaDoc(d.key)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{d.nome}</a>
            </span>
          ))}
          .
        </FormLabel>
        <FormMessage />
      </div>
    </FormItem>
  )} />

  {/* Cookies e armazenamento local: obrigatório */}
  <FormField control={control} name="cookies" render={({ field }) => (
    <FormItem className="flex flex-row items-center space-x-3 space-y-0 min-h-[44px]">
      <FormControl>
        <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true ? true : undefined)} data-testid="cookies-aceite" />
      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel className="text-sm font-normal text-muted-foreground">
          Aceito a utilização de{' '}
          <a href={rotaDoc('cookies')} target="_blank" rel="noopener noreferrer" data-testid="cookies-ligacao" className="text-primary hover:underline">cookies</a>{' '}
          e de armazenamento local no meu dispositivo, estritamente necessários ao funcionamento da plataforma (manter a sessão iniciada, guardar as minhas preferências e garantir a segurança), nos termos da{' '}
          <a href={rotaDoc('privacidade')} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Política de Privacidade</a>.
        </FormLabel>
        <FormMessage />
      </div>
    </FormItem>
  )} />

  {/* Declaração de maioridade: obrigatória (bloqueia o botão enquanto não está marcada) */}
  <FormField control={control} name="maioridade" render={({ field }) => (
    <FormItem className="flex flex-row items-center space-x-3 space-y-0 min-h-[44px]">
      <FormControl>
        <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true ? true : undefined)} data-testid="maioridade" />
      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel className="text-sm font-normal text-muted-foreground">Declaro ter 18 anos ou mais.</FormLabel>
        <FormMessage />
      </div>
    </FormItem>
  )} />
    </>
  );
}
