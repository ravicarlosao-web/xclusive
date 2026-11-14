import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { adminApi } from '@/lib/api';
import { DataTable, Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { UserPlus, KeyRound, Copy } from 'lucide-react';

type Modo = 'escrever' | 'gerar';
interface Admin { id: number; username: string; email: string; role: string; ativo: boolean; criadoEm: string; trocaPasswordPendente: boolean }

function souSuperadmin(): boolean {
  try { return JSON.parse(localStorage.getItem('admin_user') ?? '{}')?.role === 'superadmin'; } catch { return false; }
}

/** Escolha da palavra-passe inicial: escrita pelo superadmin ou gerada pelo sistema. */
function EscolhaPassword({ modo, setModo, password, setPassword }: { modo: Modo; setModo: (m: Modo) => void; password: string; setPassword: (p: string) => void }) {
  return (
    <div className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Palavra-passe inicial</Label>
      <RadioGroup value={modo} onValueChange={(v) => setModo(v as Modo)} className="space-y-2">
        <div className="flex items-center gap-2"><RadioGroupItem value="gerar" id="modo-gerar" /><Label htmlFor="modo-gerar" className="font-normal">Gerar uma palavra-passe forte (aparece uma só vez)</Label></div>
        <div className="flex items-center gap-2"><RadioGroupItem value="escrever" id="modo-escrever" /><Label htmlFor="modo-escrever" className="font-normal">Escrever eu a palavra-passe</Label></div>
      </RadioGroup>
      {modo === 'escrever' && (
        <div className="space-y-1.5">
          <Input id="password-inicial" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={128} placeholder="Mínimo de 12 caracteres" className="bg-background/50" />
          <p className="text-xs text-muted-foreground">Sem palavras óbvias nem o email ou o utilizador. O administrador terá de a trocar no primeiro acesso.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Administradores (só superadmin). A palavra-passe gerada vive APENAS no estado deste componente: mostra-se uma vez, nunca vai para localStorage, URL nem consola,
 * e desaparece ao fechar o ecrã de confirmação ou ao sair da página.
 */
export default function Administradores() {
  const { user } = useAdminAuth();
  const queryClient = useQueryClient();
  const [criar, setCriar] = useState(false);
  const [redefinir, setRedefinir] = useState<Admin | null>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [modo, setModo] = useState<Modo>('gerar');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState('');
  const [gerada, setGerada] = useState<{ quem: string; password: string } | null>(null);
  const [copiada, setCopiada] = useState(false);

  useEffect(() => () => { setGerada(null); }, []);   // sair da página apaga-a
  const limpar = () => { setEmail(''); setUsername(''); setModo('gerar'); setPassword(''); setErro(''); };

  const { data, isLoading } = useQuery({ queryKey: ['administradores'], queryFn: adminApi.getAdministradores, enabled: souSuperadmin() });

  const concluir = (quem: string, r: any) => {
    if (r.passwordGerada) setGerada({ quem, password: r.passwordGerada });
    setCriar(false); setRedefinir(null); limpar();
    queryClient.invalidateQueries({ queryKey: ['administradores'] });
  };
  const criarM = useMutation({
    mutationFn: () => adminApi.criarAdministrador({ email, username, modo, ...(modo === 'escrever' ? { password } : {}) }),
    onError: (e: any) => { setPassword(''); setErro(e?.message || 'Não foi possível criar o administrador.'); },
  });
  const redefinirM = useMutation({
    mutationFn: () => adminApi.redefinirPasswordAdministrador(redefinir!.id, { modo, ...(modo === 'escrever' ? { password } : {}) }),
    onError: (e: any) => { setPassword(''); setErro(e?.message || 'Não foi possível redefinir a palavra-passe.'); },
  });
  // mutateAsync + reset: a resposta (que traz a palavra-passe gerada) não fica na cache de mutações, só no estado deste componente
  const submeterCriar = async () => { setErro(''); try { const r = await criarM.mutateAsync(); criarM.reset(); concluir(r.username, r); } catch { /* o erro já foi mostrado em onError */ } };
  const submeterRedefinir = async () => { setErro(''); try { const r = await redefinirM.mutateAsync(); redefinirM.reset(); concluir(redefinir!.username, r); } catch { /* idem */ } };

  if (!souSuperadmin()) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Apenas o superadmin gere administradores.</div>;
  }

  const lista: Admin[] = data?.data ?? [];
  const columns: Column<Admin>[] = [
    { header: 'Utilizador', accessorKey: 'username', className: 'font-mono text-sm' },
    { header: 'Email', accessorKey: 'email', className: 'text-sm' },
    { header: 'Role', cell: (a) => <Badge variant={a.role === 'superadmin' ? 'default' : 'secondary'}>{a.role}</Badge> },
    { header: 'Ativo', cell: (a) => <span className={a.ativo ? 'text-green-500' : 'text-destructive'}>{a.ativo ? 'Sim' : 'Não'}</span> },
    { header: 'Criado em', cell: (a) => <span className="text-muted-foreground text-sm whitespace-nowrap">{format(new Date(a.criadoEm), 'dd MMM yyyy, HH:mm')}</span> },
    { header: 'Troca de palavra-passe', cell: (a) => a.trocaPasswordPendente ? <Badge variant="outline" className="border-amber-500 text-amber-500">Pendente</Badge> : <span className="text-muted-foreground text-sm">—</span> },
    { header: '', cell: (a) => a.role === 'admin' && a.id !== user?.id ? (
        <Button size="sm" variant="outline" onClick={() => { limpar(); setRedefinir(a); }}><KeyRound className="mr-1 h-3.5 w-3.5" />Redefinir palavra-passe</Button>
      ) : null },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Administradores</h1>
          <p className="text-muted-foreground">Cria administradores e redefine a palavra-passe inicial. Cada um troca-a no primeiro acesso.</p>
        </div>
        <Button onClick={() => { limpar(); setCriar(true); }}><UserPlus className="mr-2 h-4 w-4" />Novo administrador</Button>
      </div>

      <DataTable columns={columns} data={lista} isLoading={isLoading} />

      <Dialog open={criar} onOpenChange={(o) => { if (!o) { setCriar(false); limpar(); } }}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); void submeterCriar(); }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Novo administrador</DialogTitle>
              <DialogDescription>O role é sempre «admin». A conta nasce com a troca de palavra-passe obrigatória.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5"><Label htmlFor="novo-email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label><Input id="novo-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></div>
            <div className="space-y-1.5"><Label htmlFor="novo-username" className="text-xs uppercase tracking-wider text-muted-foreground">Nome de utilizador</Label><Input id="novo-username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={50} autoComplete="off" /></div>
            <EscolhaPassword modo={modo} setModo={setModo} password={password} setPassword={setPassword} />
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <DialogFooter><Button type="button" variant="ghost" onClick={() => { setCriar(false); limpar(); }}>Cancelar</Button><Button type="submit" disabled={criarM.isPending}>Criar administrador</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!redefinir} onOpenChange={(o) => { if (!o) { setRedefinir(null); limpar(); } }}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); void submeterRedefinir(); }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Redefinir palavra-passe</DialogTitle>
              <DialogDescription>{redefinir?.username}: as sessões deste administrador terminam e terá de trocar a palavra-passe no próximo acesso.</DialogDescription>
            </DialogHeader>
            <EscolhaPassword modo={modo} setModo={setModo} password={password} setPassword={setPassword} />
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <DialogFooter><Button type="button" variant="ghost" onClick={() => { setRedefinir(null); limpar(); }}>Cancelar</Button><Button type="submit" disabled={redefinirM.isPending}>Redefinir</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!gerada} onOpenChange={(o) => { if (!o) { setGerada(null); setCopiada(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Palavra-passe inicial de {gerada?.quem}</DialogTitle>
            <DialogDescription>Mostrada UMA só vez: depois de fechar este ecrã não é possível voltar a vê-la. Entrega-a ao administrador por um canal seguro.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code data-testid="password-gerada" className="flex-1 rounded border border-border bg-muted px-3 py-2 font-mono text-sm select-all break-all">{gerada?.password}</code>
            <Button type="button" variant="outline" size="icon" aria-label="Copiar" onClick={() => { navigator.clipboard?.writeText(gerada?.password ?? '').then(() => setCopiada(true)).catch(() => {}); }}><Copy className="h-4 w-4" /></Button>
          </div>
          {copiada && <p className="text-xs text-muted-foreground">Copiada.</p>}
          <DialogFooter><Button onClick={() => { setGerada(null); setCopiada(false); }}>Já a guardei, fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
