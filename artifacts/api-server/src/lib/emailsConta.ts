/** Textos dos emails da conta, em português de Angola (tratamento por «tu»). Só texto e HTML mínimo: sem imagens nem rastreio. */
import { emailLegal } from "./contactos";
import { VALIDADE_RECUPERACAO_MIN, VALIDADE_VERIFICACAO_MIN } from "./tokensEmail";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = (corpo: string, rodape: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${corpo}<hr style="border:none;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:13px;color:#555">${rodape}</p></div>`;

export function emailRecuperacao(ligacao: string): { assunto: string; texto: string; html: string } {
  const rodape = `Xclusive · Dúvidas? Contacta ${emailLegal()}`;
  return {
    assunto: "Redefine a tua palavra-passe na Xclusive",
    texto: `Olá,\n\nRecebemos um pedido para redefinir a palavra-passe da tua conta na Xclusive.\n\nUsa esta ligação nos próximos ${VALIDADE_RECUPERACAO_MIN} minutos:\n${ligacao}\n\nSe não fizeste este pedido, ignora este email: a tua palavra-passe continua a mesma.\n\n—\n${rodape}`,
    html: html(`<p>Olá,</p><p>Recebemos um pedido para redefinir a palavra-passe da tua conta na Xclusive.</p><p>Usa esta ligação nos próximos ${VALIDADE_RECUPERACAO_MIN} minutos:<br><a href="${esc(ligacao)}">${esc(ligacao)}</a></p><p>Se não fizeste este pedido, ignora este email: a tua palavra-passe continua a mesma.</p>`, esc(rodape)),
  };
}

export function emailPasswordAlterada(): { assunto: string; texto: string; html: string } {
  const legal = emailLegal();
  return {
    assunto: "A tua palavra-passe foi alterada",
    texto: `Olá,\n\nA palavra-passe da tua conta na Xclusive foi alterada e todas as sessões foram terminadas.\n\nSe não foste tu, contacta de imediato ${legal}.\n\n—\nXclusive · ${legal}`,
    html: html(`<p>Olá,</p><p>A palavra-passe da tua conta na Xclusive foi alterada e todas as sessões foram terminadas.</p><p>Se não foste tu, contacta de imediato <a href="mailto:${esc(legal)}">${esc(legal)}</a>.</p>`, `Xclusive · ${esc(legal)}`),
  };
}

export function emailVerificacao(ligacao: string): { assunto: string; texto: string; html: string } {
  const rodape = `Xclusive · Dúvidas? Contacta ${emailLegal()}`;
  return {
    assunto: "Confirma o teu email no Xclusive",
    texto: `Olá!\n\nPediste para verificar o email da tua conta no Xclusive. Clica na ligação abaixo para confirmar.\n${ligacao}\n\nA ligação é válida durante ${VALIDADE_VERIFICACAO_MIN} minutos e só pode ser usada uma vez.\n\nSe não foste tu, ignora esta mensagem: nada será alterado.\n\n—\n${rodape}`,
    html: html(`<p>Olá!</p><p>Pediste para verificar o email da tua conta no Xclusive. Clica na ligação abaixo para confirmar.<br><a href="${esc(ligacao)}">${esc(ligacao)}</a></p><p>A ligação é válida durante ${VALIDADE_VERIFICACAO_MIN} minutos e só pode ser usada uma vez.</p><p>Se não foste tu, ignora esta mensagem: nada será alterado.</p>`, esc(rodape)),
  };
}
