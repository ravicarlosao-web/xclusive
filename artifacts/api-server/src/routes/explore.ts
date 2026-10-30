import { Router } from "express";
import { db, postsTable, usersTable, hashtagsTable } from "@workspace/db";
import { sql, desc, and, eq } from "drizzle-orm";
import { postVisivelPara, lerVisualizador } from "../lib/conteudoMais18";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { formatarPostsEmLote } from "../lib/feed";
import { erroSeguro } from "../lib/erroSeguro";
import { urlMedia } from "../lib/storage";

const router = Router();

// Explorar: todas as publicações visíveis (sem texto/enquetes), mais recentes primeiro, em páginas de 20.
// Mesma visibilidade (`postVisivelPara`), a mesma formatação em lote e a mesma paginação do feed: gostos, comentários,
// "curtido" e "guardado" reais e um nº constante de consultas por página. O parâmetro `category` é aceite e ignorado.
router.get("/explore", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const page = Math.min(1000, Math.max(1, parseInt(String(req.query.page || "1")) || 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  try {
    const visualizador = await lerVisualizador(userId);
    const total = sql<number>`count(*) over()::int`;
    const rows = await db
      .select({ p: postsTable, total })
      .from(postsTable)
      // Cast the enum to text so this route also works while older databases
      // still have a post_tipo enum without the newer "texto" value.
      .where(and(sql`${postsTable.tipo}::text <> 'texto'`, postVisivelPara(visualizador)))
      .orderBy(desc(postsTable.criadoEm), desc(postsTable.id))
      .limit(limit)
      .offset(offset);

    const posts = await formatarPostsEmLote(rows.map((r) => r.p), userId);
    const totalReal = rows[0]?.total ?? 0;
    res.json({ posts, total: totalReal, page, hasMore: offset + rows.length < totalReal });
  } catch (err) {
    req.log?.error(erroSeguro(err), "Erro ao carregar Explorar");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Pesquisa
router.get("/search", requireAuth, async (req: AuthRequest, res): Promise<void> => {
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
      .where(and(eq(usersTable.ativo, true), sql`(lower(${usersTable.username}) like ${pattern} OR lower(${usersTable.nomeExibicao}) like ${pattern})`))
      .limit(10);

    accounts = users.map(u => ({
      id: u.id,
      username: u.username,
      nomeExibicao: u.nomeExibicao,
      avatarUrl: urlMedia(u.avatarUrl),
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
