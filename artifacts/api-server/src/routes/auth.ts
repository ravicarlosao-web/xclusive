import { linkSeguro } from "../lib/linkSeguro";
import { Router, type Response } from "express";
import { db, usersTable, followsTable, revokedTokensTable, userLegalAcceptancesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  signAccessToken, signRefreshToken, verifyToken,
  hashPassword, comparePassword, requireAuth, revokeToken,
  createSession, deleteSession, deleteAllUserSessions,
  REFRESH_COOKIE, DUMMY_HASH, emitidoAntesDaAlteracao, type AuthRequest, type JwtPayload,
} from "../lib/auth";
import { MSG_CONTA_SUSPENSA, CODIGO_CONTA_SUSPENSA } from "../lib/suspensao";
import {
  lerRegistosAbertos, lerRegistosAbertosBloqueando, RegistosFechadosError, MSG_REGISTOS_FECHADOS, CODIGO_REGISTOS_FECHADOS,
} from "../lib/registos";
import { validate } from "../lib/validate";
import { urlMedia } from "../lib/storage";
import { getMinWithdrawal } from "./wallet";
import { erroSeguro } from "../lib/erroSeguro";
import { MSG_CONTA_BANIDA, identificadorBloqueado } from "../lib/banimento";
import { mensagemContaEncerrada, CODIGO_CONTA_ENCERRADA, utilizadorAtivo } from "../lib/encerramento";
import { emailLegal } from "../lib/contactos";
import { logger } from "../lib/logger";
import { enviarEmail, lerConfigEmail, urlPublico } from "../lib/email";
import { emailRecuperacao, emailPasswordAlterada, emailVerificacao } from "../lib/emailsConta";
import { criarTokenRecuperacao, consumirTokenRecuperacao, invalidarTokensRecuperacao, pedidosNaUltimaHora, tokenComFormato, MAX_EMAILS_POR_ENDERECO_HORA, criarTokenVerificacao, consumirTokenVerificacao, verificacoesNaUltimaHora, segundosAteReenvio, descartarToken } from "../lib/tokensEmail";
import { terminarSessoesDaConta } from "../lib/sessoesConta";

// ── Cookie helpers ────────────────────────────────────────────────────────────
// Activar Secure em qualquer ambiente que não seja desenvolvimento local.
// NODE_ENV=development → HTTP localhost → sem Secure (necessário para o browser aceitar o cookie).
// NODE_ENV=production | staging | qualquer outro valor → HTTPS → Secure obrigatório.
// Isto cobre o caso de staging correr em HTTPS com NODE_ENV != "production".
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  sameSite: "strict" as const,
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, COOKIE_OPTS);
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...COOKIE_OPTS, maxAge: 0 });
}

const router = Router();

// ── Documentos legais ────────────────────────────────────────────────────────
// Versões VIGENTES. Quando o texto jurídico mudar, o advogado/dev altera a versão e a data aqui:
// o registo passa a exigir o aceite da nova versão e as páginas legais mostram-na.
// (Termos, Privacidade e Cookies: v2.2 do advogado (docs/legal/v2.2); Conteúdo, Reembolsos, Direitos de Autor e Criadoras: v2.3 (docs/legal/v2.3). `atualizadoEm` é a data da versão; a data de entrada em vigor dos textos é «a definir na publicação».)
export const LEGAL_DOCS = {
  termos:          { versao: "2.2", atualizadoEm: "2026-11-13" },
  privacidade:     { versao: "2.2", atualizadoEm: "2026-11-13" },
  // Política de Cookies (v2.2): tem página pública e versão própria; o aceite de cookies no registo continua a ser o booleano `cookies` (sem versão por utilizador).
  cookies:         { versao: "2.2", atualizadoEm: "2026-11-13" },
  conteudo:        { versao: "2.3", atualizadoEm: "2026-11-13" },
  direitosAutor:   { versao: "2.3", atualizadoEm: "2026-11-13" },
  reembolsos:      { versao: "2.3", atualizadoEm: "2026-11-13" },
  // Termos para Criadoras: aceites na ativação de criadora, NÃO no registo (o registo só exige as 5 chaves de versão acima: termos, privacidade, conteudo, direitosAutor e reembolsos; a Política de Cookies é o booleano `cookies`).
  criadoras:       { versao: "2.3", atualizadoEm: "2026-11-13" },
} as const;

/** Idade mínima para criar conta (plataforma de conteúdo adulto). */
const IDADE_MINIMA = 18;

/**
 * Valida a data de nascimento (YYYY-MM-DD): formato, data real, não futura e idade >= 18.
 * Devolve a mensagem de erro (para o utilizador) ou null se estiver tudo bem.
 * Todos os cálculos em UTC, só com dia/mês/ano, para não dependerem do fuso do servidor.
 */
