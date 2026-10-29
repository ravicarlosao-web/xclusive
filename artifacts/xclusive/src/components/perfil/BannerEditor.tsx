import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateProfile } from '@workspace/api-client-react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { enviarImagem } from '@/lib/uploadImagem';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MB = 5;
const MSG_TIPO = 'Usa uma imagem JPG, PNG ou WEBP.';
const MSG_TAMANHO = `A imagem é demasiado grande. O máximo é ${MAX_MB} MB.`;
const MSG_GUARDAR = 'Não foi possível guardar o banner. Tenta novamente.';

/** Valida o ficheiro escolhido no cliente. Devolve a mensagem de erro, ou null se estiver bem. */
export function validarBanner(f: { type: string; size: number }): string | null {
  if (!TIPOS.includes(f.type)) return MSG_TIPO;
  if (f.size > MAX_MB * 1024 * 1024) return MSG_TAMANHO;
  return null;
}

/**
 * Só para o dono do perfil. Botão de câmara no banner → diálogo com o aviso e o tamanho recomendado → escolher imagem →
 * pré-visualização no próprio banner com Guardar/Cancelar. Guardar envia pelo upload existente e grava com PUT /users/me
 * (capaUrl). Sem recorte (object-cover centrado). A imagem anterior NÃO é apagada do CDN.
 */
export function BannerEditor({ username, temCapa, onPreview }: { username: string; temCapa: boolean; onPreview: (url: string | null) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateProfile = useUpdateProfile();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [ficheiro, setFicheiro] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroGuardar, setErroGuardar] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const limpar = () => { setFicheiro(null); setPreviewUrl(null); setErroGuardar(null); onPreview(null); };
  const refrescar = async () => { await queryClient.invalidateQueries({ queryKey: ['/api/users', username] }); };

  function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const msg = validarBanner(f);
    if (msg) { setErro(msg); return; }
    setErro(null);
    const url = URL.createObjectURL(f);
    setFicheiro(f); setPreviewUrl(url); setErroGuardar(null); setAberto(false); onPreview(url);
  }

  async function guardar() {
    if (!ficheiro || aGuardar) return;
    setAGuardar(true); setErroGuardar(null);
    try {
      const { url } = await enviarImagem(ficheiro);
      await updateProfile.mutateAsync({ data: { capaUrl: url } });
      await refrescar();
      limpar();
      toast({ title: 'Banner atualizado' });
    } catch {
      // Sem detalhes do servidor nem do armazenamento: só uma mensagem segura.
      setErroGuardar(MSG_GUARDAR);
    } finally {
      setAGuardar(false);
    }
  }

  async function remover() {
    if (aGuardar) return;
    setAGuardar(true); setErro(null);
    try {
      await updateProfile.mutateAsync({ data: { capaUrl: '' } });
      await refrescar();
      setAberto(false);
      toast({ title: 'Banner removido' });
    } catch {
      setErro('Não foi possível remover o banner. Tenta novamente.');
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <>
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={aoEscolher} data-testid="banner-ficheiro" />

      {ficheiro ? (
        <div className="absolute inset-x-2 bottom-2 flex flex-col items-end gap-1" data-testid="banner-pre-visualizacao">
          {erroGuardar && <p role="alert" className="rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white" data-testid="banner-erro-guardar">{erroGuardar}</p>}
          <div className="flex gap-2">
            <Button type="button" onClick={limpar} disabled={aGuardar} className="min-h-[44px] rounded-full bg-black/60 px-5 text-white hover:bg-black/75" data-testid="banner-cancelar">Cancelar</Button>
            <Button type="button" onClick={() => { void guardar(); }} disabled={aGuardar} className="min-h-[44px] rounded-full bg-background px-5 font-bold text-primary hover:bg-background/90" data-testid="banner-guardar">{aGuardar ? 'A guardar…' : 'Guardar'}</Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setErro(null); setAberto(true); }} aria-label="Alterar banner" data-testid="banner-alterar"
          className="absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none">
          <Camera className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      <Dialog open={aberto} onOpenChange={(o) => { if (!aGuardar) setAberto(o); }}>
        <DialogContent className="max-w-md" data-testid="banner-dialogo">
          <DialogHeader>
            <DialogTitle>Alterar banner</DialogTitle>
            <DialogDescription>O banner é público. Não uses conteúdo explícito.</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Formatos JPG, PNG ou WEBP, até {MAX_MB} MB. Tamanho recomendado: 1500 x 450 px.</p>
          {erro && <p role="alert" className="text-sm font-medium text-destructive" data-testid="banner-erro">{erro}</p>}
          <div className="flex flex-col gap-2">
            <Button type="button" className="min-h-[44px] gap-2 border border-primary/30 bg-primary/10 font-bold text-primary hover:bg-primary/20" onClick={() => entrada.current?.click()} disabled={aGuardar} data-testid="banner-escolher"><ImagePlus className="h-4 w-4" aria-hidden="true" /> Escolher imagem</Button>
            {temCapa && (
              <Button type="button" variant="outline" className="min-h-[44px] gap-2 text-destructive hover:text-destructive" onClick={() => { void remover(); }} disabled={aGuardar} data-testid="banner-remover"><Trash2 className="h-4 w-4" aria-hidden="true" /> Remover banner</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
