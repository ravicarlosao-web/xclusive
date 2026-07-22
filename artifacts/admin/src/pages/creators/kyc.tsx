import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, FileImage, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

export default function KycQueue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
                    <div key={i} className="aspect-video bg-muted rounded-md border border-border flex flex-col items-center justify-center group relative overflow-hidden cursor-pointer hover:border-primary/50 transition-colors">
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
    </div>
  );
}
