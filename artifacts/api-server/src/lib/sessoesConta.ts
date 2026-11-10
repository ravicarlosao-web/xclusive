import { deleteAllUserSessions, revokeToken } from "./auth";
import { desligarSockets } from "./suspensao";

/** Termina TODAS as sessões da conta: revoga os refresh tokens (e limpa as sessões ativas) e desliga os sockets abertos. Os tokens de acesso já emitidos caem pelo `password_alterada_em`. */
export async function terminarSessoesDaConta(userId: number): Promise<void> {
  const sessoes = await deleteAllUserSessions(userId);
  await Promise.all(sessoes.map(({ jti, expiresAt }) => revokeToken(jti, userId, expiresAt)));
  desligarSockets(userId);
}
