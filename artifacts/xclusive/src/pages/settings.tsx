import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FeedHeader } from '@/components/feed/FeedHeader';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useColunaParada } from '@/hooks/useColunaParada';
import { Loader2, Camera, User, Lock, Bell, Shield, LogOut, Star, Sun, Moon, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { MinhasSubscricoes } from '@/components/subscricoes/MinhasSubscricoes';
import { Mais18Opcoes } from '@/components/shared/Mais18';
import { EncerrarContaDialog } from '@/components/shared/EncerrarContaDialog';
import { useTema } from '@/hooks/useTema';
import { cn } from '@/lib/utils';
import { enviarImagem } from '@/lib/uploadImagem';

const SECCOES = [
  { id: 'profile', rotulo: 'Editar Perfil', Icone: User, testid: undefined },
  { id: 'privacy', rotulo: 'Privacidade', Icone: Lock, testid: undefined },
  { id: 'notifications', rotulo: 'Notificações', Icone: Bell, testid: undefined },
  { id: 'aparencia', rotulo: 'Aparência', Icone: Sun, testid: 'tab-aparencia' },
  { id: 'subscricoes', rotulo: 'Subscrições', Icone: Star, testid: 'tab-subscricoes' },
  { id: 'security', rotulo: 'Segurança', Icone: Shield, testid: undefined },
] as const;

export default function Settings() {
  const { user, logout, isMockMode, updateAvatarUrl } = useAuth();
  const [encerrarAberto, setEncerrarAberto] = useState(false);
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const { tema, definir: definirTema } = useTema();
  const [seccao, setSeccao] = useState<string>('profile');
  // lg para cima: o menu das secções vai para a coluna direita; abaixo: fila de pílulas por baixo do cabeçalho
  const largo = useMediaQuery('(min-width: 1024px)');
  const colunaRef = useColunaParada<HTMLElement>(largo);

  const [nomeExibicao, setNomeExibicao] = useState(user?.nomeExibicao || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [link, setLink] = useState(user?.link || '');
  const [privado, setPrivado] = useState(user?.privado || false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveProfile = async () => {
    try {
      await updateProfile.mutateAsync({ data: { nomeExibicao, bio, link, privado } });
      toast({ title: 'Perfil atualizado com sucesso' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro ao atualizar perfil' });
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected if needed
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Seleciona uma imagem (JPG, PNG, WEBP, GIF)' });
      return;
    }

    setIsUploadingAvatar(true);
    try {
      let avatarUrl: string;
      // URL a mostrar já (assinado, vem do upload); avatarUrl é o canónico que se guarda.
      let avatarVisualizacao: string | null = null;

      if (isMockMode) {
        // Em modo mock não há servidor disponível — usamos um blob URL local
        avatarUrl = URL.createObjectURL(file);
      } else {
        const enviado = await enviarImagem(file);
        avatarUrl = enviado.url;
        avatarVisualizacao = enviado.urlVisualizacao;
        await updateProfile.mutateAsync({ data: { avatarUrl } });
      }

      updateAvatarUrl(avatarVisualizacao ?? avatarUrl);
      toast({ title: 'Foto de perfil atualizada!' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Erro ao atualizar foto de perfil' });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const gatilhoPilula = 'min-h-[44px] shrink-0 gap-2 rounded-full bg-secondary px-5 text-sm font-semibold text-muted-foreground shadow-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary/10 data-[state=active]:font-bold data-[state=active]:text-primary data-[state=active]:shadow-none';
  const gatilhoMenu = 'min-h-[48px] w-full justify-start gap-3 rounded-xl px-4 text-[15px] font-medium text-muted-foreground shadow-none transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-secondary data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none';

  // Mesmo desenho de Início, Explorar e Notificações: centro de 640 px com bordas laterais; o menu das secções vai para a coluna direita
  return (
    <Tabs value={seccao} onValueChange={setSeccao} orientation={largo ? 'vertical' : 'horizontal'}
      className="flex justify-center w-full max-w-screen-xl mx-auto gap-12 px-0 sm:px-4 md:pr-1.5">
      <div className="w-full min-w-0 max-w-[640px] shrink sm:border-x sm:border-border min-h-[100dvh]">
        <FeedHeader titulo="Definições" semMenu />

        {!largo && (
          <TabsList aria-label="Secções das Definições" data-testid="definicoes-pilulas"
            className="flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none border-b border-border bg-transparent px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SECCOES.map(({ id, rotulo, Icone, testid }) => (
              <TabsTrigger key={id} value={id} data-testid={testid ?? `tab-${id}`} className={gatilhoPilula}>
                <Icone className="h-4 w-4" aria-hidden="true" /> {rotulo}
              </TabsTrigger>
            ))}
          </TabsList>
        )}

        <div className="px-4 py-6 sm:px-6">
          <TabsContent value="profile" className="mt-0 space-y-8 focus-visible:outline-none">
            <div>
              <h2 className="text-xl font-bold mb-6">Informação Pública</h2>
              
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <div className="flex items-center gap-6 mb-8">
                <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
                  <Avatar className="w-24 h-24 border-2 border-border group-hover:opacity-80 transition-opacity">
                    <AvatarImage src={user?.avatarUrl || ''} />
                    <AvatarFallback>{user?.username?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {isUploadingAvatar
                      ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                      : <Camera className="w-6 h-6 text-white" />}
                  </div>
                </div>
                <div>
                  <h3 className="font-bold">{user?.username}</h3>
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    disabled={isUploadingAvatar}
                    className="text-sm text-primary font-medium hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUploadingAvatar ? 'A carregar...' : 'Alterar foto de perfil'}
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <Label htmlFor="campo-nome-exibicao" className="text-muted-foreground mb-2 block">Nome de exibição</Label>
                  <Input 
                    id="campo-nome-exibicao"
                    value={nomeExibicao} 
                    onChange={(e) => setNomeExibicao(e.target.value)} 
                    className="bg-secondary/50"
                  />
                </div>
                <div>
                  <Label htmlFor="campo-biografia" className="text-muted-foreground mb-2 block">Biografia</Label>
                  <Textarea 
                    id="campo-biografia"
                    value={bio} 
                    onChange={(e) => setBio(e.target.value)} 
                    className="bg-secondary/50 resize-none h-24"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Conta um pouco sobre ti na tua bio.</p>
                </div>
                <div>
                  <Label htmlFor="campo-website" className="text-muted-foreground mb-2 block">Website</Label>
                  <Input 
                    id="campo-website"
                    value={link} 
                    onChange={(e) => setLink(e.target.value)} 
                    className="bg-secondary/50"
                  />
                </div>
              </div>

              <Button 
                onClick={handleSaveProfile} 
                disabled={updateProfile.isPending}
                className="mt-8 bg-primary hover:bg-primary/90 text-white font-bold"
              >
                {updateProfile.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar Alterações
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="privacy" className="mt-0 space-y-8">
            <h2 className="text-xl font-bold mb-6">Privacidade da Conta</h2>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 border border-border rounded-xl">
                <div className="space-y-0.5">
                  <Label className="text-base font-bold">Conta Privada</Label>
                  <p className="text-sm text-muted-foreground">Apenas as pessoas que aprovares podem ver as tuas fotos e vídeos.</p>
                </div>
                <Switch checked={privado} onCheckedChange={setPrivado} />
              </div>

              <div className="flex items-center justify-between p-4 border border-border rounded-xl">
                <div className="space-y-0.5">
                  <Label className="text-base font-bold">Estado de Atividade</Label>
                  <p className="text-sm text-muted-foreground">Permitir que as contas que segues vejam quando estiveste online pela última vez.</p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>

            {/* Conteúdo +18: escolha atual, data e alteração (não aparece em modo mock, onde a conta não tem este campo) */}
            {!isMockMode && user && user.preferenciaMais18 !== undefined && (
              <div className="space-y-4 pt-4 border-t border-border" data-testid="mais18-definicoes">
                <h2 className="text-xl font-bold">Conteúdo +18</h2>
                <div className="p-4 border border-border rounded-xl space-y-1">
                  <p className="text-base font-bold" data-testid="mais18-atual">
                    {user.preferenciaMais18 === 'ver'
                      ? 'A ver conteúdo +18'
                      : user.preferenciaMais18 === 'filtrar'
                        ? 'A filtrar conteúdo +18'
                        : 'Ainda não escolheste (o conteúdo +18 fica filtrado)'}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="mais18-data">
                    {user.preferenciaMais18Em
                      ? `Escolha feita a ${new Date(user.preferenciaMais18Em).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                      : 'Sem escolha registada.'}
                  </p>
                </div>
                <Mais18Opcoes atual={user.preferenciaMais18 ?? null} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="notifications" className="mt-0">
            <h2 className="text-xl font-bold mb-6">Preferências de Notificações</h2>
            <div className="space-y-6">
              {['Gostos', 'Comentários', 'Novos Seguidores', 'Mensagens Diretas', 'Subscrições'].map((item) => (
                <div key={item} className="flex items-center justify-between border-b border-border pb-4 last:border-0">
                  <span className="font-medium">{item}</span>
                  <Switch defaultChecked />
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="aparencia" className="mt-0 space-y-6 focus-visible:outline-none" data-testid="aparencia">
            <div>
              <h2 className="text-xl font-bold mb-2">Aparência</h2>
              <p className="text-sm text-muted-foreground">Escolhe o modo de cor da aplicação. O modo noturno é o padrão.</p>
            </div>
            <div role="radiogroup" aria-label="Modo de cor" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { valor: 'noturno', titulo: 'Noturno', sub: 'Fundo preto (padrão)', Icone: Moon },
                { valor: 'diurno', titulo: 'Diurno', sub: 'Fundo branco', Icone: Sun },
              ] as const).map(({ valor, titulo, sub, Icone }) => {
                const ativo = tema === valor;
                return (
                  <button
                    key={valor}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    data-testid={`tema-${valor}`}
                    onClick={() => definirTema(valor)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-4 min-h-[56px] text-left transition-colors',
                      ativo ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:bg-secondary',
                    )}
                  >
                    <Icone className="w-5 h-5 shrink-0" />
                    <span className="flex-1">
                      <span className="block font-semibold">{titulo}</span>
                      <span className="block text-xs text-muted-foreground">{sub}</span>
                    </span>
                    {ativo && <Check className="w-5 h-5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="subscricoes" className="mt-0 focus-visible:outline-none">
            <MinhasSubscricoes />
          </TabsContent>

          <TabsContent value="security" className="mt-0 space-y-8">
            <h2 className="text-xl font-bold mb-6">Segurança</h2>
            
            <div className="space-y-4">
              <Button variant="outline" className="w-full justify-start text-left h-12">
                Alterar Password
              </Button>
              <Button variant="outline" className="w-full justify-start text-left h-12">
                Autenticação de Dois Fatores (2FA)
              </Button>
            </div>

            <div className="pt-8 mt-8 border-t border-border">
              <Button 
                variant="ghost" 
                onClick={logout}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 justify-start h-12 px-4 w-full sm:w-auto font-bold"
              >
                <LogOut className="w-5 h-5 mr-2" /> Terminar Sessão
              </Button>
            </div>

            {/* Zona de perigo: encerrar a própria conta (só com a API real) */}
            {!isMockMode && (
              <div className="pt-8 mt-8 border-t border-destructive/40 space-y-3" data-testid="zona-perigo">
                <h3 className="text-lg font-bold text-destructive">Zona de perigo</h3>
                <p className="text-sm text-muted-foreground">Encerrar a conta torna-a inacessível e invisível. Podes pedir a reabertura nos primeiros 30 dias.</p>
                <Button variant="outline" onClick={() => setEncerrarAberto(true)} data-testid="encerrar-conta-abrir" className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive min-h-[44px]">
                  Encerrar a minha conta
                </Button>
                <EncerrarContaDialog aberto={encerrarAberto} onFechar={() => setEncerrarAberto(false)} />
              </div>
            )}
          </TabsContent>
        </div>
      </div>

      {/* Coluna direita (lg+): o menu das secções, parado e sempre à vista */}
      {largo && (
        <aside ref={colunaRef} aria-label="Menu das Definições" data-testid="definicoes-menu"
          className="coluna-direita hidden lg:flex flex-col lg:sticky lg:top-0 lg:h-[100dvh] lg:self-start w-[320px] xl:w-[400px] flex-shrink-0">
          <TabsList aria-label="Secções das Definições" className="flex h-auto w-full flex-col items-stretch gap-1 bg-transparent p-0">
            {SECCOES.map(({ id, rotulo, Icone, testid }) => (
              <TabsTrigger key={id} value={id} data-testid={testid ?? `tab-${id}`} className={gatilhoMenu}>
                <Icone className="h-5 w-5" aria-hidden="true" /> {rotulo}
              </TabsTrigger>
            ))}
          </TabsList>
        </aside>
      )}
    </Tabs>
  );
}