import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useGetGoogleConfig, getGetGoogleConfigQueryKey, useGetGoogleStatus, getGetGoogleStatusQueryKey, linkGoogle, unlinkGoogle } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useGoogleIdentity } from '@/hooks/useGoogleIdentity';
import { TextoAdvogado } from '@/components/auth/TextoAdvogado';

type Msg = { tipo: 'ok' | 'erro'; texto: string };

/**
 * Definições › Segurança: «Ligar o Google» (a ÚNICA forma de ligar o Google a uma conta existente: nunca se liga pelo email) e «Desligar o Google»
 * (só com palavra-passe definida: senão a conta ficava sem forma de entrar). Não aparece se o servidor não tiver o login com o Google configurado.
 */
export function GoogleConta() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Só se o servidor tiver o login com o Google configurado (clientId) é que o bloco existe
  const cfg = useGetGoogleConfig({ query: { queryKey: getGetGoogleConfigQueryKey(), retry: false, staleTime: 5 * 60_000 } });
  const ligadoNoServidor = !!cfg.data?.clientId;
  const estado = useGetGoogleStatus({ query: { queryKey: getGetGoogleStatusQueryKey(), retry: false, staleTime: 60_000, enabled: ligadoNoServidor } });
  const alvo = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [aTrabalhar, setATrabalhar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const desligadoNoServidor = (estado.error as { status?: number } | null)?.status === 404;
  const ligado = estado.data?.ligado === true;
  const semPassword = user?.temPassword === false;

  const ligar = async (credential: string) => {
    if (aTrabalhar) return;
    setMsg(null); setATrabalhar(true);
    try {
      await linkGoogle({ credential });
      await Promise.all([queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() }), queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] })]);
      setMsg({ tipo: 'ok', texto: 'Google ligado à tua conta.' });
    } catch (e) {
      const err = e as { status?: number; data?: { codigo?: string; error?: string } } | null;
      const cod = err?.data?.codigo, m = typeof err?.data?.error === 'string' ? err.data.error : null;
      if (err?.status === 409 && cod === 'ja_ligado') setMsg({ tipo: 'erro', texto: m ?? 'Esta conta já tem uma conta Google ligada.' });
      else if (err?.status === 409 && cod === 'google_ja_ligado') setMsg({ tipo: 'erro', texto: m ?? 'Esta conta Google já está ligada a uma conta.' });
      else if (err?.status === 429) setMsg({ tipo: 'erro', texto: 'Demasiadas tentativas. Tenta novamente dentro de 15 minutos.' });
      else if (m && (err?.status === 401 || err?.status === 403)) setMsg({ tipo: 'erro', texto: m });
      else setMsg({ tipo: 'erro', texto: 'Não foi possível ligar o Google. Tenta novamente.' });
    } finally { setATrabalhar(false); }
  };

  const desligar = async () => {
    setMsg(null); setATrabalhar(true);
    try {
      await unlinkGoogle();
      setConfirmar(false);
      await queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() });
      setMsg({ tipo: 'ok', texto: 'Google desligado da tua conta.' });
    } catch (e) {
      const err = e as { status?: number; data?: { codigo?: string; error?: string } } | null;
      const m = typeof err?.data?.error === 'string' ? err.data.error : null;
      setConfirmar(false);
      setMsg({ tipo: 'erro', texto: err?.status === 409 && err?.data?.codigo === 'sem_password' ? (m ?? 'Define uma palavra-passe antes de desligar o Google.') : 'Não foi possível desligar o Google. Tenta novamente.' });
    } finally { setATrabalhar(false); }
  };

  // O botão só é preparado (e o script só é carregado) quando falta ligar e o servidor tem o login com o Google.
  const { estado: estadoBotao } = useGoogleIdentity(alvo, (c) => ligar(c), estado.isSuccess && !ligado);

  if (!ligadoNoServidor || desligadoNoServidor || estado.isLoading) return null;
  if (estado.isError) return null;

  return (
    <section className="border border-border rounded-xl p-4 space-y-3" aria-label="Google" data-testid="bloco-google">
      <h3 className="font-bold">Google</h3>
      <TextoAdvogado id="explicacaoLigarGoogle" />
      {ligado ? (
        <>
          <p className="text-sm text-muted-foreground" data-testid="google-ligado">Google ligado{estado.data?.email ? <>: <strong className="text-foreground">{estado.data.email}</strong></> : null}.</p>
          {semPassword && <p className="text-sm text-muted-foreground" data-testid="google-desligar-bloqueado">Define primeiro uma palavra-passe para poderes desligar o Google (senão ficavas sem forma de entrar).</p>}
          {!confirmar ? (
            <Button variant="outline" className="w-full justify-start text-left h-12" disabled={semPassword || aTrabalhar} onClick={() => setConfirmar(true)} data-testid="google-desligar">Desligar o Google</Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3" data-testid="google-desligar-confirmar">
              <span className="text-sm">Desligar o Google desta conta?</span>
              <Button variant="destructive" className="min-h-[44px]" onClick={() => { void desligar(); }} disabled={aTrabalhar} data-testid="google-desligar-sim">{aTrabalhar && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Sim, desligar</Button>
              <Button variant="outline" className="min-h-[44px]" onClick={() => setConfirmar(false)} disabled={aTrabalhar}>Cancelar</Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">O Google não está ligado a esta conta.</p>
          <div className={estadoBotao === 'pronto' ? 'space-y-2' : 'hidden'}>
            <div role="group" aria-label="Ligar o Google" className="flex min-h-[44px]">
              <div ref={alvo} data-testid="google-botao-ligar" className="min-h-[44px]" />
            </div>
            <TextoAdvogado id="scriptECookies" />
          </div>
          {estadoBotao === 'erro-script' && <p role="status" className="text-sm text-muted-foreground" data-testid="google-erro-script">Não foi possível carregar o botão do Google. Tenta mais tarde.</p>}
        </>
      )}
      {aTrabalhar && !confirmar && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> A ligar…</p>}
      {msg && <p role={msg.tipo === 'erro' ? 'alert' : 'status'} className={msg.tipo === 'erro' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} data-testid="google-mensagem">{msg.texto}</p>}
    </section>
  );
}
