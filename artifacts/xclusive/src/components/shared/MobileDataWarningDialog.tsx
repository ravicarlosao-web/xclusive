import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Wifi, Smartphone } from 'lucide-react';

interface MobileDataWarningDialogProps {
  open: boolean;
  fileSizeBytes: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MobileDataWarningDialog({
  open,
  fileSizeBytes,
  onConfirm,
  onCancel,
}: MobileDataWarningDialogProps) {
  const sizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <AlertDialogContent className="max-w-[420px] rounded-2xl bg-card border-border p-6 shadow-2xl">
        <AlertDialogHeader className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 mb-1 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
            <div className="relative">
              <Smartphone className="w-7 h-7 text-amber-500" />
              <Wifi className="w-4 h-4 text-amber-400 absolute -top-1 -right-2 animate-pulse" />
            </div>
          </div>

          <AlertDialogTitle className="text-lg font-bold text-foreground">
            Aviso de Consumo de Dados
          </AlertDialogTitle>

          <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed text-center">
            Este vídeo tem aproximadamente <span className="font-bold text-foreground">{sizeMb} MB</span>.
            {' '}Isto pode consumir uma quantidade significativa dos teus dados móveis.
            {' '}Recomendamos usar <span className="font-semibold text-foreground">Wi-Fi</span> se possível.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 mt-4">
          <AlertDialogCancel
            onClick={onCancel}
            className="rounded-xl border-border hover:bg-secondary w-full sm:w-auto"
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold w-full sm:w-auto shadow-md"
          >
            Continuar mesmo assim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
