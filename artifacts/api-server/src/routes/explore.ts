import { Router } from "express";
import { db, postsTable, usersTable, hashtagsTable, postMediaTable } from "@workspace/db";
import { like, sql, desc, eq, inArray } from "drizzle-orm";
import { optionalAuth, type AuthRequest } from "../lib/auth";

const router = Router();

// Explorar
router.get("/explore", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = 20;
  const offset = (page - 1) * limit;

  const posts = await db
    .select()
    .from(postsTable)
    // Cast the enum to text so this route also works while older databases
    // still have a post_tipo enum without the newer "texto" value.
    .where(sql`${postsTable.tipo}::text <> 'texto'`)
    .orderBy(desc(postsTable.criadoEm))
    .limit(limit)
    .offset(offset);

  if (posts.length === 0) {
    res.json({ posts: [], total: 0, page, hasMore: false });
    return;
  }

  const postIds = posts.map(p => p.id);
  const autorIds = [...new Set(posts.map(p => p.autorId))];

  // Fetch users and media in parallel (batch queries, not N+1)
  const [mediaRows, userRows] = await Promise.all([
    db.select().from(postMediaTable).where(inArray(postMediaTable.postId, postIds)),
    db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        nomeExibicao: usersTable.nomeExibicao,
        avatarUrl: usersTable.avatarUrl,
        verificado: usersTable.verificado,
        tipoConta: usersTable.tipoConta,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, autorIds)),
  ]);

  const mediaByPost = new Map<number, typeof mediaRows>();
  for (const m of mediaRows) {
    if (!mediaByPost.has(m.postId)) mediaByPost.set(m.postId, []);
    mediaByPost.get(m.postId)!.push(m);
  }

  const usersById = new Map(userRows.map(u => [u.id, u]));

  const result = posts.map(p => {
    const user = usersById.get(p.autorId);
    const media = (mediaByPost.get(p.id) ?? [])
      .sort((a, b) => a.ordem - b.ordem)
      .map(m => ({ id: m.id, url: m.url, tipo: m.tipo, ordem: m.ordem }));
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
      media,
      exclusivo: p.exclusivo,
      precoDesbloqueio: p.precoDesbloqueio ? parseFloat(p.precoDesbloqueio) : null,
      totalCurtidas: 0,
      totalComentarios: 0,
      curtido: false,
      guardado: false,
      criadoEm: p.criadoEm.toISOString(),
    };
  });

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
