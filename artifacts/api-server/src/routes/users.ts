import { Router } from "express";
import { db, usersTable, userMais18ChoicesTable, followsTable, postsTable, notificationsTable, postMediaTable, likesTable, commentsTable, kycSubmissionsTable } from "@workspace/db";
import { eq, and, ne, sql, not, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { createStorageKey, deletePrivate, getMissingPrivateStorageEnv, isPrivateStorageConfigured, resolveMediaUrl, uploadPrivate, urlMedia, urlAvatarOuCapa } from "../lib/storage";
import { temAcessoExclusivo } from "../lib/exclusiveAccess";
import { postVisivel } from "../lib/takedown";
import rateLimit from "express-rate-limit";
import { MAIS18_TEXTO_VERSAO, PREFERENCIAS_MAIS18, IDADE_MINIMA_VER, idadeEmAnos } from "../lib/mais18";

const updateProfileSchema = z.object({
  nomeExibicao: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  link: z.union([z.url().max(500), z.literal("")]).optional(),
  avatarUrl: z.union([z.url().max(1000), z.literal("")]).optional(),
  capaUrl: z.union([z.url().max(1000), z.literal("")]).optional(),
  // tipoConta é intencionalmente excluído — a mudança pessoal→criador requer KYC
  // via POST /users/me/tornar-criador
  privado: z.boolean().optional(),
});

const kycSubmissionSchema = z.object({
  nomeCompleto: z.string().min(3).max(150),
  dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  tipoDocumento: z.enum(["bi", "passaporte", "carta"]),
  numeroDocumento: z.string().min(3).max(50),
  paisEmissao: z.string().min(1).max(100),
  // As fotos chegam como data URLs capturados pela câmara.
  documentoFoto: z.string().min(1),
  selfieFoto: z.string().min(1),
  livenessFoto: z.string().min(1),
});

const router = Router();

/**
 * Verifica se o viewer tem acesso ao conteúdo de uma conta privada.
 * Retorna true se: conta é pública, viewer é o dono, ou viewer segue a conta.
 * Nota: estaASeguir já calculado na rota de perfil — passa-o directamente.
 * Para rotas que ainda não calcularam, usa checkFollow=true para fazer a query.
 */
async function canViewPrivateContent(
  user: { id: number; privado: boolean | null },
  viewerId: number | undefined,
  estaASeguirPrecomputed?: boolean,
): Promise<boolean> {
  if (!user.privado) return true;
  if (viewerId === user.id) return true;
  if (estaASeguirPrecomputed !== undefined) return estaASeguirPrecomputed;
  if (!viewerId) return false;
  const [follow] = await db
    .select()
    .from(followsTable)
    .where(and(eq(followsTable.seguidorId, viewerId), eq(followsTable.seguidoId, user.id)));
  return !!follow;
}

// Sugestões de utilizadores para seguir
router.get("/users/suggestions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId;

  let excludeIds: number[] = userId ? [userId] : [];

  if (userId) {
    const follows = await db.select({ seguidoId: followsTable.seguidoId }).from(followsTable).where(eq(followsTable.seguidorId, userId));
    excludeIds = [userId, ...follows.map(f => f.seguidoId)];
  }

  const query = db.select().from(usersTable).limit(10);
  const users = excludeIds.length > 0
    ? await query.where(not(inArray(usersTable.id, excludeIds)))
    : await query;

  const result = await Promise.all(users.map(async (u) => {
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, u.id));
    return {
      id: u.id,
      username: u.username,
      nomeExibicao: u.nomeExibicao,
      avatarUrl: urlMedia(u.avatarUrl),
      verificado: u.verificado,
      tipoConta: u.tipoConta,
      estaASeguir: false,
      segueVoce: false,
      totalSeguidores: cnt || 0,
    };
  }));

  res.json(result);
});

