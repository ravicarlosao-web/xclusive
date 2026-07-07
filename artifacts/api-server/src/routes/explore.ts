import { Router } from "express";
import { db, postsTable, usersTable, hashtagsTable } from "@workspace/db";
import { like, sql, desc, eq } from "drizzle-orm";
import { optionalAuth, type AuthRequest } from "../lib/auth";

const router = Router();

// Explorar
router.get("/explore", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = 20;
  const offset = (page - 1) * limit;

  const posts = await db.select().from(postsTable).orderBy(desc(postsTable.criadoEm)).limit(limit).offset(offset);

  const result = await Promise.all(posts.map(async (p) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, p.autorId));
    return {
      id: p.id,
      autor: user ? {
        id: user.id, username: user.username, nomeExibicao: user.nomeExibicao,
        avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta,
        estaASeguir: false, segueVoce: false, totalSeguidores: 0,
      } : null,
      legenda: p.legenda,
      localizacao: p.localizacao,
      tipo: p.tipo,
      media: [],
      exclusivo: p.exclusivo,
      precoDesbloqueio: p.precoDesbloqueio ? parseFloat(p.precoDesbloqueio) : null,
      totalCurtidas: 0,
      totalComentarios: 0,
      curtido: false,
      guardado: false,
      criadoEm: p.criadoEm.toISOString(),
    };
  }));

  res.json({ posts: result, total: result.length, page, hasMore: result.length === limit });
});

// Pesquisa
router.get("/search", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const q = String(req.query.q || "").trim();
  const type = String(req.query.type || "all");

  if (!q) {
    res.json({ accounts: [], hashtags: [] });
    return;
  }

  const pattern = `%${q.toLowerCase()}%`;

  let accounts: any[] = [];
  let hashtags: any[] = [];

  if (type === "all" || type === "accounts") {
    const users = await db.select().from(usersTable)
      .where(sql`lower(${usersTable.username}) like ${pattern} OR lower(${usersTable.nomeExibicao}) like ${pattern}`)
      .limit(10);

    accounts = users.map(u => ({
      id: u.id,
      username: u.username,
      nomeExibicao: u.nomeExibicao,
      avatarUrl: u.avatarUrl,
      verificado: u.verificado,
      tipoConta: u.tipoConta,
      estaASeguir: false,
      segueVoce: false,
      totalSeguidores: 0,
    }));
  }

  if (type === "all" || type === "hashtags") {
    const tags = await db.select().from(hashtagsTable)
      .where(sql`lower(${hashtagsTable.nome}) like ${pattern}`)
      .limit(10);

    hashtags = tags.map(t => ({ nome: t.nome, totalPosts: t.totalPosts }));
  }

  res.json({ accounts, hashtags });
});

export default router;