export function validarDataNascimento(valor: string, agora: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return "Data de nascimento inválida (usa o formato AAAA-MM-DD).";
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return "Data de nascimento inválida.";
  }
  const hojeAno = agora.getUTCFullYear(), hojeMes = agora.getUTCMonth() + 1, hojeDia = agora.getUTCDate();
  if (ano > hojeAno || (ano === hojeAno && (mes > hojeMes || (mes === hojeMes && dia > hojeDia)))) {
    return "A data de nascimento não pode estar no futuro.";
  }
  let idade = hojeAno - ano;
  if (hojeMes < mes || (hojeMes === mes && hojeDia < dia)) idade -= 1;
  if (idade < IDADE_MINIMA) return `Tens de ter pelo menos ${IDADE_MINIMA} anos para criar uma conta.`;
  if (ano < 1900) return "Data de nascimento inválida.";
  return null;
}

/** Regra da palavra-passe (registo, redefinição e alteração). */
const passwordRegra = z.string().min(8, "Password deve ter pelo menos 8 caracteres").max(128);

export const registerSchema = z.object({
  nomeCompleto: z.string().min(2, "Nome deve ter pelo menos 2 caracteres").max(100),
  email: z.email("Email inválido").max(255),
  username: z
    .string()
    .min(3, "Username deve ter pelo menos 3 caracteres")
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, "Username só pode conter letras, números e _"),
  password: passwordRegra,
  // Obrigatória; formato, data real, não futura e idade >= 18 são validados no handler (mensagens claras).
  dataNascimento: z.string().min(1, "Data de nascimento é obrigatória").max(20),
  // Aceite dos documentos legais: versões que o utilizador viu (têm de ser as vigentes).
  aceite: z.object({
    termos: z.string().min(1).max(40),
    privacidade: z.string().min(1).max(40),
    conteudo: z.string().min(1).max(40),
    direitosAutor: z.string().min(1).max(40),
    reembolsos: z.string().min(1).max(40),
    // Cookies e armazenamento local: obrigatório; só true é aceite (em falta, false ou de outro tipo => 400, nada é criado).
    cookies: z.literal(true, { error: "Tens de aceitar a utilização de cookies e de armazenamento local." }),
    // Declaração de maioridade: boolean estrito e true. Em falta, false ou de outro tipo => 400 (nada é criado).
    maioridade: z.literal(true, { error: "Tens de declarar que tens 18 anos ou mais." }),
  }),
  tipoConta: z.enum(["pessoal", "criador"]).optional(),
  pais: z.string().max(10).optional(),
  telefone: z.string().max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().min(1, "Email ou username é obrigatório").max(255),
  password: z.string().min(1, "Password é obrigatória").max(128),
});

/** Versões vigentes dos documentos legais (público): o registo e as páginas legais usam isto. */
router.get("/auth/legal-versions", (_req, res): void => {
  res.json(LEGAL_DOCS);
});

/** Prazo de pagamento do levantamento, em dias úteis após a aprovação do pedido: 4 (Política de Reembolsos e Pagamentos v2.3, art. 6.º, e Termos para Criadoras v2.3, art. 4.º). Mínimo e máximo coincidem. */
const PRAZO_LEVANTAMENTO_MIN_DIAS = 4;
const PRAZO_LEVANTAMENTO_MAX_DIAS = 4;
/** Onde a criadora vê o levantamento mínimo em vigor e pede o levantamento (área de monetização das Definições). */
const PAGINA_LEVANTAMENTOS = "/definicoes/monetizacao";

/** Valor de uma variável de ambiente sem espaços; null se não existir ou estiver vazia. */
function lerEnvOpcional(nome: string): string | null {
  const valor = process.env[nome]?.trim();
  return valor ? valor : null;
}

/**
 * Dados variáveis dos textos legais (público, sem autenticação). O mínimo de levantamento vem da MESMA função que
 * valida os levantamentos (platform_settings.min_withdrawal_amount), para o texto e a regra nunca divergirem.
 * Falha a ler a base = 503 (nunca um mínimo inventado).
 */
router.get("/auth/legal-config", async (req, res): Promise<void> => {
  try {
    const minimoLevantamento = await getMinWithdrawal(db);
    res.json({
      empresaNome: lerEnvOpcional("LEGAL_EMPRESA_NOME") ?? "ORIGEM - COMÉRCIO E PRESTAÇÃO DE SERVIÇOS",
      empresaNif: lerEnvOpcional("LEGAL_EMPRESA_NIF"),
      empresaSede: lerEnvOpcional("LEGAL_EMPRESA_SEDE"),
      emailLegal: emailLegal(),
      minimoLevantamento,
      prazoLevantamentoMin: PRAZO_LEVANTAMENTO_MIN_DIAS,
      prazoLevantamentoMax: PRAZO_LEVANTAMENTO_MAX_DIAS,
      paginaLevantamentos: PAGINA_LEVANTAMENTOS,
    });
  } catch (err) {
    (req as any).log?.warn(erroSeguro(err), "Legal-config: falha ao ler o mínimo de levantamento");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
  }
});

