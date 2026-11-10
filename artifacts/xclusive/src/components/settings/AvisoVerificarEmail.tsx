import { useState } from 'react';
import { Link } from 'wouter';
import { MailWarning, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEmailVerificado } from '@/hooks/useEmailVerificado';

const CHAVE = 'xclusive_aviso_email_dispensado';
const jaDispensado = () => { try { return sessionStorage.getItem(CHAVE) === '1'; } catch { return false; } };

/** Aviso discreto e dispensável (por sessão) para criadores cujo email ainda não está verificado. Nunca bloqueia nada. */
export function AvisoVerificarEmail() {
  const { user } = useAuth();
  const ehCriador = user?.tipoConta === 'criador';
  const { estado } = useEmailVerificado(ehCriador);
  const [dispensado, setDispensado] = useState(jaDispensado);
  if (!ehCriador || estado !== 'por_verificar' || dispensado) return null;
  return (
    <div role="status" data-testid="aviso-verificar-email" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm mb-4">
      <MailWarning className="w-5 h-5 shrink-0 mt-0.5 text-amber-800 dark:text-amber-400" aria-hidden="true" />
      <p className="flex-1 text-amber-900 dark:text-amber-200/90">Verifica o teu email para proteger a tua conta. <Link href="/definicoes" className="inline-flex items-center min-h-[44px] font-semibold underline" data-testid="aviso-verificar-email-link">Ir às Definições</Link></p>
      <button type="button" aria-label="Dispensar aviso" data-testid="aviso-verificar-email-fechar" className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] -m-2" onClick={() => { try { sessionStorage.setItem(CHAVE, '1'); } catch { /* sem armazenamento */ } setDispensado(true); }}>
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