// Top Criadores (mais ativos em publicações e mais curtidos)
router.get(["/users/top-creators", "/creators/top"], requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const viewerId = req.userId;

  try {
    const creators = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        nomeExibicao: usersTable.nomeExibicao,
        avatarUrl: usersTable.avatarUrl,
        verificado: usersTable.verificado,
        tipoConta: usersTable.tipoConta,
      })
      .from(usersTable)
      .where(eq(usersTable.tipoConta, "criador"))
      .limit(20);

    let candidateUsers = creators;
    if (candidateUsers.length === 0) {
      candidateUsers = await db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          nomeExibicao: usersTable.nomeExibicao,
          avatarUrl: usersTable.avatarUrl,
          verificado: usersTable.verificado,
          tipoConta: usersTable.tipoConta,
        })
        .from(usersTable)
        .limit(20);
    }

    if (candidateUsers.length === 0) {
      res.json([]);
      return;
    }

    const candidateIds = candidateUsers.map(u => u.id);

    const postsCountRows = await db
      .select({
        autorId: postsTable.autorId,
        totalPosts: sql<number>`count(*)::int`,
      })
      .from(postsTable)
      .where(and(inArray(postsTable.autorId, candidateIds), postVisivel()))
      .groupBy(postsTable.autorId);

    const postsCountMap = new Map<number, number>();
    for (const r of postsCountRows) {
      postsCountMap.set(r.autorId, r.totalPosts || 0);
    }

    const allUserPosts = await db
      .select({ id: postsTable.id, autorId: postsTable.autorId })
      .from(postsTable)
      .where(and(inArray(postsTable.autorId, candidateIds), postVisivel()));

    const postIds = allUserPosts.map(p => p.id);
    const postToAuthorMap = new Map<number, number>();
    for (const p of allUserPosts) {
      postToAuthorMap.set(p.id, p.autorId);
    }

    const likesCountMap = new Map<number, number>();
    if (postIds.length > 0) {
      const likesRows = await db
        .select({
          postId: likesTable.alvoId,
          totalLikes: sql<number>`count(*)::int`,
        })
        .from(likesTable)
        .where(and(eq(likesTable.alvoTipo, "post"), inArray(likesTable.alvoId, postIds)))
        .groupBy(likesTable.alvoId);

      for (const l of likesRows) {
        const autorId = postToAuthorMap.get(l.postId);
        if (autorId) {
          likesCountMap.set(autorId, (likesCountMap.get(autorId) || 0) + (l.totalLikes || 0));
        }
      }
    }

    const followersRows = await db
      .select({
        seguidoId: followsTable.seguidoId,
        totalSeguidores: sql<number>`count(*)::int`,
      })
      .from(followsTable)
      .where(inArray(followsTable.seguidoId, candidateIds))
      .groupBy(followsTable.seguidoId);

    const followersMap = new Map<number, number>();
    for (const f of followersRows) {
      followersMap.set(f.seguidoId, f.totalSeguidores || 0);
    }

    const followingSet = new Set<number>();
    if (viewerId) {
      const viewerFollows = await db
        .select({ seguidoId: followsTable.seguidoId })
        .from(followsTable)
        .where(and(eq(followsTable.seguidorId, viewerId), inArray(followsTable.seguidoId, candidateIds)));
      for (const vf of viewerFollows) {
        followingSet.add(vf.seguidoId);
      }
    }

    const ranked = candidateUsers.map(u => {
      const totalPosts = postsCountMap.get(u.id) || 0;
      const totalCurtidas = likesCountMap.get(u.id) || 0;
      const totalSeguidores = followersMap.get(u.id) || 0;
      const estaASeguir = followingSet.has(u.id);
      const score = (totalCurtidas * 2) + (totalPosts * 5);

      return {
        id: u.id,
        username: u.username,
        nomeExibicao: u.nomeExibicao,
        avatarUrl: urlMedia(u.avatarUrl),
        verificado: u.verificado,
        tipoConta: u.tipoConta,
        totalPublicacoes: totalPosts,
        totalCurtidas: totalCurtidas,
        totalSeguidores: totalSeguidores,
        estaASeguir: estaASeguir,
        score,
      };
    });

    ranked.sort((a, b) => b.score - a.score || b.totalCurtidas - a.totalCurtidas || b.totalPublicacoes - a.totalPublicacoes);

    res.json(ranked.slice(0, 5));
  } catch (error) {
    console.error("[top-creators] error:", error);
    res.status(500).json({ error: "Erro ao carregar top criadores" });
  }
});

