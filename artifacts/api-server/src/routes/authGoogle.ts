/**
 * Login e criação de conta com o Google («Continuar com o Google»). Ver lib/googleIdToken.ts para a validação do ID token.
 *
 * REGRAS (decididas com o dono):
 *  - Sem GOOGLE_CLIENT_ID tudo isto está desligado: nonce, google, completar, ligar, desligar e estado respondem 404 (sem cookies); config devolve { clientId: null }.
 *  - A identidade é o `sub` da Google. NUNCA se liga uma conta pelo email: um email do Google que já existe em `users` recebe 409 `conta_existente`
 *    (a pessoa entra com a palavra-passe e liga o Google em Definições, com sessão: POST /auth/google/ligar).
 *  - O Google NÃO abre registo: conta inexistente = o mesmo gate do registo normal (registos fechados → 403, sem bilhete e sem nada criado; leitura falhada → 503).
 *  - Admins (admin | superadmin) ficam excluídos: nunca entram, nunca se ligam, nunca se criam por aqui.
 *  - Banidos, suspensos e encerrados passam pelos mesmos controlos e mensagens do login normal; a sessão é emitida exatamente como no login normal.
 *  - Nunca se escreve em logs o ID token, o `sub` ou o email.
 *
 * NONCE (login CSRF e repetição de tokens): POST /auth/google/nonce põe um cookie httpOnly com um valor aleatório R e devolve H = base64url(sha256(R)). O front passa H à Google;
 * o ID token traz `nonce = H`. O servidor recalcula H a partir do cookie, compara e APAGA o cookie (uso único). Um token roubado não serve noutro browser.
 *
 * BILHETE da criação de conta (passo 1 → passo 2, sem estado no servidor): quando a conta não existe e os registos estão abertos, o passo 1 assina um bilhete com o `sub`, o email e o nome
 * que vieram de um ID token JÁ VERIFICADO e entrega-o num cookie httpOnly (o JavaScript do site nunca o vê). O passo 2 (/completar) lê `sub` e email SÓ do bilhete, nunca do corpo (um corpo
 * com esses campos é recusado). É seguro porque: (1) é assinado com uma chave derivada do segredo do servidor e com `aud` próprio, por isso não se forja nem se altera, e não serve como token de
 * sessão (nem o contrário); (2) expira em 10 minutos; (3) está preso ao browser (cookie httpOnly, SameSite=Strict); (4) tudo o que pode mudar volta a ser verificado no passo 2 (gate dos registos
 * dentro da transação, email banido ou já usado, username, idade, aceite); (5) uma segunda utilização falha nas restrições UNIQUE da base de dados (email em users e google_sub), por isso o
 * mesmo bilhete nunca cria duas contas.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, followsTable, userLegalAcceptancesTable, userGoogleIdentitiesTable } from "@workspace/db";
import { signAccessToken, signRefreshToken, createSession, hashPassword, requireAuth, type AuthRequest } from "../lib/auth";
import { MSG_CONTA_SUSPENSA, CODIGO_CONTA_SUSPENSA } from "../lib/suspensao";
import { lerRegistosAbertos, lerRegistosAbertosBloqueando, RegistosFechadosError, MSG_REGISTOS_FECHADOS, CODIGO_REGISTOS_FECHADOS } from "../lib/registos";
import { MSG_CONTA_BANIDA, identificadorBloqueado } from "../lib/banimento";
import { mensagemContaEncerrada, CODIGO_CONTA_ENCERRADA, utilizadorAtivo } from "../lib/encerramento";
import { erroSeguro } from "../lib/erroSeguro";
import { validate } from "../lib/validate";
import { googleClientId, verificarIdToken, GoogleTokenInvalido, GoogleIndisponivel, type IdentidadeGoogle } from "../lib/googleIdToken";
import {
  LEGAL_DOCS, validarDataNascimento, registerSchema, setRefreshCookie, formatUser, normalizarEmailConta, violacaoUnica,
  MSG_USERNAME_EM_USO, CODIGO_USERNAME_EM_USO, MSG_EMAIL_INDISPONIVEL, CODIGO_EMAIL_INDISPONIVEL,
} from "./auth";

const router = Router();

const NONCE_COOKIE = "xg_nonce";
const BILHETE_COOKIE = "xg_bilhete";
const NONCE_MS = 5 * 60 * 1000;
const BILHETE_S = 10 * 60;
const BILHETE_AUD = "xclusive:google-registo";
const ROLES_ADMIN = new Set(["admin", "superadmin"]);

const MSG_GOOGLE_INVALIDO = "Não foi possível iniciar sessão com o Google.";
const MSG_GOOGLE_EMAIL_NAO_VERIFICADO = "O email desta conta Google não está verificado.";
const MSG_CONTA_EXISTENTE = "Já existe uma conta com este email. Entra com a tua palavra-passe e liga o Google em Definições.";
const MSG_GOOGLE_JA_LIGADO = "Esta conta Google já está ligada a uma conta.";
const MSG_INDISPONIVEL = "Serviço temporariamente indisponível.";

/** Opções dos cookies auxiliares: as mesmas do cookie de sessão (httpOnly, Secure fora de desenvolvimento, SameSite=Strict, path /api/auth). */
const opcoesCookie = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV !== "development", sameSite: "strict" as const, path: "/api/auth", maxAge });
const apagarCookie = (res: Response, nome: string) => res.clearCookie(nome, { ...opcoesCookie(0), maxAge: 0 });

