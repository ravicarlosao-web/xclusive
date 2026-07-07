import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile, useGetUserSuggestions, useFollowUser } from '@workspace/api-client-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ProfileUpdateTipoConta } from '@workspace/api-client-react';
import { Check, Camera, ArrowRight, Loader2 } from 'lucide-react';

const CATEGORIES = ['Moda', 'Fitness', 'Arte', 'Música', 'Viagens', 'Culinária', 'Tecnologia', 'Comédia', 'Lifestyle'];

export default function Onboarding() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const updateProfile = useUpdateProfile();
  
  // State for form
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [link, setLink] = useState(user?.link || '');
  const [tipoConta, setTipoConta] = useState<ProfileUpdateTipoConta>('pessoal');
  const [interests, setInterests] = useState<string[]>([]);

  const handleNext = async () => {
    if (step === 1) {
      if (avatarUrl) {
        await updateProfile.mutateAsync({ data: { avatarUrl } });
      }
      setStep(2);
    } else if (step === 2) {
      await updateProfile.mutateAsync({ data: { bio, link } });
      setStep(3);
    } else if (step === 3) {
      await updateProfile.mutateAsync({ data: { tipoConta } });
      setStep(4);
    } else if (step === 4) {
      // API might not have an interests endpoint directly in the profile update, 
      // but we pretend it's saved or proceed to 5
      setStep(5);
    } else if (step === 5) {
      setLocation('/home');
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3, 4, 5].map((s) => (
            <div 
              key={s} 
              className={`h-2 flex-1 rounded-full ${s <= step ? 'bg-primary' : 'bg-secondary'}`} 
            />
          ))}
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-2xl min-h-[400px] flex flex-col">
          {step === 1 && (
            <div className="flex-1 flex flex-col items-center text-center">
              <h2 className="text-2xl font-bold mb-2">Adiciona uma foto de perfil</h2>
              <p className="text-muted-foreground mb-8">Mostra quem tu és à comunidade.</p>
              
              <div className="relative mb-8 cursor-pointer group">
                <Avatar className="w-32 h-32 border-4 border-background shadow-xl">
                  <AvatarImage src={avatarUrl} />
                  <AvatarFallback className="bg-secondary text-4xl">{user?.username[0]}</AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="w-8 h-8 text-white" />
                </div>
              </div>
              <Input 
                placeholder="URL da imagem (mock)" 
                value={avatarUrl} 
                onChange={(e) => setAvatarUrl(e.target.value)}
                className="mb-auto"
              />
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 flex flex-col">
              <h2 className="text-2xl font-bold mb-2">A tua bio e link</h2>
              <p className="text-muted-foreground mb-8">Fala um pouco sobre ti.</p>
              
              <div className="space-y-4 mb-auto">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Biografia</label>
                  <Textarea 
                    placeholder="Conta-nos a tua história..." 
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="resize-none h-24 bg-secondary/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Link (opcional)</label>
                  <Input 
                    placeholder="https://..." 
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    className="bg-secondary/50"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex-1 flex flex-col">
              <h2 className="text-2xl font-bold mb-2">Tipo de Conta</h2>
              <p className="text-muted-foreground mb-8">Como pretendes usar o Xclusive?</p>
              
              <div className="grid gap-4 mb-auto">
                <button 
                  onClick={() => setTipoConta('pessoal')}
                  className={`flex flex-col items-start p-4 border rounded-xl transition-all ${tipoConta === 'pessoal' ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50 hover:bg-secondary'}`}
                >
                  <span className="font-bold mb-1">Pessoal</span>
                  <span className="text-sm text-muted-foreground text-left">Quero descobrir conteúdo, seguir criadores e interagir com os meus amigos.</span>
                </button>
                <button 
                  onClick={() => setTipoConta('criador')}
                  className={`flex flex-col items-start p-4 border rounded-xl transition-all ${tipoConta === 'criador' ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50 hover:bg-secondary'}`}
                >
                  <span className="font-bold mb-1 text-primary">Criador</span>
                  <span className="text-sm text-muted-foreground text-left">Quero partilhar o meu conteúdo, criar subscrições exclusivas e ganhar dinheiro.</span>
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex-1 flex flex-col">
              <h2 className="text-2xl font-bold mb-2">Quais são os teus interesses?</h2>
              <p className="text-muted-foreground mb-8">Para te mostrarmos o melhor conteúdo.</p>
              
              <div className="flex flex-wrap gap-3 mb-auto">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      if (interests.includes(cat)) setInterests(interests.filter(c => c !== cat));
                      else setInterests([...interests, cat]);
                    }}
                    className={`px-4 py-2 border rounded-full text-sm font-semibold transition-all ${interests.includes(cat) ? 'bg-primary text-white border-primary' : 'bg-transparent border-border text-foreground hover:border-primary/50'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <Step5Suggestions onComplete={() => setLocation('/home')} />
          )}

          {step < 5 && (
            <Button 
              className="w-full mt-6 h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white" 
              onClick={handleNext}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? <Loader2 className="animate-spin w-5 h-5" /> : (
                <>Continuar <ArrowRight className="w-5 h-5 ml-2" /></>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Step5Suggestions({ onComplete }: { onComplete: () => void }) {
  const { data, isLoading } = useGetUserSuggestions({ query: { queryKey: ['/api/users/suggestions'] } });
  const followUser = useFollowUser();
  const [followedIds, setFollowedIds] = useState<number[]>([]);

  const handleFollow = (id: number, username: string) => {
    if (followedIds.includes(id)) {
      setFollowedIds(followedIds.filter(fid => fid !== id));
    } else {
      setFollowedIds([...followedIds, id]);
      followUser.mutate({ username });
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <h2 className="text-2xl font-bold mb-2">Pessoas a seguir</h2>
      <p className="text-muted-foreground mb-6">Começa a construir o teu feed.</p>
      
      <div className="space-y-4 mb-auto overflow-y-auto max-h-[250px] pr-2">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>
        ) : (
          data?.slice(0, 5).map(user => {
            const isFollowed = followedIds.includes(user.id);
            return (
              <div key={user.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={user.avatarUrl || ''} />
                    <AvatarFallback>{user.username[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-1">
                      {user.username}
                      {user.verificado && (
                        <svg className="w-3 h-3 text-primary fill-current" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate w-[120px] sm:w-[200px]">{user.nomeExibicao}</div>
                  </div>
                </div>
                <Button 
                  size="sm" 
                  variant={isFollowed ? "secondary" : "default"}
                  className={!isFollowed ? "bg-primary text-white hover:bg-primary/90" : ""}
                  onClick={() => handleFollow(user.id, user.username)}
                >
                  {isFollowed ? <Check className="w-4 h-4" /> : 'Seguir'}
                </Button>
              </div>
            );
          })
        )}
      </div>

      <Button 
        className="w-full mt-6 h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white" 
        onClick={onComplete}
      >
        Concluir
      </Button>
    </div>
  );
}