// Atualizar perfil
router.patch("/users/me", requireAuth, validate(updateProfileSchema), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  // tipoConta foi removido intencionalmente — use POST /users/me/tornar-criador
  const { nomeExibicao, bio, link, avatarUrl, capaUrl, privado } = req.body;

  const updates: Record<string, any> = {};
  if (nomeExibicao !== undefined) updates.nomeExibicao = nomeExibicao;
  if (bio !== undefined) updates.bio = bio;
  if (link !== undefined) updates.link = link;
  // Avatar e capa: só ficheiros do nosso CDN (guardados sem token) ou vazio para remover.
  if (avatarUrl !== undefined) {
    const v = urlAvatarOuCapa(avatarUrl);
    if (v === null) { res.status(400).json({ error: "A foto de perfil tem de ser um ficheiro carregado no Xclusive." }); return; }
    updates.avatarUrl = v;
  }
  if (capaUrl !== undefined) {
    const v = urlAvatarOuCapa(capaUrl);
    if (v === null) { res.status(400).json({ error: "A capa tem de ser um ficheiro carregado no Xclusive." }); return; }
    updates.capaUrl = v;
  }
  if (privado !== undefined) updates.privado = privado;

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();

  const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, userId));
  const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, userId));
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(postsTable).where(eq(postsTable.autorId, userId));

  res.json({
    id: user.id,
    username: user.username,
    nomeExibicao: user.nomeExibicao,
    bio: user.bio,
    avatarUrl: urlMedia(user.avatarUrl),
    capaUrl: urlMedia(user.capaUrl),
    link: user.link,
    tipoConta: user.tipoConta,
    verificado: user.verificado,
    privado: user.privado,
    totalSeguidores: seguidores || 0,
    totalSeguindo: seguindo || 0,
    totalPublicacoes: posts || 0,
    estaASeguir: false,
    segueVoce: false,
    criadoEm: user.criadoEm.toISOString(),
  });
});

// ── Preferência de conteúdo +18 ──────────────────────────────────────────────
// PR 1: só guarda a escolha (nada é filtrado ainda). "filtrar" é sempre permitido; "ver" exige idade >= 18
// pela data de nascimento da conta e a confirmação explícita enviada no pedido, sem nenhuma outra verificação.
const preferenciaMais18Schema = z.object({
  valor: z.enum(PREFERENCIAS_MAIS18),
  confirmo: z.boolean().optional(),
});

const limitePreferenciaMais18 = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Demasiadas alterações seguidas. Tenta novamente dentro de alguns minutos." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${(req as AuthRequest).userId}`,
});