export const MSG_USERNAME_EM_USO = "Esse nome de utilizador já está em uso";
export const CODIGO_USERNAME_EM_USO = "username_em_uso";
export const MSG_EMAIL_INDISPONIVEL = "Não foi possível criar a conta com este email. Se já tens conta, entra.";
export const CODIGO_EMAIL_INDISPONIVEL = "email_indisponivel";

/** Email normalizado para guardar e comparar: sem espaços nas pontas e em minúsculas. */
export function normalizarEmailConta(email: string): string {
  return email.trim().toLowerCase();
}

/** Violação de índice único (23505) no registo: qual dos dois (username | email); undefined se for outro erro. */
export function violacaoUnica(err: unknown): "username" | "email" | undefined {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.cause?.code, constraint = (e?.constraint ?? e?.cause?.constraint ?? "").toLowerCase();
  if (code !== "23505") return undefined;
  if (constraint.includes("username")) return "username";
  if (constraint.includes("email")) return "email";
  return undefined;
}

router.post("/auth/register", validate(registerSchema), async (req, res): Promise<void> => {
  const { nomeCompleto, email, username, password, dataNascimento, tipoConta, aceite } = req.body;
  const emailN = normalizarEmailConta(email); // trim + minúsculas (não colapsa pontos nem «+»: contas diferentes continuam permitidas)

  // Registos fechados pelo admin: recusa logo no início (antes de bcrypt e de qualquer escrita), para qualquer tipo de conta.
  // Falha a ler o estado = negar (fail-closed).
  try {
    if (!(await lerRegistosAbertos())) {
      res.status(403).json({ error: MSG_REGISTOS_FECHADOS, codigo: CODIGO_REGISTOS_FECHADOS });
      return;
    }
  } catch (err) {
    (req as any).log?.warn(erroSeguro(err), "Register: falha ao ler o estado dos registos — a negar (fail-closed)");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
    return;
  }

  // Barreira de idade no servidor (o front-end é só feedback): menores, datas inválidas e futuras recusadas.
  const erroData = validarDataNascimento(dataNascimento);
  if (erroData) {
    res.status(400).json({ error: erroData });
    return;
  }
  // O aceite tem de ser das versões vigentes (senão o utilizador aceitou texto desatualizado).
  if (
    aceite.termos !== LEGAL_DOCS.termos.versao ||
    aceite.privacidade !== LEGAL_DOCS.privacidade.versao ||
    aceite.conteudo !== LEGAL_DOCS.conteudo.versao ||
    aceite.direitosAutor !== LEGAL_DOCS.direitosAutor.versao ||
    aceite.reembolsos !== LEGAL_DOCS.reembolsos.versao
  ) {
    res.status(400).json({ error: "Os documentos legais foram atualizados. Recarrega a página e aceita as versões atuais." });
    return;
  }

  try {
    // Email banido (ou variante normalizada): recusa genérica, sem dizer porquê. Antes de bcrypt e de qualquer escrita; uma só
    // consulta indexada, como as outras recusas deste ponto. Sem BAN_HASH_PEPPER a verificação fica desligada (aviso seguro).
    // Username PRIMEIRO (é público: aparece nos perfis) e só depois o email, para a resposta do username nunca dizer nada sobre o email.
    const usernameN = username.toLowerCase();
    const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${usernameN}`).limit(1);
    if (existingUsername) {
      res.status(409).json({ error: MSG_USERNAME_EM_USO, codigo: CODIGO_USERNAME_EM_USO });
      return;
    }

    // Email banido (ou variante normalizada) e email já usado dão EXATAMENTE a mesma resposta (nada revela o estado de banido).
    // A comparação é por lower(email): contas antigas guardadas com maiúsculas também contam como «em uso».
    const emailBanido = await identificadorBloqueado(db, "email", emailN);
    const [existing] = emailBanido ? [undefined] : await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.email}) = ${emailN}`).limit(1);
    if (emailBanido || existing) {
      res.status(409).json({ error: MSG_EMAIL_INDISPONIVEL, codigo: CODIGO_EMAIL_INDISPONIVEL });
      return;
    }

    const passwordHash = await hashPassword(password);
    // IP só para o registo do aceite: guardado na BD, nunca escrito em logs.
    // req.ip respeita "trust proxy" (um salto): não aceita IPs forjados no início do X-Forwarded-For.
    const aceiteIp = (req.ip ?? "").slice(0, 45) || null;
    // User-Agent: do cabeçalho do pedido, cortado a 400 caracteres; fica só na BD (evidência), nunca em logs.
    const uaHeader = req.headers["user-agent"];
    const aceiteUserAgent = (typeof uaHeader === "string" ? uaHeader : "").slice(0, 400) || null;

    // Utilizador + aceite NA MESMA transação: se o aceite falhar, o registo é revertido.
    const user = await db.transaction(async (tx) => {
      // Relê o estado DENTRO da transação com FOR SHARE: se o admin fechou os registos entretanto, nada é criado.
      if (!(await lerRegistosAbertosBloqueando(tx))) throw new RegistosFechadosError();
      const [created] = await tx.insert(usersTable).values({
        nomeExibicao: nomeCompleto,
        email: emailN,
        username: usernameN,
        passwordHash,
        dataNascimento,
        tipoConta: tipoConta || "pessoal",
      }).returning();

      await tx.insert(userLegalAcceptancesTable).values({
        userId: created.id,
        termosVersao: aceite.termos,
        privacidadeVersao: aceite.privacidade,
        conteudoVersao: aceite.conteudo,
        direitosAutorVersao: aceite.direitosAutor,
        reembolsosVersao: aceite.reembolsos,
        cookiesAceites: true,
        ip: aceiteIp,
        userAgent: aceiteUserAgent,
        maioridadeConfirmada: true,
        origem: "registo",
      });
      return created;
    });

    const accessToken = signAccessToken({ userId: user.id, username: user.username, role: user.role });
    const { token: refreshToken, jti: refreshJti } = signRefreshToken(user.id, user.username, user.role);
    setRefreshCookie(res, refreshToken);

    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await createSession(user.id, refreshJti, sessionExpiresAt,
      req.headers["user-agent"],
      (req.ip ?? "").slice(0, 45) || undefined, // req.ip respeita "trust proxy": não aceita o X-Forwarded-For forjado
    );

    res.status(201).json({
      token: accessToken,
      user: formatUser(user, 0, 0, 0),
    });
  } catch (err) {
    if (err instanceof RegistosFechadosError) {
      res.status(403).json({ error: MSG_REGISTOS_FECHADOS, codigo: CODIGO_REGISTOS_FECHADOS });
      return;
    }
    // Registos em paralelo: o índice único apanha o que escapou às leituras → 409 claro (nunca 500).
    const dup = violacaoUnica(err);
    if (dup === "username") { res.status(409).json({ error: MSG_USERNAME_EM_USO, codigo: CODIGO_USERNAME_EM_USO }); return; }
    if (dup === "email") { res.status(409).json({ error: MSG_EMAIL_INDISPONIVEL, codigo: CODIGO_EMAIL_INDISPONIVEL }); return; }
    (req as any).log?.error(erroSeguro(err), "Register: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Hash dummy usado para normalizar o tempo de resposta quando a conta não existe.
// bcrypt.compare corre sempre o mesmo trabalho independentemente do hash —
// elimina o timing oracle entre "conta inexistente" e "password errada".

router.post("/auth/login", validate(loginSchema), async (req, res): Promise<void> => {
  const { email, password } = req.body;

  try {
    // Queries por email e username em paralelo — evita que a segunda query
    // sequencial produza uma diferença de latência observável (timing oracle).
    // REGRA: compara lower(users.email) com o identificador já em minúsculas — funciona com emails guardados com maiúsculas
    // (contas antigas), antes e depois de qualquer correção de dados, e nunca bloqueia uma conta existente.
    const ident = normalizarEmailConta(email);
    const [[byEmail], [byUsername]] = await Promise.all([
      db.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${ident}`).orderBy(usersTable.id).limit(1),
      db.select().from(usersTable).where(sql`lower(${usersTable.username}) = ${ident}`).orderBy(usersTable.id).limit(1),
    ]);

    const user = byEmail ?? byUsername ?? null;

    if (!user) {
      // Conta inexistente: correr bcrypt contra hash dummy para igualar a
      // latência ao caminho de "password errada" (onde comparePassword é sempre
      // invocado). Sem isto, a ausência do compare seria detectável por timing.
      await comparePassword(password, DUMMY_HASH);
      res.status(401).json({ error: "Credenciais inválidas" });
      return;
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Credenciais inválidas" });
      return;
    }

    // Conta suspensa: SÓ depois de a password estar certa (quem não a sabe não descobre que a conta existe
    // nem o seu estado). Sem token, sem sessão, sem cookie.
    if (!user.ativo) {
      if (user.banidaEm) {
        // Banida: mensagem permanente, sem motivo (e antes do encerramento: uma conta encerrada e depois banida é banida).
        res.status(403).json({ error: MSG_CONTA_BANIDA, codigo: CODIGO_CONTA_ENCERRADA });
        return;
      }
      if (user.encerradaEm) {
        // Encerrada pelo próprio: mensagem própria (depende de a janela de 30 dias ainda estar aberta).
        res.status(403).json({ error: await mensagemContaEncerrada(db, user.id), codigo: CODIGO_CONTA_ENCERRADA });
        return;
      }
      res.status(403).json({ error: MSG_CONTA_SUSPENSA, codigo: CODIGO_CONTA_SUSPENSA });
      return;
    }

    const accessToken = signAccessToken({ userId: user.id, username: user.username, role: user.role });
    const { token: refreshToken, jti: refreshJti } = signRefreshToken(user.id, user.username, user.role);
    setRefreshCookie(res, refreshToken);

    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await createSession(user.id, refreshJti, sessionExpiresAt,
      req.headers["user-agent"],
      (req.ip ?? "").slice(0, 45) || undefined, // req.ip respeita "trust proxy": não aceita o X-Forwarded-For forjado
    );

    const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(and(eq(followsTable.seguidoId, user.id), utilizadorAtivo(followsTable.seguidorId)));
    const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(and(eq(followsTable.seguidorId, user.id), utilizadorAtivo(followsTable.seguidoId)));
    const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.id, user.id));

    res.json({ token: accessToken, user: formatUser(user, posts || 0, seguidores || 0, seguindo || 0) });
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Login: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ── Recuperação e alteração da palavra-passe ────────────────────────────────────────────────────────────────
const MSG_RECUPERACAO = "Se existir uma conta com este email, enviámos as instruções.";
const MSG_TOKEN_INVALIDO = "Esta ligação é inválida ou expirou. Pede uma nova.";
const ROLES_ADMIN = new Set(["admin", "superadmin"]);

const esqueciSchema = z.object({ email: z.email("Email inválido").max(255) });
const redefinirSchema = z.object({ token: z.string().min(1, "Ligação inválida").max(200), password: passwordRegra });
const alterarSchema = z.object({ passwordAtual: z.string().min(1, "Indica a palavra-passe atual").max(128), novaPassword: passwordRegra });

/** Aviso «a tua palavra-passe foi alterada»: em segundo plano, nunca lança, e sem dados pessoais nos logs. */
function avisarPasswordAlterada(email: string): void {
  void (async () => {
    const cfg = lerConfigEmail();
    if (cfg.transporte !== "smtp" || cfg.faltam.length > 0) { logger.warn({ motivo: cfg.transporte !== "smtp" ? "desligado" : "configuracao_incompleta" }, "Palavra-passe alterada: o aviso por email não foi enviado"); return; }
    const m = emailPasswordAlterada();
    const r = await enviarEmail({ para: email, assunto: m.assunto, texto: m.texto, html: m.html });
    if (!r.ok) logger.warn({ motivo: r.motivo }, "Palavra-passe alterada: o aviso por email não foi enviado");
  })().catch(() => logger.warn({ motivo: "erro" }, "Palavra-passe alterada: o aviso por email não foi enviado"));
}

/** Trabalho do pedido de recuperação, DEPOIS de a resposta (sempre igual) ter sido enviada. Nunca lança. */
async function processarRecuperacao(emailN: string, ip: string): Promise<void> {
  const cfg = lerConfigEmail();
  if (cfg.transporte !== "smtp" || cfg.faltam.length > 0) {
    logger.warn({ motivo: cfg.transporte !== "smtp" ? "desligado" : "configuracao_incompleta" }, "Recuperação de palavra-passe: pedido recebido mas o envio de email não está disponível");
    return;
  }
  const [u] = await db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role, ativo: usersTable.ativo }).from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${emailN}`).orderBy(usersTable.id).limit(1);
  if (!u || !u.ativo) return;                                        // conta inexistente ou inativa: nada é enviado
  if (ROLES_ADMIN.has(u.role)) { logger.info({ motivo: "conta_de_administracao" }, "Recuperação de palavra-passe ignorada"); return; }   // admins: nada é enviado
  // Máximo 3 emails por endereço por hora, contado na BD (com um bloqueio por endereço para pedidos em paralelo).
  const token = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"recuperar:" + emailN}))`);
    if ((await pedidosNaUltimaHora(tx, u.email)) >= MAX_EMAILS_POR_ENDERECO_HORA) return null;
    return criarTokenRecuperacao(tx, { userId: u.id, email: u.email, ip });
  });
  if (!token) return;
  const ligacao = urlPublico(`/redefinir-password?token=${token}`);
  if (!ligacao) { logger.warn({ motivo: "configuracao_incompleta" }, "Recuperação de palavra-passe: sem APP_URL_PUBLICO"); return; }
  const m = emailRecuperacao(ligacao);
  const r = await enviarEmail({ para: u.email, assunto: m.assunto, texto: m.texto, html: m.html });
  if (!r.ok) logger.warn({ motivo: r.motivo }, "Recuperação de palavra-passe: o email não foi enviado");
}

router.post("/auth/esqueci-password", validate(esqueciSchema), (req, res): void => {
  // Resposta SEMPRE igual (202) e imediata: a existência da conta não se revela, nem pelo tempo. O trabalho corre depois.
  const emailN = normalizarEmailConta(req.body.email), ip = (req.ip ?? "").slice(0, 45);
  res.status(202).json({ mensagem: MSG_RECUPERACAO });
  setImmediate(() => { processarRecuperacao(emailN, ip).catch(() => logger.warn({ motivo: "erro" }, "Recuperação de palavra-passe: falha ao processar o pedido")); });
});

router.post("/auth/redefinir-password", validate(redefinirSchema), async (req, res): Promise<void> => {
  const { token, password } = req.body as { token: string; password: string };
  if (!tokenComFormato(token)) { res.status(400).json({ error: MSG_TOKEN_INVALIDO, codigo: "token_invalido" }); return; }
  try {
    const r = await db.transaction(async (tx) => {
      // Uso único e atómico: o UPDATE condicional só deixa passar UM pedido com este token (e só se não expirou).
      const userId = await consumirTokenRecuperacao(tx, token);
      if (userId === null) return null;
      const [u] = await tx.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role, ativo: usersTable.ativo }).from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
      if (!u || !u.ativo || ROLES_ADMIN.has(u.role)) return null;
      await tx.update(usersTable).set({ passwordHash: await hashPassword(password), passwordAlteradaEm: new Date(), passwordDefinida: true }).where(eq(usersTable.id, userId));
      await invalidarTokensRecuperacao(tx, userId);
      return { userId, email: u.email };
    });
    if (!r) { res.status(400).json({ error: MSG_TOKEN_INVALIDO, codigo: "token_invalido" }); return; }
    // Termina TODAS as sessões. Se isto falhar, a palavra-passe já mudou e os tokens antigos já caem pelo password_alterada_em.
    try { await terminarSessoesDaConta(r.userId); } catch { logger.warn({ motivo: "erro" }, "Redefinir palavra-passe: falha ao terminar as sessões (os tokens antigos caem pelo password_alterada_em)"); }
    avisarPasswordAlterada(r.email);
    res.json({ ok: true });   // não inicia sessão
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Redefinir palavra-passe: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ── Verificação de email (exigida para pedir para ser criador) ───────────────────────────────────────────────
// O endereço vem SEMPRE da conta (nunca do pedido). Token de finalidade «verificar_email»: nunca serve para redefinir a palavra-passe.
const confirmarEmailSchema = z.object({ token: z.string().min(1, "Ligação inválida").max(200) });
const MSG_ENVIO_EMAIL_INDISPONIVEL = "O envio de email está temporariamente indisponível. Tenta daqui a pouco.";

router.post("/auth/verificar-email/pedir", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [u] = await db.select({ id: usersTable.id, email: usersTable.email, ativo: usersTable.ativo, emailVerificadoEm: usersTable.emailVerificadoEm }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!u || !u.ativo) { res.status(401).json({ error: "Não autenticado" }); return; }
    if (u.emailVerificadoEm) { res.json({ jaVerificado: true }); return; }
    const cfg = lerConfigEmail();
    if (cfg.transporte !== "smtp" || cfg.faltam.length > 0 || !urlPublico("/verificar-email?token=x")) {
      logger.warn({ motivo: cfg.transporte !== "smtp" ? "desligado" : "configuracao_incompleta" }, "Verificação de email: pedido recebido mas o envio de email não está disponível");
      res.status(503).json({ error: MSG_ENVIO_EMAIL_INDISPONIVEL, codigo: "email_indisponivel" }); return;
    }
    // Máximo 3 por endereço por hora e intervalo mínimo entre reenvios, contados na BD (bloqueio por endereço para pedidos paralelos).
    const emailN = u.email.toLowerCase();
    const r = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"verificar:" + emailN}))`);
      if ((await verificacoesNaUltimaHora(tx, u.email)) >= MAX_EMAILS_POR_ENDERECO_HORA) return { erro: "limite_hora" as const };
      const espera = await segundosAteReenvio(tx, u.id);
      if (espera > 0) return { erro: "demasiado_cedo" as const, espera };
      return { token: await criarTokenVerificacao(tx, { userId: u.id, email: u.email, ip: (req.ip ?? "").slice(0, 45) }) };
    });
    if ("erro" in r) {
      if (r.erro === "limite_hora") { res.status(429).json({ error: "Já enviámos vários emails para este endereço. Tenta novamente dentro de uma hora.", codigo: "limite_hora" }); return; }
      res.setHeader("Retry-After", String(r.espera));
      res.status(429).json({ error: `Aguarda ${r.espera} segundos antes de pedir outro email.`, codigo: "demasiado_cedo", esperarSegundos: r.espera }); return;
    }
    const ligacao = urlPublico(`/verificar-email?token=${r.token}`)!;
    const m = emailVerificacao(ligacao);
    const env = await enviarEmail({ para: u.email, assunto: m.assunto, texto: m.texto, html: m.html });
    if (!env.ok) {
      await descartarToken(db, r.token).catch(() => {});   // o email não saiu: não conta para os limites
      logger.warn({ motivo: env.motivo }, "Verificação de email: o email não foi enviado");
      res.status(503).json({ error: MSG_ENVIO_EMAIL_INDISPONIVEL, codigo: "email_indisponivel" }); return;
    }
    res.status(202).json({ mensagem: "Enviámos um email de verificação. Abre a ligação para confirmar." });
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Verificar email (pedir): erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.post("/auth/verificar-email/confirmar", validate(confirmarEmailSchema), async (req, res): Promise<void> => {
  const { token } = req.body as { token: string };
  if (!tokenComFormato(token)) { res.status(400).json({ error: MSG_TOKEN_INVALIDO, codigo: "token_invalido" }); return; }
  try {
    const ok = await db.transaction(async (tx) => {
      // Uso único e atómico; só vale se o endereço do token ainda é o email atual da conta.
      const userId = await consumirTokenVerificacao(tx, token);
      if (userId === null) return false;
      const [u] = await tx.select({ id: usersTable.id, ativo: usersTable.ativo }).from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
      if (!u || !u.ativo) return false;
      await tx.update(usersTable).set({ emailVerificadoEm: sql`coalesce(${usersTable.emailVerificadoEm}, now())` }).where(eq(usersTable.id, userId));
      return true;
    });
    if (!ok) { res.status(400).json({ error: MSG_TOKEN_INVALIDO, codigo: "token_invalido" }); return; }
    res.json({ ok: true });   // não inicia sessão
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Verificar email (confirmar): erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.post("/auth/alterar-password", requireAuth, validate(alterarSchema), async (req: AuthRequest, res): Promise<void> => {
  const { passwordAtual, novaPassword } = req.body as { passwordAtual: string; novaPassword: string };
  try {
    const [u] = await db.select({ id: usersTable.id, email: usersTable.email, passwordHash: usersTable.passwordHash }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!u) { res.status(401).json({ error: "Não autenticado" }); return; }
    if (!(await comparePassword(passwordAtual, u.passwordHash))) { res.status(403).json({ error: "A palavra-passe atual está incorreta.", codigo: "password_incorreta" }); return; }
    if (novaPassword === passwordAtual) { res.status(400).json({ error: "A nova palavra-passe tem de ser diferente da atual.", codigo: "password_igual" }); return; }
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ passwordHash: await hashPassword(novaPassword), passwordAlteradaEm: new Date(), passwordDefinida: true }).where(eq(usersTable.id, u.id));
      await invalidarTokensRecuperacao(tx, u.id);
    });
    try { await terminarSessoesDaConta(u.id); } catch { logger.warn({ motivo: "erro" }, "Alterar palavra-passe: falha ao terminar as sessões (os tokens antigos caem pelo password_alterada_em)"); }
    avisarPasswordAlterada(u.email);
    res.json({ ok: true });   // a sessão atual também termina: a pessoa volta a entrar
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Alterar palavra-passe: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Logout não exige access token válido — aceita dois caminhos:
//   (a) access token presente e válido → revoga-o + revoga o refresh cookie
//   (b) access token ausente ou expirado → revoga apenas o refresh cookie
// Isto garante que um utilizador com o access token expirado (ou nenhum)
// consegue sempre invalidar o refresh token de 7 dias.
router.post("/auth/logout", async (req: AuthRequest, res): Promise<void> => {
  // Caminho (a): tentar revogar o access token se presente e válido
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const payload = verifyToken(authHeader.slice(7)) as JwtPayload;
      if (payload.type !== "refresh") {
        const expiresAt = payload.exp
          ? new Date(payload.exp * 1000)
          : new Date(Date.now() + 15 * 60 * 1000);
        await revokeToken(payload.jti, payload.userId, expiresAt);
      }
    } catch {
      // Token inválido ou expirado — ignorar; prosseguir com revogação do refresh
    }
  }

  // Caminho (b): revogar o refresh token do cookie (sempre, independente do access token)
  const refreshToken = (req as any).cookies?.[REFRESH_COOKIE];
  if (refreshToken) {
    try {
      const payload = verifyToken(refreshToken) as JwtPayload;
      if (payload.type === "refresh" && payload.jti) {
        const expiresAt = payload.exp
          ? new Date(payload.exp * 1000)
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await revokeToken(payload.jti, payload.userId, expiresAt);
        await deleteSession(payload.jti);
      }
    } catch (err) {
      (req as any).log?.warn(erroSeguro(err), "Logout: falha ao revogar refresh token");
    }
  }

  clearRefreshCookie(res);
  res.json({ ok: true });
});

// Revogar todas as sessões activas do utilizador ("logout de todos os dispositivos").
// Revoga cada refresh JTI em revoked_tokens e limpa a tabela active_sessions.
router.delete("/auth/sessions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const sessions = await deleteAllUserSessions(userId);

    if (sessions.length > 0) {
      await Promise.all(
        sessions.map(({ jti, expiresAt }) => revokeToken(jti, userId, expiresAt)),
      );
    }

    // Revogar também o access token actual para forçar re-autenticação imediata
    if (req.tokenJti && req.tokenExp) {
      await revokeToken(req.tokenJti, userId, new Date(req.tokenExp * 1000));
    }

    clearRefreshCookie(res);
    res.json({ ok: true, sessionsRevoked: sessions.length });
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Sessions: erro ao revogar todas as sessões");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const refreshToken = (req as any).cookies?.[REFRESH_COOKIE];
  if (!refreshToken) {
    res.status(401).json({ error: "Sessão expirada. Faz login novamente." });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(refreshToken);
  } catch {
    clearRefreshCookie(res);
    res.status(401).json({ error: "Sessão inválida. Faz login novamente." });
    return;
  }

  if (payload.type !== "refresh") {
    clearRefreshCookie(res);
    res.status(401).json({ error: "Token inválido." });
    return;
  }

  // Conta suspensa (ou inexistente): não renova a sessão. Falha de DB = negar (fail-closed).
  try {
    const [conta] = await db.select({ ativo: usersTable.ativo, encerradaEm: usersTable.encerradaEm, banidaEm: usersTable.banidaEm, passwordAlteradaEm: usersTable.passwordAlteradaEm }).from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
    if (!conta || emitidoAntesDaAlteracao(payload.iat, conta.passwordAlteradaEm)) {   // palavra-passe alterada depois de este refresh token ter sido emitido: sessão terminada
      clearRefreshCookie(res);
      res.status(401).json({ error: "Sessão inválida. Faz login novamente." });
      return;
    }
    if (!conta.ativo) {
      clearRefreshCookie(res);
      if (conta.banidaEm) {
        res.status(403).json({ error: MSG_CONTA_BANIDA, codigo: CODIGO_CONTA_ENCERRADA });
        return;
      }
      if (conta.encerradaEm) {
        res.status(403).json({ error: await mensagemContaEncerrada(db, payload.userId), codigo: CODIGO_CONTA_ENCERRADA });
        return;
      }
      res.status(403).json({ error: MSG_CONTA_SUSPENSA, codigo: CODIGO_CONTA_SUSPENSA });
      return;
    }
  } catch (err) {
    (req as any).log?.warn(erroSeguro(err), "Refresh: falha de DB ao verificar a conta — a negar (fail-closed)");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
    return;
  }

  // Rotação atómica: INSERT … ON CONFLICT DO NOTHING elimina a race condition.
  //
  // Dois pedidos simultâneos com o mesmo refresh token competem pelo mesmo JTI:
  //   • o Postgres garante que só um INSERT tem sucesso (constraint única em jti)
  //   • quem ganhou (inserted.length === 1) → revokeToken retorna true → emite novos tokens
  //   • quem perdeu (conflito)              → revokeToken retorna false → rejeitado com 401
  //
  // Qualquer falha de DB aborta o pedido — nunca emitir tokens sem revogar (fail-closed).
  let wasRevoked: boolean;
  try {
    const expiresAt = payload.exp
      ? new Date(payload.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    wasRevoked = await revokeToken(payload.jti, payload.userId, expiresAt);
  } catch (err) {
    (req as any).log?.warn(erroSeguro(err), "Refresh: falha de DB ao revogar token — a negar (fail-closed)");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
    return;
  }

  if (!wasRevoked) {
    // JTI já estava na tabela: token já foi consumido → possível replay
    clearRefreshCookie(res);
    res.status(401).json({ error: "Sessão terminada. Faz login novamente." });
    return;
  }

  const newAccessToken = signAccessToken({ userId: payload.userId, username: payload.username!, role: payload.role });
  const { token: newRefreshToken, jti: newRefreshJti } = signRefreshToken(payload.userId, payload.username!, payload.role);
  setRefreshCookie(res, newRefreshToken);

  // Rodar sessão: substituir o JTI antigo pelo novo
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await Promise.all([
    deleteSession(payload.jti),
    createSession(payload.userId, newRefreshJti, sessionExpiresAt,
      req.headers["user-agent"],
      (req.ip ?? "").slice(0, 45) || undefined,
    ),
  ]);

  res.json({ token: newAccessToken });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(401).json({ error: "Utilizador não encontrado" }); return; }

    const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(and(eq(followsTable.seguidoId, user.id), utilizadorAtivo(followsTable.seguidorId)));
    const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(and(eq(followsTable.seguidorId, user.id), utilizadorAtivo(followsTable.seguidoId)));

    res.json(formatUser(user, 0, seguidores || 0, seguindo || 0));
  } catch (err) {
    (req as any).log?.error(erroSeguro(err), "Auth/me: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

export function formatUser(user: any, totalPublicacoes: number, totalSeguidores: number, totalSeguindo: number) {
  return {
    id: user.id,
    username: user.username,
    nomeExibicao: user.nomeExibicao,
    bio: user.bio,
    avatarUrl: urlMedia(user.avatarUrl),
    capaUrl: urlMedia(user.capaUrl),
    link: linkSeguro(user.link),
    tipoConta: user.tipoConta,
    verificado: user.verificado,
    privado: user.privado,
    // Preferência de conteúdo +18 (só da própria conta): null = ainda não escolheu
    preferenciaMais18: user.preferenciaMais18 ?? null,
    preferenciaMais18Em: user.preferenciaMais18Em?.toISOString?.() ?? null,
    // Quem pode escrever-me (só da própria conta)
    quemPodeEscrever: user.quemPodeEscrever ?? "todos",
    // Email verificado (só da própria conta; o momento exato não se expõe)
    emailVerificado: !!user.emailVerificadoEm,
    // false = conta criada com o Google que ainda não definiu palavra-passe (só da própria conta)
    temPassword: user.passwordDefinida !== false,
    totalSeguidores,
    totalSeguindo,
    totalPublicacoes,
    estaASeguir: false,
    segueVoce: false,
    criadoEm: user.criadoEm?.toISOString?.() || new Date().toISOString(),
  };
}

export default router;
