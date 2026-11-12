import { useCallback, useEffect, useState } from 'react';
import { getMe } from '@workspace/api-client-react';

export type EstadoEmail = 'carregando' | 'verificado' | 'por_verificar' | 'erro';

/** Estado da verificação do email da conta (campo `emailVerificado` de GET /api/auth/me). Só leitura; sem sessão fica em «erro». */
export function useEmailVerificado(ativo = true): { estado: EstadoEmail; recarregar: () => Promise<void> } {
  const [estado, setEstado] = useState<EstadoEmail>('carregando');
  const recarregar = useCallback(async () => {
    try {
      const me = await getMe();
      setEstado(me?.emailVerificado === true ? 'verificado' : 'por_verificar');
    } catch {
      setEstado('erro');
    }
  }, []);
  useEffect(() => { if (ativo) void recarregar(); }, [ativo, recarregar]);
  return { estado, recarregar };
}