router.patch("/users/me/preferencia-mais18", requireAuth, limitePreferenciaMais18, validate(preferenciaMais18Schema), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const { valor, confirmo } = req.body as z.infer<typeof preferenciaMais18Schema>;

  if (valor === "ver" && confirmo !== true) {
    res.status(400).json({ error: "Para ver conteúdo +18 tens de confirmar que tens 18 anos ou mais.", codigo: "confirmacao_em_falta" });
    return;
  }

  try {
    // Utilizador, preferência, data e histórico NA MESMA transação (se a linha do histórico falhar, nada muda).
    // O IP vai só para a base de dados; nunca para logs.
    const r = await db.transaction(async (tx) => {
      const [u] = await tx
        .select({ dataNascimento: usersTable.dataNascimento, preferenciaMais18: usersTable.preferenciaMais18, preferenciaMais18Em: usersTable.preferenciaMais18Em })
        .from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
      if (!u) return { erro: 404 as const };

      if (valor === "ver") {
        const idade = idadeEmAnos(u.dataNascimento);
        if (idade === null) return { erro: 403 as const, codigo: "idade_nao_verificavel" };
        if (idade < IDADE_MINIMA_VER) return { erro: 403 as const, codigo: "menor_de_idade" };
      }

      // Mesma escolha que já está guardada: nada a gravar (a data original mantém-se).
      if (u.preferenciaMais18 === valor) {
        return { preferenciaMais18: u.preferenciaMais18, preferenciaMais18Em: u.preferenciaMais18Em };
      }

      const agora = new Date();
      await tx.update(usersTable).set({ preferenciaMais18: valor, preferenciaMais18Em: agora }).where(eq(usersTable.id, userId));
      await tx.insert(userMais18ChoicesTable).values({
        userId, valor, textoVersao: MAIS18_TEXTO_VERSAO, escolhidaEm: agora,
        ip: (req.ip ?? "").slice(0, 45) || null,
      });
      return { preferenciaMais18: valor, preferenciaMais18Em: agora };
    });

    if ("erro" in r) {
      if (r.erro === 404) { res.status(404).json({ error: "Utilizador não encontrado." }); return; }
      res.status(403).json({
        error: r.codigo === "menor_de_idade"
          ? "Só quem tem 18 anos ou mais pode escolher ver conteúdo +18."
          : "Não foi possível confirmar a tua idade pela data de nascimento da conta.",
        codigo: r.codigo,
      });
      return;
    }
    res.json({ preferenciaMais18: r.preferenciaMais18, preferenciaMais18Em: r.preferenciaMais18Em?.toISOString() ?? null });
  } catch (err) {
    // NÃO se regista o objeto de erro: o do Drizzle inclui os parâmetros da query (e, com eles, o IP).
    (req as any).log?.error({ erro: err instanceof Error ? err.name : "desconhecido", pgCode: (err as any)?.cause?.code ?? (err as any)?.code }, "Preferência +18: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * POST /api/users/me/tornar-criador
 * Submete pedido KYC e promove a conta para "criador" (verificado=false, pendente revisão admin).
 * É a ÚNICA forma válida de alterar tipoConta pessoal→criador no backend.
 */
router.post("/users/me/tornar-criador", requireAuth, validate(kycSubmissionSchema), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;

  // Verificar se já é criador
  const [current] = await db.select({ tipoConta: usersTable.tipoConta, verificado: usersTable.verificado })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!current) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }
  if (current.tipoConta === "criador") {
    res.status(409).json({ error: "A conta já é do tipo criador." });
    return;
  }

  const { dataNascimento } = req.body;

  // Verificar idade mínima de 18 anos
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  const idadeAnos = hoje.getFullYear() - nascimento.getFullYear()
    - (hoje < new Date(hoje.getFullYear(), nascimento.getMonth(), nascimento.getDate()) ? 1 : 0);
  if (idadeAnos < 18) {
    res.status(400).json({ error: "Tens de ter pelo menos 18 anos para te tornares criador." });
    return;
  }

  // Os documentos KYC só vão para a zona privada: sem ela configurada falha (nunca usa a pública).
  if (!isPrivateStorageConfigured()) {
    req.log?.error({ missing: getMissingPrivateStorageEnv() }, "KYC: armazenamento privado não configurado — submissão recusada.");
    res.status(503).json({ error: "O envio de documentos está temporariamente indisponível. Tenta mais tarde." });
    return;
  }

  function decodeCapturedImage(value: string, field: string): { buffer: Buffer; contentType: string; extension: string } {
    const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
      throw new Error(`${field} tem um formato de imagem inválido.`);
    }
    const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
      throw new Error(`${field} excede o tamanho permitido.`);
    }
    // Conteúdo real (primeiros bytes), não só o tipo declarado.
    const detected =
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? "jpeg"
      : buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
      : buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP" ? "webp"
      : null;
    if (!detected || `image/${detected}` !== match[1]) {
      throw new Error(`${field} não é uma imagem válida.`);
    }
    return { buffer, contentType: `image/${detected}`, extension: detected === "jpeg" ? "jpg" : detected };
  }

  const uploadedKeys: string[] = [];
  try {
    const captured = [
      decodeCapturedImage(req.body.documentoFoto, "documentoFoto"),
      decodeCapturedImage(req.body.selfieFoto, "selfieFoto"),
      decodeCapturedImage(req.body.livenessFoto, "livenessFoto"),
    ];
    const keys = captured.map((file) => createStorageKey(`kyc/${userId}`, file.extension));

    for (let index = 0; index < captured.length; index++) {
      const file = captured[index];
      const key = keys[index];
      await uploadPrivate(file.buffer, key, file.contentType);
      uploadedKeys.push(key);
    }

    await db.transaction(async (tx) => {
      await tx.insert(kycSubmissionsTable).values({
        userId,
        nomeCompleto: req.body.nomeCompleto,
        dataNascimento: req.body.dataNascimento,
        tipoDocumento: req.body.tipoDocumento,
        numeroDocumento: req.body.numeroDocumento,
        paisEmissao: req.body.paisEmissao,
        documentoKey: keys[0],
        selfieKey: keys[1],
        livenessKey: keys[2],
      });

      // A conta passa a aparecer na fila de revisão, mas só fica verificada
      // depois da aprovação explícita de um administrador.
      await tx.update(usersTable)
        .set({ tipoConta: "criador", verificado: false })
        .where(eq(usersTable.id, userId));
    });
  } catch (error) {
    await Promise.allSettled(uploadedKeys.map((key) => deletePrivate(key)));
    const message = error instanceof Error ? error.message : "Não foi possível guardar os documentos.";
    res.status(400).json({ error: message });
    return;
  }

  res.status(202).json({
    ok: true,
    tipoConta: "criador",
    verificado: false,
    mensagem: "Pedido de verificação submetido com sucesso. A tua conta ficará pendente de revisão — serás notificado quando for aprovada.",
  });
});

