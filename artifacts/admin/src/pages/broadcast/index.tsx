import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { DataTable, Column } from '@/components/tables/DataTable';
import { Send, History } from 'lucide-react';
import { format } from 'date-fns';

export default function Broadcast() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [segment, setSegment] = useState('all');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: history, isLoading } = useQuery({
    queryKey: ['broadcast-history'],
    queryFn: adminApi.getBroadcastHistory
  });

  const sendBroadcast = useMutation({
    mutationFn: (data: any) => adminApi.sendBroadcast(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcast-history'] });
      toast({ title: 'Notificação enviada com sucesso' });
      setTitle('');
      setMessage('');
    }
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !message) return;
    if (confirm(`Prestes a enviar notificação para o segmento: ${segment}. Continuar?`)) {
      sendBroadcast.mutate({ title, message, segment });
    }
  };

  const columns: Column<any>[] = [
    { header: 'Título', accessorKey: 'title', className: 'font-medium' },
    { header: 'Segmento', accessorKey: 'segment', className: 'uppercase text-xs tracking-wider text-muted-foreground' },
    { 
      header: 'Data de Envio', 
      cell: (item) => <span className="text-muted-foreground text-sm">{format(new Date(item.sentAt), 'dd MMM yyyy, HH:mm')}</span>
    },
    { 
      header: 'Taxa de Leitura', 
      cell: (item) => (
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${item.readRate}%` }} />
          </div>
          <span className="text-xs font-mono">{item.readRate}%</span>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Broadcast System</h1>
        <p className="text-muted-foreground">Envio de notificações push/in-app em massa.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border border-primary/20 shadow-lg shadow-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Send className="h-5 w-5" />
              Nova Notificação
            </CardTitle>
            <CardDescription>Envie um aviso global, de manutenção ou promoções.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSend} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="segment">Segmento de Destino</Label>
                <Select value={segment} onValueChange={setSegment}>
                  <SelectTrigger id="segment" className="bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os Utilizadores</SelectItem>
                    <SelectItem value="creators">Apenas Criadores</SelectItem>
                    <SelectItem value="users">Apenas Subscritores</SelectItem>
                    <SelectItem value="inactive">Utilizadores Inativos (+30d)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Título da Notificação</Label>
                <Input 
                  id="title" 
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)} 
                  placeholder="Ex: Atualização Importante" 
                  className="bg-card"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Mensagem (max 150 caracteres)</Label>
                <Textarea 
                  id="message" 
                  value={message} 
                  onChange={(e) => setMessage(e.target.value)} 
                  placeholder="A sua mensagem aqui..." 
                  className="bg-card resize-none"
                  rows={4}
                  maxLength={150}
                  required
                />
                <div className="text-right text-xs text-muted-foreground">
                  {message.length}/150
                </div>
              </div>
              <Button type="submit" className="w-full font-bold" disabled={sendBroadcast.isPending}>
                {sendBroadcast.isPending ? 'A Enviar...' : 'Disparar Notificação'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico Recente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable 
              columns={columns} 
              data={history || []} 
              isLoading={isLoading}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
