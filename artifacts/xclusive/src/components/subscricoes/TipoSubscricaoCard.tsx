import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiSub, ehSessaoMock, type SubscricaoError } from '@/lib/subscricoes';

export type TipoSubscricao = 'gratuita' | 'paga';

/**
 * Definições da criadora: tipo de subscrição (GET/PATCH /creator/subscription-type).
 * Só vale para NOVAS subscrições; as em curso mantêm-se até ao fim do período.
 */
export function TipoSubscricaoCard({ onTipo }: { onTipo?: (t: TipoSubscricao | null) => void }) {
  const mock = ehSessaoMock();
  const [tipo, setTipo] = useState<TipoSubscricao | null>(null);
  const [aGuardar, setAGuardar] = useState<TipoSubscricao | null>(null);
  const [erro, setErro] = useState('');
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (mock) return;
    let vivo = true;
    apiSub<{ tipo: TipoSubscricao }>('/api/creator/subscription-type')
      .then((r) => { if (vivo) { setTipo(r.tipo); onTipo?.(r.tipo); } })
      .catch((e) => { if (vivo) setErro((e as SubscricaoError).message); });
    return () => { vivo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mock]);

  async function escolher(novo: TipoSubscricao) {
    if (novo === tipo || aGuardar) return;
    setAGuardar(novo); setErro(''); setGuardado(false);
    try {
      const r = await apiSub<{ tipo: TipoSubscricao }>('/api/creator/subscription-type', { method: 'PATCH', body: JSON.stringify({ tipo: novo }) });
      setTipo(r.tipo); onTipo?.(r.tipo); setGuardado(true);
    } catch (e) {
      setErro((e as SubscricaoError).message || 'Não foi possível guardar.');
    } finally {
      setAGuardar(null);
    }
  }

  if (mock) return null;

  return (
    <Card className="bg-card border-border" data-testid="tipo-subscricao">
      <CardHeader>
        <CardTitle>Tipo de subscrição</CardTitle>
        <CardDescription>
          Escolhe se os teus fãs subscrevem de graça ou com um plano pago. A mudança só vale para <strong>novas subscrições</strong>;
          as que já estão em curso mantêm-se até ao fim do período.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tipo === null && !erro && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {tipo !== null && (
          <div className="grid grid-cols-2 gap-3">
            {(['paga', 'gratuita'] as const).map((t) => (
              <Button
                key={t}
                type="button"
                variant={tipo === t ? 'default' : 'outline'}
                disabled={aGuardar !== null}
                onClick={() => escolher(t)}
                aria-pressed={tipo === t}
                data-testid={`tipo-${t}`}
                className="h-12 font-semibold"
              >
                {aGuardar === t ? <Loader2 className="w-4 h-4 animate-spin" /> : t === 'paga' ? 'Paga (com planos)' : 'Gratuita'}
              </Button>
            ))}
          </div>
        )}
        {tipo === 'gratuita' && (
          <p className="text-sm text-muted-foreground" data-testid="tipo-nota-gratuita">
            Subscrição gratuita: os fãs subscrevem sem pagar e os planos não são usados para novas subscrições.
          </p>
        )}
        {guardado && <p className="text-sm text-primary" data-testid="tipo-guardado">Guardado. Vale para as novas subscrições.</p>}
        {erro && <p className="text-sm text-destructive" data-testid="tipo-erro">{erro}</p>}
      </CardContent>
    </Card>
  );
}