// Obter perfil por username
router.get("/users/:username", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { username } = req.params;
  const viewerId = req.userId;

  const raw = Array.isArray(username) ? username[0] : username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  // Conta suspensa (inclui perfis retirados por denúncia): o perfil deixa de ser servido
  if (!user || !user.ativo) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }

  const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, user.id));
  const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, user.id));
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(postsTable).where(and(eq(postsTable.autorId, user.id), postVisivel()));

  let estaASeguir = false;
  let segueVoce = false;
  if (viewerId && viewerId !== user.id) {
    const [f] = await db.select().from(followsTable).where(and(eq(followsTable.seguidorId, viewerId), eq(followsTable.seguidoId, user.id)));
    estaASeguir = !!f;
    const [fBack] = await db.select().from(followsTable).where(and(eq(followsTable.seguidorId, user.id), eq(followsTable.seguidoId, viewerId)));
    segueVoce = !!fBack;
  }

  const podeVerConteudo = await canViewPrivateContent(user, viewerId, estaASeguir);

  res.json({
    id: user.id,
    username: user.username,
    nomeExibicao: user.nomeExibicao,
    bio: user.bio,
    avatarUrl: urlMedia(user.avatarUrl),
    capaUrl: urlMedia(user.capaUrl),
    link: user.link,
    tipoConta: user.tipoConta,
    verificado: user.verificado,
    privado: user.privado,
    // Contagens ocultadas para contas privadas a não-seguidores
    totalSeguidores: podeVerConteudo ? (seguidores || 0) : null,
    totalSeguindo: podeVerConteudo ? (seguindo || 0) : null,
    totalPublicacoes: podeVerConteudo ? (posts || 0) : null,
    estaASeguir,
    segueVoce,
    criadoEm: user.criadoEm.toISOString(),
  });
});

// Seguir utilizador
router.post("/users/:username/follow", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!target || target.id === userId) { res.status(400).json({ error: "Inválido" }); return; }

  const [existing] = await db.select().from(followsTable).where(and(eq(followsTable.seguidorId, userId), eq(followsTable.seguidoId, target.id)));
  if (!existing) {
    await db.insert(followsTable).values({ seguidorId: userId, seguidoId: target.id });
    // Notificar o utilizador seguido
    await db.insert(notificationsTable).values({
      destinatarioId: target.id,
      tipo: "novo_seguidor",
      atorId: userId,
      alvoId: null,
    }).onConflictDoNothing();
  }
  res.json({ ok: true });
});

