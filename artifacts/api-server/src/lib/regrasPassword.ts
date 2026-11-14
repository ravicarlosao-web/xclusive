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

/**
 * Palavra-passe inicial gerada pelo sistema (superadmin a criar/redefinir um admin): 20 caracteres aleatórios (crypto.randomInt), sem caracteres ambíguos
 * (l, 1, I, O, 0), com pelo menos uma minúscula, uma maiúscula, um dígito e um símbolo, e que passa SEMPRE as regras de problemaDaPasswordAdmin.
 * Só existe em memória: é devolvida UMA vez ao superadmin e nunca é guardada, registada nem recuperável (na BD fica só o hash).
 */
import { randomInt } from "node:crypto";
const MINUSCULAS = "abcdefghijkmnopqrstuvwxyz", MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ", DIGITOS = "23456789", SIMBOLOS = "-_!#%+=";
export function gerarPasswordAdmin(ctx: { email: string; username: string }): string {
  const todos = MINUSCULAS + MAIUSCULAS + DIGITOS + SIMBOLOS;
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const c = [MINUSCULAS, MAIUSCULAS, DIGITOS, SIMBOLOS].map((g) => g[randomInt(g.length)]);
    while (c.length < 20) c.push(todos[randomInt(todos.length)]);
    for (let i = c.length - 1; i > 0; i--) { const j = randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }   // Fisher–Yates com crypto.randomInt
    const p = c.join("");
    if (!problemaDaPasswordAdmin(p, ctx)) return p;
  }
  throw new Error("Não foi possível gerar uma palavra-passe válida");
}
