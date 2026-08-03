/** Shared localStorage helpers for top-up requests (no React — safe for Fast Refresh) */

export const MOCK_TOPUP_KEY = 'xclusive_topup_requests';

export interface TopUpRequest {
  id: string;
  userId: number;
  username: string;
  nomeCompleto: string;
  amount: number;
  reference: string;
  criadoEm: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  processadoEm?: string;
  adminNota?: string;
  /** Comprovativo PDF em base64 (data URI) */
  comprovantivoBase64?: string;
  /** Nome original do ficheiro PDF */
  comprovantivoNome?: string;
}

export function getTopUpRequests(): TopUpRequest[] {
  try { return JSON.parse(localStorage.getItem(MOCK_TOPUP_KEY) || '[]'); } catch { return []; }
}

export function saveTopUpRequests(reqs: TopUpRequest[]) {
  localStorage.setItem(MOCK_TOPUP_KEY, JSON.stringify(reqs));
}