/** Sem GOOGLE_CLIENT_ID: 404 sem cookies (antes de qualquer outra coisa). */
function exigirGoogle(_req: Request, res: Response, next: NextFunction): void {
  if (!googleClientId()) { res.status(404).json({ error: "Não encontrado" }); return; }
  next();
}

const hNonce = (r: string) => createHash("sha256").update(r).digest("base64url");

function chaveBilhete(): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "").update("xclusive/google-registo/v1").digest("hex");
}
function assinarBilhete(i: IdentidadeGoogle): string {
  return jwt.sign({ sub: i.sub, email: i.email, nome: i.nome }, chaveBilhete(), { algorithm: "HS256", audience: BILHETE_AUD, expiresIn: BILHETE_S, jwtid: randomBytes(12).toString("hex") });
}
function lerBilhete(raw: unknown): { sub: string; email: string; nome: string | null } | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const p = jwt.verify(raw, chaveBilhete(), { algorithms: ["HS256"], audience: BILHETE_AUD }) as jwt.JwtPayload;
    if (typeof p.sub !== "string" || !p.sub || typeof p.email !== "string" || !p.email) return null;
    return { sub: p.sub, email: p.email, nome: typeof p.nome === "string" ? p.nome : null };
  } catch { return null; }
}

/**
 * Verifica credencial + nonce (cookie de uso único). Responde ao pedido em caso de falha e devolve null.
 * Uma credencial da Google recusada (inválida, expirada, nonce errado, email por verificar, conta de admin) é 400, NUNCA 401: o 401 é só «sem sessão»
 * (requireAuth em /ligar), e o cliente trata qualquer 401 como sessão expirada e tenta renovar a sessão (POST /auth/refresh), o que aqui não faz sentido.
 */
