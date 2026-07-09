import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, RefreshCw, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CameraOverlay = 'document' | 'face' | 'face-document' | 'none';
export type CameraFacing = 'user' | 'environment';

interface CameraCaptureProps {
  facingMode: CameraFacing;
  overlay: CameraOverlay;
  onCapture: (dataUrl: string) => void;
  /** If true, hides the capture button — parent controls capture via capturedSignal */
  manualMode?: boolean;
  /** Increment this to trigger an auto-capture */
  captureSignal?: number;
  className?: string;
}

type Status = 'loading' | 'ready' | 'captured' | 'error';
type ErrorType = 'denied' | 'not-found' | 'general';

export function CameraCapture({
  facingMode,
  overlay,
  onCapture,
  manualMode = false,
  captureSignal = 0,
  className,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<ErrorType | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const prevSignal = useRef(0);

  const startCamera = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setCapturedUrl(null);

    // Stop any existing stream first
    streamRef.current?.getTracks().forEach(t => t.stop());

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus('ready');
    } catch (err: any) {
      const name = err?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('denied');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('not-found');
      } else {
        setError('general');
      }
      setStatus('error');
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  // Auto-capture when signal changes
  useEffect(() => {
    if (captureSignal !== prevSignal.current && status === 'ready') {
      prevSignal.current = captureSignal;
      doCapture();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureSignal, status]);

  const doCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mirror if using front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    streamRef.current?.getTracks().forEach(t => t.stop());
    setCapturedUrl(dataUrl);
    setStatus('captured');
    onCapture(dataUrl);
  }, [facingMode, onCapture]);

  const retake = () => {
    setCapturedUrl(null);
    startCamera();
  };

  // ── Overlays ──────────────────────────────────────────────────────────────

  const DocumentOverlay = () => (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {/* Dark vignette */}
      <div className="absolute inset-0 bg-black/40" style={{
        maskImage: 'radial-gradient(ellipse 75% 55% at 50% 50%, transparent 50%, black 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 75% 55% at 50% 50%, transparent 50%, black 100%)',
      }} />
      {/* Document rectangle */}
      <div className="relative w-[78%] aspect-[1.586/1] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
        {/* Corner accents */}
        {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(pos => (
          <div key={pos} className={cn('absolute w-6 h-6 border-white border-[3px]',
            pos === 'top-left' && 'top-0 left-0 border-r-0 border-b-0 rounded-tl-lg',
            pos === 'top-right' && 'top-0 right-0 border-l-0 border-b-0 rounded-tr-lg',
            pos === 'bottom-left' && 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl-lg',
            pos === 'bottom-right' && 'bottom-0 right-0 border-l-0 border-t-0 rounded-br-lg',
          )} />
        ))}
        <p className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-white/80 text-xs font-medium whitespace-nowrap tracking-wide">
          Encaixa o documento neste espaço
        </p>
      </div>
    </div>
  );

  const FaceOverlay = ({ includeDoc = false }: { includeDoc?: boolean }) => (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/40" style={{
        maskImage: 'radial-gradient(ellipse 52% 62% at 50% 42%, transparent 50%, black 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 52% 62% at 50% 42%, transparent 50%, black 100%)',
      }} />
      {/* Face oval */}
      <div className="relative w-[52%] aspect-[3/4] rounded-[50%] border-2 border-white/80 mt-[-8%]
        shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
        <p className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-white/80 text-xs font-medium whitespace-nowrap tracking-wide">
          {includeDoc ? 'Rosto e documento visíveis' : 'Alinha o teu rosto'}
        </p>
      </div>
      {includeDoc && (
        <div className="absolute bottom-[12%] right-[8%] w-[22%] aspect-[1.586/1] rounded-lg border-2 border-white/60 bg-white/5">
          <p className="absolute -top-5 left-1/2 -translate-x-1/2 text-white/70 text-[10px] font-medium whitespace-nowrap">BI aqui</p>
        </div>
      )}
    </div>
  );

  // ── Error states ──────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div className={cn('relative bg-secondary rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[280px]', className)}>
        <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-destructive" />
        </div>
        {error === 'denied' && (
          <>
            <div>
              <p className="font-semibold text-white text-base mb-1">Câmera bloqueada</p>
              <p className="text-muted-foreground text-sm">Permite o acesso à câmera nas definições do teu browser para continuar.</p>
            </div>
            <ol className="text-left text-xs text-muted-foreground space-y-1 bg-background/50 rounded-xl p-4 w-full">
              <li>1. Clica no ícone 🔒 na barra de endereço</li>
              <li>2. Seleciona <strong className="text-foreground">Câmera → Permitir</strong></li>
              <li>3. Recarrega a página e tenta novamente</li>
            </ol>
          </>
        )}
        {error === 'not-found' && (
          <div>
            <p className="font-semibold text-white text-base mb-1">Câmera não encontrada</p>
            <p className="text-muted-foreground text-sm">Certifica-te de que o teu dispositivo tem uma câmera ligada.</p>
          </div>
        )}
        {error === 'general' && (
          <div>
            <p className="font-semibold text-white text-base mb-1">Erro ao aceder à câmera</p>
            <p className="text-muted-foreground text-sm">Ocorreu um erro inesperado. Tenta novamente.</p>
          </div>
        )}
        <Button onClick={startCamera} variant="outline" className="gap-2 mt-2">
          <RefreshCw className="w-4 h-4" /> Tentar novamente
        </Button>
      </div>
    );
  }

  // ── Captured preview ──────────────────────────────────────────────────────

  if (status === 'captured' && capturedUrl) {
    return (
      <div className={cn('relative bg-black rounded-2xl overflow-hidden', className)}>
        <img src={capturedUrl} alt="Captura" className="w-full h-full object-cover" style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
        <div className="absolute inset-0 flex flex-col items-end justify-between p-4 pointer-events-none">
          <div className="bg-green-500/90 text-white text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 pointer-events-none">
            <CheckCircle2 className="w-3.5 h-3.5" /> Capturado
          </div>
          <Button
            onClick={retake}
            variant="secondary"
            size="sm"
            className="pointer-events-auto gap-1.5 bg-black/60 hover:bg-black/80 text-white border-white/20"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tirar de novo
          </Button>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  // ── Live viewfinder ───────────────────────────────────────────────────────

  return (
    <div className={cn('relative bg-black rounded-2xl overflow-hidden', className)}>
      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-black/80">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">A aceder à câmera…</p>
        </div>
      )}

      {/* Video feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
      />

      {/* Overlay guides */}
      {status === 'ready' && overlay === 'document' && <DocumentOverlay />}
      {status === 'ready' && overlay === 'face' && <FaceOverlay />}
      {status === 'ready' && overlay === 'face-document' && <FaceOverlay includeDoc />}

      {/* Capture button */}
      {status === 'ready' && !manualMode && (
        <div className="absolute bottom-5 inset-x-0 flex justify-center z-20">
          <button
            onClick={doCapture}
            className="w-16 h-16 rounded-full bg-white border-4 border-white/40 shadow-xl hover:scale-105 active:scale-95 transition-transform flex items-center justify-center"
            aria-label="Tirar foto"
          >
            <Camera className="w-7 h-7 text-black" />
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