// Deixar de seguir
router.delete("/users/:username/follow", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!target) { res.status(404).json({ error: "Não encontrado" }); return; }

  await db.delete(followsTable).where(and(eq(followsTable.seguidorId, userId), eq(followsTable.seguidoId, target.id)));
  res.json({ ok: true });
});

// Seguidores
router.get("/users/:username/followers", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  const followers = await db.select({ u: usersTable }).from(followsTable).innerJoin(usersTable, eq(followsTable.seguidorId, usersTable.id)).where(eq(followsTable.seguidoId, user.id)).limit(50);
  const users = followers.map(f => ({
    id: f.u.id,
    username: f.u.username,
    nomeExibicao: f.u.nomeExibicao,
    avatarUrl: urlMedia(f.u.avatarUrl),
    verificado: f.u.verificado,
    tipoConta: f.u.tipoConta,
    estaASeguir: false,
    segueVoce: false,
    totalSeguidores: 0,
  }));
  res.json({ users, total: users.length, page: 1, hasMore: false });
});

// A seguir
router.get("/users/:username/following", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  const following = await db.select({ u: usersTable }).from(followsTable).innerJoin(usersTable, eq(followsTable.seguidoId, usersTable.id)).where(eq(followsTable.seguidorId, user.id)).limit(50);
  const users = following.map(f => ({
    id: f.u.id,
    username: f.u.username,
    nomeExibicao: f.u.nomeExibicao,
    avatarUrl: urlMedia(f.u.avatarUrl),
    verificado: f.u.verificado,
    tipoConta: f.u.tipoConta,
    estaASeguir: false,
    segueVoce: false,
    totalSeguidores: 0,
  }));
  res.json({ users, total: users.length, page: 1, hasMore: false });
});

// Posts do utilizador
router.get("/users/:username/posts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  const posts = await db.select().from(postsTable).where(and(eq(postsTable.autorId, user.id), postVisivel())).orderBy(sql`${postsTable.criadoEm} DESC`).limit(30);

  const result = await Promise.all(posts.map(async (p) => {
    const media = await db.select().from(postMediaTable).where(eq(postMediaTable.postId, p.id)).orderBy(postMediaTable.ordem);
    const [{ likes }] = await db.select({ likes: sql<number>`count(*)::int` }).from(likesTable).where(and(eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, p.id)));
    const [{ comments }] = await db.select({ comments: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.postId, p.id));
    const acesso = p.exclusivo
      ? await temAcessoExclusivo(req.userId, p.autorId, p.id)
      : true;
    const mediaSegura = acesso
      ? media.map(m => ({ id: m.id, url: resolveMediaUrl(m.url), tipo: m.tipo, ordem: m.ordem }))
      : media.map(m => ({ id: m.id, url: null, tipo: m.tipo, ordem: m.ordem, bloqueado: true }));
    return {
      id: p.id,
      autor: { id: user.id, username: user.username, nomeExibicao: user.nomeExibicao, avatarUrl: urlMedia(user.avatarUrl), verificado: user.verificado, tipoConta: user.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
      legenda: p.legenda,
      localizacao: p.localizacao,
      tipo: p.tipo,
      media: mediaSegura,
      exclusivo: p.exclusivo,
      bloqueado: p.exclusivo && !acesso,
      precoDesbloqueio: p.precoDesbloqueio ? parseFloat(p.precoDesbloqueio) : null,
      totalCurtidas: likes || 0,
      totalComentarios: comments || 0,
      curtido: false,
      guardado: false,
      criadoEm: p.criadoEm.toISOString(),
    };
  }));

  res.json({ posts: result, total: result.length, page: 1, hasMore: false });
});

// Reels do utilizador
router.get("/users/:username/reels", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  res.json({ reels: [], page: 1, hasMore: false });
});

export default router;