async function verificarCredencial(req: Request, res: Response, credential: string): Promise<IdentidadeGoogle | null> {
  const r = (req as Request & { cookies?: Record<string, unknown> }).cookies?.[NONCE_COOKIE];
  apagarCookie(res, NONCE_COOKIE);   // uso único, venha o que vier
  const clientId = googleClientId()!;
  if (typeof r !== "string" || !r || r.length > 200) {
    res.status(400).json({ error: MSG_GOOGLE_INVALIDO, codigo: "google_invalido" });
    return null;
  }
  let id: IdentidadeGoogle;
  try {
    id = await verificarIdToken(credential, clientId);
  } catch (err) {
    if (err instanceof GoogleIndisponivel) {
      (req as { log?: { warn: (o: object, m: string) => void } }).log?.warn({ motivo: err.message }, "Login Google: chaves da Google indisponíveis");
      res.status(503).json({ error: MSG_INDISPONIVEL });
      return null;
    }
    const inv = err instanceof GoogleTokenInvalido ? err : null;
    (req as { log?: { info: (o: object, m: string) => void } }).log?.info({ motivo: inv?.motivo ?? "erro" }, "Login Google: token recusado");
    if (inv?.emailNaoVerificado) res.status(400).json({ error: MSG_GOOGLE_EMAIL_NAO_VERIFICADO, codigo: "google_email_nao_verificado" });
    else res.status(400).json({ error: MSG_GOOGLE_INVALIDO, codigo: "google_invalido" });
    return null;
  }
  const esperado = Buffer.from(hNonce(r)), recebido = Buffer.from(id.nonce ?? "");
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
    res.status(400).json({ error: MSG_GOOGLE_INVALIDO, codigo: "google_invalido" });
    return null;
  }
  return id;
}

/** Sessão IDÊNTICA à do login normal: mesmos tokens, mesmo cookie de refresh, mesma linha em active_sessions, mesma resposta { token, user }. */
async function emitirSessao(req: Request, res: Response, user: typeof usersTable.$inferSelect, estado: 200 | 201): Promise<void> {
  const accessToken = signAccessToken({ userId: user.id, username: user.username, role: user.role });
  const { token: refreshToken, jti: refreshJti } = signRefreshToken(user.id, user.username, user.role);
  setRefreshCookie(res, refreshToken);
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await createSession(user.id, refreshJti, sessionExpiresAt, req.headers["user-agent"], (req.ip ?? "").slice(0, 45) || undefined);
  const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(and(eq(followsTable.seguidoId, user.id), utilizadorAtivo(followsTable.seguidorId)));
  const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(and(eq(followsTable.seguidorId, user.id), utilizadorAtivo(followsTable.seguidoId)));
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.id, user.id));   // igual ao login normal
  res.status(estado).json({ token: accessToken, user: formatUser(user, posts || 0, seguidores || 0, seguindo || 0) });
}

// ── Configuração pública ─────────────────────────────────────────────────────────────────────────
router.get("/auth/google/config", (_req, res): void => {
  res.set("Cache-Control", "no-store");
  res.json({ clientId: googleClientId() });   // null = o front não mostra o botão
});

// ── Nonce ───────────────────────────────────────────────────────────────────────────────────────
router.post("/auth/google/nonce", exigirGoogle, (_req, res): void => {
  const r = randomBytes(32).toString("base64url");
  res.cookie(NONCE_COOKIE, r, opcoesCookie(NONCE_MS));
  res.set("Cache-Control", "no-store");
  res.json({ nonce: hNonce(r) });
});

const credencialSchema = z.object({ credential: z.string().min(20).max(4096) });

