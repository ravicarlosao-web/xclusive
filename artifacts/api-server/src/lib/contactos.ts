/**
 * Contactos da plataforma: UM só sítio com os endereços por defeito. Leitura preguiçosa (a cada chamada), por isso respeita o
 * ambiente já carregado do .env. Valores em branco contam como em falta.
 */
export const EMAIL_LEGAL_PADRAO = "legal@xclusive.ao";

const lido = (nome: string): string | null => process.env[nome]?.trim() || null;

/** Email legal (LEGAL_EMAIL): textos legais, encerramento de conta, levantamentos retidos, retirada de conteúdo. */
export const emailLegal = (): string => lido("LEGAL_EMAIL") ?? EMAIL_LEGAL_PADRAO;

/** Email das denúncias (REPORTS_CONTACT_EMAIL); sem ele, usa o email legal. */
export const emailDenuncias = (): string => lido("REPORTS_CONTACT_EMAIL") ?? emailLegal();
