/**
 * Regras da palavra-passe de ADMIN (troca no painel). São as MESMAS de scripts/criar-admin.mjs (12 a 128 caracteres, recusa as óbvias e as que contêm
 * o email ou o utilizador): se uma mudar, mudar a outra (o teste admin-trocar-password compara as duas com o mesmo conjunto de casos).
 * Não se aplica às contas normais (o registo e a recuperação têm as suas regras).
 */
export const MIN_PASSWORD_ADMIN = 12;
export const MAX_PASSWORD_ADMIN = 128;
const OBVIAS = ["password", "passw0rd", "palavrapasse", "palavra-passe", "senha", "admin", "administrador", "xclusive", "qwerty", "azerty", "letmein", "welcome", "iloveyou", "angola", "luanda", "123456", "654321", "abcdef", "000000", "111111"];

/** null = aceite; senão a mensagem (nunca inclui a palavra-passe). */
export function problemaDaPasswordAdmin(p: string, { email, username }: { email: string; username: string }): string | null {
  if (p.length < MIN_PASSWORD_ADMIN) return `A palavra-passe tem de ter pelo menos ${MIN_PASSWORD_ADMIN} caracteres.`;
  if (p.length > MAX_PASSWORD_ADMIN) return `A palavra-passe tem de ter no máximo ${MAX_PASSWORD_ADMIN} caracteres.`;
  const l = p.toLowerCase();
  if (new Set(l).size < 5) return "A palavra-passe é demasiado óbvia (poucos caracteres diferentes).";
  if (OBVIAS.some((o) => l.includes(o))) return "A palavra-passe é demasiado óbvia (contém uma palavra ou sequência comum).";
  const local = email.split("@")[0];
  for (const parte of [local, username]) if (parte.length >= 4 && l.includes(parte.toLowerCase())) return "A palavra-passe não pode conter o email nem o nome de utilizador.";
  if (/^(.)\1+$/.test(p) || "abcdefghijklmnopqrstuvwxyz0123456789".includes(l) || "9876543210zyxwvutsrqponmlkjihgfedcba".includes(l)) return "A palavra-passe é demasiado óbvia (sequência).";
  return null;
}