// ── Entrar ──────────────────────────────────────────────────────────────────────────────────────
router.post("/auth/google", exigirGoogle, validate(credencialSchema), async (req, res): Promise<void> => {
  try {
    const id = await verificarCredencial(req, res, req.body.credential);
    if (!id) return;

    const [lig] = await db.select({ u: usersTable }).from(userGoogleIdentitiesTable)
      .innerJoin(usersTable, eq(userGoogleIdentitiesTable.userId, usersTable.id))
      .where(eq(userGoogleIdentitiesTable.googleSub, id.sub)).limit(1);

    if (lig) {
      const user = lig.u;
      // Admins ficam excluídos: resposta genérica, sem token nem sessão.
      if (ROLES_ADMIN.has(user.role)) { res.status(400).json({ error: MSG_GOOGLE_INVALIDO, codigo: "google_invalido" }); return; }
      // Mesmos controlos e mensagens do login normal (a identidade está provada pelo Google, por isso o estado da conta pode ser dito).
      if (!user.ativo) {
        if (user.banidaEm) { res.status(403).json({ error: MSG_CONTA_BANIDA, codigo: CODIGO_CONTA_ENCERRADA }); return; }
        if (user.encerradaEm) { res.status(403).json({ error: await mensagemContaEncerrada(db, user.id), codigo: CODIGO_CONTA_ENCERRADA }); return; }
        res.status(403).json({ error: MSG_CONTA_SUSPENSA, codigo: CODIGO_CONTA_SUSPENSA });
        return;
      }
      await db.update(userGoogleIdentitiesTable).set({ ultimoLoginEm: new Date() }).where(eq(userGoogleIdentitiesTable.googleSub, id.sub));
      await emitirSessao(req, res, user, 200);
      return;
    }

    // Sem ligação. 1) email banido: recusa genérica (a mesma do registo, não revela o banimento).
    if (await identificadorBloqueado(db, "email", id.email)) { res.status(409).json({ error: MSG_EMAIL_INDISPONIVEL, codigo: CODIGO_EMAIL_INDISPONIVEL }); return; }
    // 2) email já existe: NUNCA se liga por aqui (pre-hijack). A pessoa provou ser dona do email (Google), por isso dizê-lo não revela nada a terceiros.
    const [existente] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.email}) = ${id.email}`).limit(1);
    if (existente) { res.status(409).json({ error: MSG_CONTA_EXISTENTE, codigo: "conta_existente" }); return; }
    // 3) conta nova: o MESMO gate do registo (fechado = recusa sem bilhete; leitura falhada = negar).
    let abertos: boolean;
    try { abertos = await lerRegistosAbertos(); } catch (err) {
      (req as { log?: { warn: (o: object, m: string) => void } }).log?.warn(erroSeguro(err), "Login Google: falha ao ler o estado dos registos — a negar (fail-closed)");
      res.status(503).json({ error: MSG_INDISPONIVEL });
      return;
    }
    if (!abertos) { res.status(403).json({ error: MSG_REGISTOS_FECHADOS, codigo: CODIGO_REGISTOS_FECHADOS }); return; }
    res.cookie(BILHETE_COOKIE, assinarBilhete(id), opcoesCookie(BILHETE_S * 1000));
    res.json({ precisaCompletar: true, nome: id.nome });
  } catch (err) {
    (req as { log?: { error: (o: object, m: string) => void } }).log?.error(erroSeguro(err), "Login Google: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ── Criar conta (passo 2) ─────────────────────────────────────────────────────────────────────────
const completarSchema = z.object({
  username: registerSchema.shape.username,
  dataNascimento: registerSchema.shape.dataNascimento,
  aceite: registerSchema.shape.aceite,
  tipoConta: registerSchema.shape.tipoConta,
}).strict();   // `sub`, `email` ou qualquer outro campo no corpo = 400: a identidade vem SÓ do bilhete

router.post("/auth/google/completar", exigirGoogle, validate(completarSchema), async (req, res): Promise<void> => {
  const { username, dataNascimento, tipoConta, aceite } = req.body as z.infer<typeof completarSchema>;
  const bilhete = lerBilhete((req as Request & { cookies?: Record<string, unknown> }).cookies?.[BILHETE_COOKIE]);
  if (!bilhete) { res.status(400).json({ error: "A sessão de registo com o Google expirou. Volta a escolher «Continuar com o Google».", codigo: "bilhete_invalido" }); return; }

  try {
    try {
      if (!(await lerRegistosAbertos())) { res.status(403).json({ error: MSG_REGISTOS_FECHADOS, codigo: CODIGO_REGISTOS_FECHADOS }); return; }
    } catch (err) {
      (req as { log?: { warn: (o: object, m: string) => void } }).log?.warn(erroSeguro(err), "Google completar: falha ao ler o estado dos registos — a negar (fail-closed)");
      res.status(503).json({ error: MSG_INDISPONIVEL });
      return;
    }
    const erroData = validarDataNascimento(dataNascimento);
    if (erroData) { res.status(400).json({ error: erroData }); return; }
    if (
      aceite.termos !== LEGAL_DOCS.termos.versao || aceite.privacidade !== LEGAL_DOCS.privacidade.versao || aceite.conteudo !== LEGAL_DOCS.conteudo.versao ||
      aceite.direitosAutor !== LEGAL_DOCS.direitosAutor.versao || aceite.reembolsos !== LEGAL_DOCS.reembolsos.versao
    ) { res.status(400).json({ error: "Os documentos legais foram atualizados. Recarrega a página e aceita as versões atuais." }); return; }

    const usernameN = username.toLowerCase();
    const emailN = normalizarEmailConta(bilhete.email);
    const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${usernameN}`).limit(1);
    if (existingUsername) { res.status(409).json({ error: MSG_USERNAME_EM_USO, codigo: CODIGO_USERNAME_EM_USO }); return; }
    const emailBanido = await identificadorBloqueado(db, "email", emailN);
    const [existing] = emailBanido ? [undefined] : await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.email}) = ${emailN}`).limit(1);
    if (emailBanido || existing) { res.status(409).json({ error: MSG_EMAIL_INDISPONIVEL, codigo: CODIGO_EMAIL_INDISPONIVEL }); return; }

    // Hash bcrypt de 32 bytes aleatórios, único por conta e que ninguém conhece: o login por palavra-passe falha sempre até a pessoa definir uma.
    const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
    const aceiteIp = (req.ip ?? "").slice(0, 45) || null;
    const uaHeader = req.headers["user-agent"];
    const aceiteUserAgent = (typeof uaHeader === "string" ? uaHeader : "").slice(0, 400) || null;
    const nomeBase = (bilhete.nome ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

    const user = await db.transaction(async (tx) => {
      if (!(await lerRegistosAbertosBloqueando(tx))) throw new RegistosFechadosError();
      const [created] = await tx.insert(usersTable).values({
        nomeExibicao: nomeBase.length >= 2 ? nomeBase : usernameN,
        email: emailN,
        username: usernameN,
        passwordHash,
        passwordDefinida: false,
        dataNascimento,
        tipoConta: tipoConta || "pessoal",
        emailVerificadoEm: new Date(),   // a Google verificou a caixa de correio
      }).returning();
      await tx.insert(userLegalAcceptancesTable).values({
        userId: created.id, termosVersao: aceite.termos, privacidadeVersao: aceite.privacidade, conteudoVersao: aceite.conteudo,
        direitosAutorVersao: aceite.direitosAutor, reembolsosVersao: aceite.reembolsos, cookiesAceites: true,
        ip: aceiteIp, userAgent: aceiteUserAgent, maioridadeConfirmada: true, origem: "registo_google",
      });
      // UNIQUE(google_sub) e UNIQUE(user_id): a rede de segurança que impede o mesmo bilhete (ou o mesmo sub) de criar duas contas.
      await tx.insert(userGoogleIdentitiesTable).values({ userId: created.id, googleSub: bilhete.sub, emailGoogle: emailN, ultimoLoginEm: new Date() });
      return created;
    });
    apagarCookie(res, BILHETE_COOKIE);
    await emitirSessao(req, res, user, 201);
  } catch (err) {
    if (err instanceof RegistosFechadosError) { res.status(403).json({ error: MSG_REGISTOS_FECHADOS, codigo: CODIGO_REGISTOS_FECHADOS }); return; }
    const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
    const constraint = (e?.constraint ?? e?.cause?.constraint ?? "").toLowerCase();
    if ((e?.code ?? e?.cause?.code) === "23505" && constraint.includes("google")) { res.status(409).json({ error: MSG_GOOGLE_JA_LIGADO, codigo: "google_ja_ligado" }); return; }
    const dup = violacaoUnica(err);
    if (dup === "username") { res.status(409).json({ error: MSG_USERNAME_EM_USO, codigo: CODIGO_USERNAME_EM_USO }); return; }
    if (dup === "email") { res.status(409).json({ error: MSG_EMAIL_INDISPONIVEL, codigo: CODIGO_EMAIL_INDISPONIVEL }); return; }
    (req as { log?: { error: (o: object, m: string) => void } }).log?.error(erroSeguro(err), "Google completar: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

// ── Ligar / desligar / estado (com sessão) ───────────────────────────────────────────────────────
router.post("/auth/google/ligar", exigirGoogle, requireAuth, validate(credencialSchema), async (req: AuthRequest, res): Promise<void> => {
  try {
    const id = await verificarCredencial(req, res, req.body.credential);
    if (!id) return;
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!u) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }
    if (ROLES_ADMIN.has(u.role)) { res.status(403).json({ error: "Não disponível para esta conta." }); return; }
    const [jaTem] = await db.select({ id: userGoogleIdentitiesTable.id }).from(userGoogleIdentitiesTable).where(eq(userGoogleIdentitiesTable.userId, u.id)).limit(1);
    if (jaTem) { res.status(409).json({ error: "Esta conta já tem uma conta Google ligada.", codigo: "ja_ligado" }); return; }
    // Email igual ao da conta e verificado pela Google: prova de que a caixa de correio é desta pessoa → email verificado (só se ainda não estava).
    const igualEmail = id.email === normalizarEmailConta(u.email);
    await db.transaction(async (tx) => {
      await tx.insert(userGoogleIdentitiesTable).values({ userId: u.id, googleSub: id.sub, emailGoogle: id.email, ultimoLoginEm: new Date() });
      if (igualEmail && !u.emailVerificadoEm) await tx.update(usersTable).set({ emailVerificadoEm: new Date() }).where(eq(usersTable.id, u.id));
    });
    res.json({ ok: true, emailVerificado: !!u.emailVerificadoEm || igualEmail });
  } catch (err) {
    const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
    if ((e?.code ?? e?.cause?.code) === "23505") { res.status(409).json({ error: MSG_GOOGLE_JA_LIGADO, codigo: "google_ja_ligado" }); return; }
    (req as { log?: { error: (o: object, m: string) => void } }).log?.error(erroSeguro(err), "Google ligar: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.delete("/auth/google", exigirGoogle, requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [u] = await db.select({ id: usersTable.id, passwordDefinida: usersTable.passwordDefinida }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!u) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }
    const [lig] = await db.select({ id: userGoogleIdentitiesTable.id }).from(userGoogleIdentitiesTable).where(eq(userGoogleIdentitiesTable.userId, u.id)).limit(1);
    if (!lig) { res.status(404).json({ error: "Não há nenhuma conta Google ligada." }); return; }
    // Sem palavra-passe definida, desligar deixava a conta sem forma de entrar.
    if (!u.passwordDefinida) { res.status(409).json({ error: "Define uma palavra-passe antes de desligar o Google.", codigo: "sem_password" }); return; }
    await db.delete(userGoogleIdentitiesTable).where(eq(userGoogleIdentitiesTable.userId, u.id));
    res.json({ ok: true });
  } catch (err) {
    (req as { log?: { error: (o: object, m: string) => void } }).log?.error(erroSeguro(err), "Google desligar: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/auth/google/estado", exigirGoogle, requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [lig] = await db.select({ email: userGoogleIdentitiesTable.emailGoogle }).from(userGoogleIdentitiesTable).where(eq(userGoogleIdentitiesTable.userId, req.userId!)).limit(1);
    res.set("Cache-Control", "no-store");
    res.json({ ligado: !!lig, email: lig?.email ?? null });
  } catch (err) {
    (req as { log?: { error: (o: object, m: string) => void } }).log?.error(erroSeguro(err), "Google estado: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
