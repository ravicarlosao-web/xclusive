/**
 * Verificação em dois passos (TOTP) dos admins — rotas ATRÁS do guard (requireAdmin): /api/admin/totp/* e a reposição por superadmin (A4a, só servidor).
 * Nenhuma resposta, auditoria ou registo leva o segredo, códigos ou chave (o segredo e os códigos de recuperação vão UMA vez, em respostas no-store).
 * Sem a chave ADMIN_TOTP_CHAVE (ou sem as tabelas) todas estas operações respondem 503 sem detalhes.
 */
import type { Router, Response } from "express";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import type { AdminRequest } from "../middlewares/requireAdmin.js";
import { signAdminToken, ADMIN_TOKEN_TTL_SEGUNDOS } from "../lib/auth.js";
import { chaveConta, chaveIp, segundosBloqueado, registarFalha } from "../lib/adminLogin.js";
import { resumirDispositivo } from "../lib/alertaLoginAdmin.js";
import { totpDisponivel, TotpIndisponivelError, TotpCifraError } from "../lib/totpCripto.js";
import { estadoTotp, totpAtivo, totpObrigatorio, iniciarAtivacao, confirmarAtivacao, verificarCodigoTotp, regenerarCodigos, removerTotp, TotpJaAtivoError } from "../lib/adminTotp.js";
import { avisarTotp } from "../lib/alertaTotpAdmin.js";


const INDISPONIVEL = { error: "Serviço temporariamente indisponível." };
const CODIGO_ERRADO = { error: "Código inválido ou expirado." };

