import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, FileImage, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

// Documento aberto no visualizador. O URL assinado (60 s) vive só aqui, em memória: nunca é
// guardado, registado na consola nem reutilizado (cada abertura pede um novo).
type Viewer = { label: string; status: 'loading' | 'ready' | 'error'; src?: string; kind?: 'image' | 'video'; blob?: boolean };

function kindFromUrl(url: string): 'image' | 'video' {
  try {
    return /\.(mp4|webm|mov)$/i.test(new URL(url).pathname) ? 'video' : 'image';
  } catch {
    return 'image';
  }
}

export default function KycQueue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const openSeq = useRef(0);

  // Liberta o objeto blob (registos antigos) quando o visualizador muda ou fecha.
  useEffect(() => () => {
    if (viewer?.blob && viewer.src) URL.revokeObjectURL(viewer.src);
  }, [viewer]);

  // `ref` vem da fila: caminho do endpoint de URL assinado (documentos novos) ou, nos registos
  // antigos, o proxy assinado /api/admin/media (que exige o token e por isso é pedido como blob).
  const openDocument = async (label: string, ref: string) => {
    const seq = ++openSeq.current;
    setViewer({ label, status: 'loading' });
    try {
      let url = ref;
      if (ref.startsWith('/api/admin/kyc/')) {
        url = (await adminApi.getKycDocumentUrl(ref)).url;
      }
      let next: Viewer;
      if (url.startsWith('/api/admin/media?')) {
        const blob = await adminApi.getAdminMediaBlob(url);
        next = { label, status: 'ready', src: URL.createObjectURL(blob), kind: blob.type.startsWith('video/') ? 'video' : 'image', blob: true };
      } else {
        next = { label, status: 'ready', src: url, kind: kindFromUrl(url) };
      }
      if (seq !== openSeq.current) {
        if (next.blob && next.src) URL.revokeObjectURL(next.src);
        return;
      }
      setViewer(next);
    } catch {
      if (seq === openSeq.current) setViewer({ label, status: 'error' });
    }
  };
  const failViewer = () => setViewer((v) => (v ? { label: v.label, status: 'error' } : v));

  const { data: queue, isLoading } = useQuery({
    queryKey: ['kyc-queue'],
    queryFn: adminApi.getKycQueue
  });

  const resolveKyc = useMutation({
    mutationFn: ({ id, status, reason }: { id: number, status: string, reason?: string }) => 
      adminApi.updateKyc(id, { status, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyc-queue'] });
      toast({ title: 'KYC avaliado com sucesso' });
    }
  });

  const handleAction = (id: number, action: 'aprovado' | 'rejeitado') => {
    let reason;
    if (action === 'rejeitado') {
      reason = prompt('Motivo da rejeição (obrigatório):');
      if (!reason) return;
    }
    resolveKyc.mutate({ id, status: action, reason });
  };

  const queueList: any[] = (queue as any)?.data ?? queue ?? [];

  if (isLoading) return <div>A carregar fila KYC...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fila de KYC</h1>
        <p className="text-muted-foreground">Análise de documentos de identidade para aprovação de criadores.</p>
      </div>

      {queueList.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed border-border rounded-lg bg-card text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mb-4 text-green-500/50" />
          <h3 className="text-xl font-medium">Fila Limpa</h3>
          <p>Não há submissões de KYC pendentes de momento.</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {queueList.map((req: any) => (
            <Card key={req.id} className="border-border bg-card/50 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex justify-between items-center text-lg">
                  <span className="text-primary">{req.username}</span>
                  <span className="text-xs text-muted-foreground font-mono">#{req.id}</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">Submetido: {req.kycSubmissao?.submissaoEm ? format(new Date(req.kycSubmissao.submissaoEm), 'dd MMM yyyy, HH:mm') : '—'}</p>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(req.kycSubmissao || {}).filter(([k, v]) => k !== 'submissaoEm' && v).map(([k, v], i) => (
                    <div key={i} role="button" tabIndex={0} onClick={() => openDocument(`${req.username} — ${k.replace(/([A-Z])/g, ' $1')}`, v as string)} onKeyDown={(e) => { if (e.key === 'Enter') openDocument(`${req.username} — ${k.replace(/([A-Z])/g, ' $1')}`, v as string); }} className="aspect-video bg-muted rounded-md border border-border flex flex-col items-center justify-center group relative overflow-hidden cursor-pointer hover:border-primary/50 transition-colors">
                      <FileImage className="h-6 w-6 text-muted-foreground mb-1 group-hover:text-primary transition-colors" />
                      <span className="text-[10px] text-muted-foreground capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                      <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <ExternalLink className="h-4 w-4 text-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="pt-3 border-t border-border grid grid-cols-2 gap-2">
                <Button 
                  variant="outline" 
                  className="w-full border-red-500/30 text-red-500 hover:bg-red-500/10"
                  onClick={() => handleAction(req.id, 'rejeitado')}
                  disabled={resolveKyc.isPending}
                >
                  <XCircle className="mr-2 h-4 w-4" /> Rejeitar
                </Button>
                <Button 
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => handleAction(req.id, 'aprovado')}
                  disabled={resolveKyc.isPending}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={viewer !== null} onOpenChange={(open) => { if (!open) { openSeq.current++; setViewer(null); } }}>
        <DialogContent className="max-w-3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="capitalize">{viewer?.label}</DialogTitle>
          </DialogHeader>
          {viewer?.status === 'loading' && (
            <div className="py-12 text-center text-muted-foreground">A obter o documento…</div>
          )}
          {viewer?.status === 'error' && (
            <div role="alert" className="py-12 text-center text-red-500">
              Não foi possível mostrar o documento. Fecha e abre de novo (o link expira em 60 s).
            </div>
          )}
          {viewer?.status === 'ready' && viewer.kind === 'video' && (
            <video src={viewer.src} controls className="w-full max-h-[70vh] rounded-md" onError={failViewer} />
          )}
          {viewer?.status === 'ready' && viewer.kind === 'image' && (
            <img src={viewer.src} alt={viewer.label} className="w-full max-h-[70vh] object-contain rounded-md" onError={failViewer} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
