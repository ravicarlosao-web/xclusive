import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
import { googleLogin, type CurrentUser } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGoogleIdentity } from '@/hooks/useGoogleIdentity';
import { TextoAdvogado } from '@/components/auth/TextoAdvogado';

/** Chave (por separador) com o nome que a Google devolveu, para pré-visualizar no passo de conclusão. */
export const CHAVE_GOOGLE_NOME = 'xclusive_google_nome';

interface Props {
  contexto: 'login' | 'registo';
  /** Conta encerrada (403 conta_encerrada): o login mostra o aviso persistente com a mensagem do servidor. */
  aoContaEncerrada?: (mensagem: string) => void;
  /** Conta suspensa (403 conta_suspensa): o login mostra o aviso persistente. */
  aoContaSuspensa?: () => void;
}

/**
 * «Continuar com o Google» (login e registo). Só aparece se o servidor tiver o login com o Google configurado (GET /auth/google/config devolver clientId).
 * O ID token vai para POST /auth/google: conta ligada = sessão como no login normal; conta nova (e registos abertos) = passo de conclusão; o resto são avisos.
 * Nunca abre registo: com os registos fechados o servidor responde 403 registos_fechados e aparece o mesmo aviso do registo.
 */
export function ContinuarComGoogle({ contexto, aoContaEncerrada, aoContaSuspensa }: Props) {
  const { entrarComToken } = useAuth();
  const [, setLocation] = useLocation();
  const alvo = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  const enviar = async (credential: string) => {
    if (aEnviar) return;
    setErro(null); setAEnviar(true);
    try {
      // `_isRetry`: um 401 aqui é um ID token recusado, não uma sessão expirada — sem isto o cliente tentaria renovar uma sessão que não existe (POST /auth/refresh)
      const r = await googleLogin({ credential }, { _isRetry: true });
      if ('precisaCompletar' in r) {
        try { sessionStorage.setItem(CHAVE_GOOGLE_NOME, r.nome ?? ''); } catch { /* sem armazenamento */ }
        setLocation('/google/concluir');
        return;
      }
      entrarComToken(r.token, r.user as CurrentUser, contexto === 'registo' ? '/onboarding' : '/home');
    } catch (e) {
      const err = e as { status?: number; data?: { codigo?: string; error?: string } } | null;
      const st = err?.status, cod = err?.data?.codigo, msg = typeof err?.data?.error === 'string' ? err.data.error : null;
      if (st === 403 && cod === 'conta_encerrada' && msg && aoContaEncerrada) { aoContaEncerrada(msg); return; }
      if (st === 403 && cod === 'conta_suspensa' && aoContaSuspensa) { aoContaSuspensa(); return; }
      if (st === 409 && cod === 'conta_existente') setErro(msg ?? 'Já existe uma conta com este email. Entra com a tua palavra-passe e liga o Google em Definições.');
      else if (st === 403 && cod === 'registos_fechados') setErro(msg ?? 'Os registos estão fechados de momento. Volta a tentar mais tarde.');
      else if ((st === 403 || st === 409 || st === 401) && msg) setErro(msg);
      else if (st === 429) setErro('Demasiadas tentativas. Tenta novamente dentro de 15 minutos.');
      else if (st === 404) setErro('O início de sessão com o Google não está disponível.');
      else setErro('Não foi possível entrar com o Google. Tenta novamente.');
    } finally {
      setAEnviar(false);
    }
  };

  const { estado } = useGoogleIdentity(alvo, (c) => enviar(c));
  const oculto = estado === 'a-ver' || estado === 'desligado';

  return (
    <div className={oculto ? 'hidden' : 'space-y-3'} data-testid="google-bloco" data-estado={estado}>
      {!oculto && (
        <div className="flex items-center gap-3" aria-hidden="true">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      <div role="group" aria-label="Continuar com o Google" className="flex min-h-[44px] justify-center">
        <div ref={alvo} data-testid="google-botao" aria-busy={estado === 'a-carregar' || aEnviar} className="flex min-h-[44px] w-full justify-center" />
      </div>
      {!oculto && (<>
        {aEnviar && <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="google-a-enviar"><Loader2 className="h-4 w-4 animate-spin" /> A entrar com o Google…</p>}
        {estado === 'erro-script' && <p role="status" className="text-center text-sm text-muted-foreground" data-testid="google-erro-script">Não foi possível carregar o botão do Google. Entra com o email e a palavra-passe ou tenta mais tarde.</p>}
        {estado === 'erro-rede' && <p role="status" className="text-center text-sm text-muted-foreground" data-testid="google-erro-rede">Não foi possível preparar o botão do Google. Recarrega a página para tentar de novo.</p>}
        {erro && <p role="alert" className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground" data-testid="google-erro">{erro}</p>}
        <TextoAdvogado id="avisoJuntoAoBotao" className="text-center text-xs text-muted-foreground" />
        <TextoAdvogado id="scriptECookies" className="text-center text-xs text-muted-foreground" />
      </>)}
    </div>
  );
}