export function registarRotasTotp(router: Router, deps: { auditLogin: (adminId: number, action: string, ip: string | undefined, details: Record<string, unknown>, alvoId?: number) => Promise<number> }): void {
  const { auditLogin } = deps;

  const naoGuardar = (res: Response) => res.setHeader("Cache-Control", "no-store");
  const dispositivoDe = (req: AdminRequest) => resumirDispositivo(req.headers["user-agent"]);
  const trataErro = (req: AdminRequest, res: Response, err: unknown): void => {
    const log = (req as any).log;
    if (err instanceof TotpIndisponivelError || err instanceof TotpCifraError) log?.error({ codigo: "totp_indisponivel" }, "operação TOTP de admin: indisponível (a negar)");
    else log?.error({ err: err instanceof Error ? err.name : "erro" }, "operação TOTP de admin: erro interno (a negar)");
    if (!res.headersSent) res.status(503).json(INDISPONIVEL);
  };
  const contaDe = async (id: number) => (await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1))[0];
  /** Conta (ou IP) bloqueada pelo A3: as operações sensíveis com credenciais respondem 429 como o login. */
  const bloqueado = async (user: { email: string }, req: AdminRequest, res: Response): Promise<boolean> => {
    const b = await segundosBloqueado(chaveConta(String(user.email).trim().toLowerCase()), chaveIp(req.ip));
    const s = Math.max(b.conta, b.ip);
    if (s > 0) { res.setHeader("Retry-After", String(s)); res.status(429).json({ error: "Demasiadas tentativas. Tente novamente mais tarde." }); return true; }
    return false;
  };
  /** Falha de credencial/código numa operação de TOTP: conta para o bloqueio A3 (conta e IP) e fica na auditoria. */
  const contarFalha = async (user: { id: number; email: string }, req: AdminRequest, operacao: string): Promise<void> => {
    const rc = await registarFalha("conta", chaveConta(String(user.email).trim().toLowerCase())), ri = await registarFalha("ip", chaveIp(req.ip));
    await auditLogin(user.id, "admin_totp_falhou", req.ip, { falhasSeguidas: rc.falhas, operacao });
    if (rc.bloqueouAgora) await auditLogin(user.id, "admin_login_bloqueado", req.ip, { escopo: "conta", minutos: rc.minutos, nivel: rc.nivel, origem: "totp" });
    if (ri.bloqueouAgora) await auditLogin(user.id, "admin_login_bloqueado", req.ip, { escopo: "ip", minutos: ri.minutos, nivel: ri.nivel, origem: "totp" });
  };
  /** Verifica palavra-passe (e, se pedido, código TOTP). Responde ao erro e devolve null; senão devolve a conta. */
  const credenciais = async (req: AdminRequest, res: Response, operacao: string, exigeCodigo: boolean): Promise<typeof usersTable.$inferSelect | null> => {
    const user = await contaDe(req.adminId!);
    if (!user) { res.status(401).json({ error: "Sessão terminada. Faz login novamente.", codigo: "sessao_terminada" }); return null; }
    if (await bloqueado(user, req, res)) return null;
    const { password, codigo } = req.body ?? {};
    if (typeof password !== "string" || password === "" || (exigeCodigo && (typeof codigo !== "string" && typeof codigo !== "number"))) { res.status(400).json({ error: "Pedido inválido." }); return null; }
    if (!(await bcrypt.compare(password, user.passwordHash))) { await contarFalha(user, req, operacao); res.status(401).json({ error: "Palavra-passe incorreta." }); return null; }
    if (exigeCodigo && !(await verificarCodigoTotp(user.id, codigo))) { await contarFalha(user, req, operacao); res.status(401).json(CODIGO_ERRADO); return null; }
    return user;
  };

  router.get("/admin/totp/estado", async (req: AdminRequest, res): Promise<void> => {
    try {
      if (!totpDisponivel()) { res.status(503).json(INDISPONIVEL); return; }
      naoGuardar(res);
      res.json({ ...(await estadoTotp(req.adminId!)), obrigatorio: await totpObrigatorio(), disponivel: totpDisponivel() });
    } catch (err) { trataErro(req, res, err); }
  });

  router.post("/admin/totp/iniciar", async (req: AdminRequest, res): Promise<void> => {
    try {
      if (!totpDisponivel()) { res.status(503).json(INDISPONIVEL); return; }
      const user = await credenciais(req, res, "iniciar", false); if (!user) return;
      if (await totpAtivo(user.id)) { res.status(409).json({ error: "A verificação em dois passos já está ativa.", codigo: "totp_ja_ativo" }); return; }
      const r = await iniciarAtivacao(user.id, user.email);
      await auditLogin(user.id, "admin_totp_ativacao_iniciada", req.ip, { dispositivo: dispositivoDe(req) });
      naoGuardar(res);
      res.json(r);
    } catch (err) {
      if (err instanceof TotpJaAtivoError) { res.status(409).json({ error: "A verificação em dois passos já está ativa.", codigo: "totp_ja_ativo" }); return; }
      trataErro(req, res, err);
    }
  });

  router.post("/admin/totp/confirmar", async (req: AdminRequest, res): Promise<void> => {
    try {
      if (!totpDisponivel()) { res.status(503).json(INDISPONIVEL); return; }
      const user = await contaDe(req.adminId!);
      if (!user) { res.status(401).json({ error: "Sessão terminada. Faz login novamente.", codigo: "sessao_terminada" }); return; }
      if (await bloqueado(user, req, res)) return;
      const r = await confirmarAtivacao(user.id, req.body?.codigo);
      if (!r.ok) {
        if (r.motivo === "codigo_invalido") await contarFalha(user, req, "confirmar");
        res.status(r.motivo === "codigo_invalido" ? 401 : 409).json(r.motivo === "codigo_invalido" ? CODIGO_ERRADO : { error: "Sem ativação em curso (ou expirada). Começa de novo.", codigo: "ativacao_expirada" });
        return;
      }
      // A ativação muda a sessão: as outras sessões desta conta terminam e a atual é substituída por uma com a marca «mfa» (o código acabou de ser provado).
      const { token, jti } = signAdminToken({ userId: user.id, username: user.username, role: user.role, mfa: true });
      await db.execute(sql`delete from admin_sessoes where user_id = ${user.id}`);
      await db.execute(sql`insert into admin_sessoes (jti, user_id, expira_em) values (${jti}, ${user.id}, now() + make_interval(secs => ${ADMIN_TOKEN_TTL_SEGUNDOS}))`);
      const dispositivo = dispositivoDe(req);
      await auditLogin(user.id, "admin_totp_ativado", req.ip, { dispositivo });
      naoGuardar(res);
      res.json({ ok: true, codigosRecuperacao: r.codigos, token, expiresIn: ADMIN_TOKEN_TTL_SEGUNDOS });
      void avisarTotp({ adminId: user.id, email: user.email, evento: "ativado", ip: req.ip, dispositivo }).catch(() => {});
    } catch (err) { trataErro(req, res, err); }
  });

  router.post("/admin/totp/desativar", async (req: AdminRequest, res): Promise<void> => {
    try {
      if (!totpDisponivel()) { res.status(503).json(INDISPONIVEL); return; }
      if (await totpObrigatorio()) { res.status(403).json({ error: "A verificação em dois passos é obrigatória e não se pode desativar.", codigo: "totp_obrigatorio" }); return; }
      const user = await credenciais(req, res, "desativar", true); if (!user) return;
      await removerTotp(user.id, false);
      const dispositivo = dispositivoDe(req);
      await auditLogin(user.id, "admin_totp_desativado", req.ip, { dispositivo });
      res.json({ ok: true });
      void avisarTotp({ adminId: user.id, email: user.email, evento: "desativado", ip: req.ip, dispositivo }).catch(() => {});
    } catch (err) { trataErro(req, res, err); }
  });

  router.post("/admin/totp/codigos-recuperacao", async (req: AdminRequest, res): Promise<void> => {
    try {
      if (!totpDisponivel()) { res.status(503).json(INDISPONIVEL); return; }
      const user = await contaDe(req.adminId!);
      if (!user) { res.status(401).json({ error: "Sessão terminada. Faz login novamente.", codigo: "sessao_terminada" }); return; }
      if (await bloqueado(user, req, res)) return;
      if (!(await totpAtivo(user.id))) { res.status(409).json({ error: "A verificação em dois passos não está ativa.", codigo: "totp_inativo" }); return; }
      if (!(await verificarCodigoTotp(user.id, req.body?.codigo))) { await contarFalha(user, req, "regenerar"); res.status(401).json(CODIGO_ERRADO); return; }
      const codigos = await regenerarCodigos(user.id);
      await auditLogin(user.id, "admin_totp_codigos_regenerados", req.ip, { dispositivo: dispositivoDe(req) });
      naoGuardar(res);
      res.json({ ok: true, codigosRecuperacao: codigos });
    } catch (err) { trataErro(req, res, err); }
  });

  // Reposição de emergência por um SUPERADMIN: só contas «admin» (nunca superadmin nem a própria), com o código TOTP do superadmin NESSE momento.
  router.post("/admin/administradores/:id/totp/repor", async (req: AdminRequest, res): Promise<void> => {
    try {
      if (req.adminRole !== "superadmin") { res.status(403).json({ error: "Apenas o superadmin pode repor a verificação em dois passos de um admin." }); return; }
      if (!totpDisponivel()) { res.status(503).json(INDISPONIVEL); return; }
      const alvoId = Number(req.params.id);
      if (!Number.isInteger(alvoId) || alvoId <= 0) { res.status(400).json({ error: "Identificador inválido." }); return; }
      if (alvoId === req.adminId) { res.status(403).json({ error: "Não podes repor a tua própria verificação em dois passos (usa o script no servidor).", codigo: "alvo_proprio" }); return; }
      const eu = await contaDe(req.adminId!);
      if (!eu) { res.status(401).json({ error: "Sessão terminada. Faz login novamente.", codigo: "sessao_terminada" }); return; }
      if (await bloqueado(eu, req, res)) return;
      if (!(await totpAtivo(eu.id))) { res.status(403).json({ error: "Ativa a tua verificação em dois passos para poderes repor a de outro admin.", codigo: "totp_necessario" }); return; }
      const alvo = await contaDe(alvoId);
      if (!alvo) { res.status(404).json({ error: "Administrador não encontrado." }); return; }
      if (alvo.role !== "admin") { res.status(403).json({ error: "Só se repõe a verificação de contas «admin».", codigo: "alvo_superadmin" }); return; }
      if (!(await verificarCodigoTotp(eu.id, req.body?.codigo))) { await contarFalha(eu, req, "repor"); res.status(401).json(CODIGO_ERRADO); return; }
      const tinha = await removerTotp(alvo.id, true);
      if (!tinha) { res.status(409).json({ error: "Este admin não tem verificação em dois passos ativa.", codigo: "totp_inativo" }); return; }
      const dispositivo = dispositivoDe(req);
      await auditLogin(eu.id, "admin_totp_reposto_por_superadmin", req.ip, { alvoId: alvo.id, dispositivo }, alvo.id);
      res.json({ ok: true });
      void avisarTotp({ adminId: alvo.id, email: alvo.email, evento: "reposto", ip: req.ip, dispositivo }).catch(() => {});
    } catch (err) { trataErro(req, res, err); }
  });
}
