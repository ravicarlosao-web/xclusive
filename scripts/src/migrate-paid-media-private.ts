/**
 * Migração do média de posts exclusivos já existentes: zona pública (xclusive-cdn) → zona privada.
 *
 * NÃO é executado automaticamente. Só os posts com exclusivo = true são tocados; avatares,
 * posts gratuitos, reels e stories ficam como estão.
 *
 * Modos (por omissão: --dry-run, não faz nenhuma alteração nem pedido de rede):
 *   --dry-run        (omissão) só conta o que há por migrar.
 *   --apply          copia cada ficheiro para paid/<autorId>/<uuid>.<ext> na zona privada, confirma o
 *                    tamanho através de um URL assinado, e só então actualiza post_media.url para a
 *                    chave. Linha a linha; idempotente e retomável (linhas já migradas são ignoradas).
 *                    NÃO apaga nada da zona pública.
 *   --delete-public  passo SEPARADO e posterior: apaga da zona pública os originais listados no
 *                    ficheiro de mapeamento, só se a BD já apontar para a chave nova.
 *
 *   --map-file=<caminho>  ficheiro local com o mapeamento antigo→novo (JSON Lines).
 *                         Omissão: ./migrate-paid-media-private.map.jsonl  (permissões 0600; NÃO fazer commit).
 *
 * Imprime só contagens (nunca URLs, chaves ou tokens).
 *
 * Uso (na VPS, na raiz do repositório, com o .env carregado):
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-paid-media-private.ts            # dry-run
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-paid-media-private.ts --apply
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-paid-media-private.ts --delete-public
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

import { pool } from "@workspace/db";

// Import dinâmico do backend (fora do rootDir deste pacote): usa exactamente o código de produção.
const storagePath = path.resolve(import.meta.dirname, "../../artifacts/api-server/src/lib/storage.ts");
const storage = (await import(pathToFileURL(storagePath).href)) as {
  getMissingPrivateStorageEnv: () => string[];
  getPrivateSignedUrl: (key: string, ttlSeconds?: number) => { url: string; expiresAt: Date };
  getStorageKeyFromPublicUrl: (url: string) => string | null;
  isPaidKey: (value: string) => boolean;
  isStorageConfigured: () => boolean;
  deleteFile: (key: string) => Promise<void>;
  deletePrivate: (key: string) => Promise<void>;
  uploadPrivate: (buffer: Buffer, key: string, contentType: string) => Promise<void>;
  uploadPrivateStream: (stream: Readable, key: string, contentType: string) => Promise<void>;
};

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DELETE_PUBLIC = args.includes("--delete-public");
const mapArg = args.find((a) => a.startsWith("--map-file="));
const MAP_FILE = path.resolve(mapArg ? mapArg.slice("--map-file=".length) : "migrate-paid-media-private.map.jsonl");

if (APPLY && DELETE_PUBLIC) {
  console.error("Usa --apply e --delete-public em execuções separadas.");
  process.exit(1);
}

interface Row { id: number; post_id: number; url: string; tipo: string; autor_id: number }
interface MapEntry { rowId: number; oldUrl: string; newKey: string }

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

function extensionOf(url: string, contentType: string | null, tipo: string): string {
  const fromUrl = path.extname(new URL(url).pathname).replace(".", "").toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(fromUrl)) return fromUrl;
  const fromMime = contentType ? EXT_BY_MIME[contentType.split(";")[0].trim()] : undefined;
  return fromMime ?? (tipo === "video" ? "mp4" : "jpg");
}

function readMap(): MapEntry[] {
  if (!fs.existsSync(MAP_FILE)) return [];
  return fs.readFileSync(MAP_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as MapEntry);
}

function appendMap(entry: MapEntry): void {
  fs.appendFileSync(MAP_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

/** Linhas de posts exclusivos cujo média ainda não está na zona privada. */
async function selectPending(): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT pm.id, pm.post_id, pm.url, pm.tipo, p.autor_id
       FROM post_media pm
       JOIN posts p ON p.id = pm.post_id
      WHERE p.exclusivo = true AND pm.url NOT LIKE 'paid/%'
      ORDER BY pm.id`,
  );
  return rows;
}

async function migrateRow(row: Row): Promise<"migrated" | "skipped"> {
  // Só ficheiros da nossa zona pública; qualquer outro URL (externo) fica como está.
  if (!storage.getStorageKeyFromPublicUrl(row.url)) return "skipped";

  const src = await fetch(row.url);
  if (!src.ok || !src.body) throw new Error(`download ${src.status}`);
  const contentType = src.headers.get("content-type") ?? "application/octet-stream";
  const declaredSize = Number(src.headers.get("content-length") ?? "");
  const ext = extensionOf(row.url, contentType, row.tipo);
  const newKey = `paid/${row.autor_id}/${crypto.randomUUID()}.${ext}`;

  let size: number;
  if (row.tipo === "video") {
    // Vídeos grandes: em streaming, sem os carregar para memória. O tamanho é confirmado a seguir.
    await storage.uploadPrivateStream(Readable.fromWeb(src.body as never), newKey, contentType);
    size = declaredSize;
  } else {
    const buffer = Buffer.from(await src.arrayBuffer());
    await storage.uploadPrivate(buffer, newKey, contentType);
    size = buffer.byteLength;
  }

  try {
    // Confirma que o ficheiro existe na zona privada com o tamanho certo (via URL assinado, 5 min).
    const head = await fetch(storage.getPrivateSignedUrl(newKey, 300).url, { method: "HEAD" });
    const stored = Number(head.headers.get("content-length") ?? "");
    if (!head.ok || !Number.isFinite(size) || size <= 0 || stored !== size) throw new Error("verificação de tamanho falhou");
  } catch (err) {
    await storage.deletePrivate(newKey).catch(() => undefined);
    throw err;
  }

  // Mapeamento ANTES de actualizar a BD: se o processo parar a meio, nada se perde.
  appendMap({ rowId: row.id, oldUrl: row.url, newKey });
  const res = await pool.query("UPDATE post_media SET url = $1 WHERE id = $2 AND url = $3", [newKey, row.id, row.url]);
  if (res.rowCount !== 1) {
    // Alterada entretanto: não deixa órfão na zona privada.
    await storage.deletePrivate(newKey).catch(() => undefined);
    return "skipped";
  }
  return "migrated";
}

async function main(): Promise<void> {
  if (DELETE_PUBLIC) {
    if (!storage.isStorageConfigured()) throw new Error("Zona pública não configurada.");
    const entries = readMap();
    let deleted = 0, notMigrated = 0, failed = 0;
    for (const e of entries) {
      const { rows } = await pool.query<{ url: string }>("SELECT url FROM post_media WHERE id = $1", [e.rowId]);
      if (rows[0]?.url !== e.newKey) { notMigrated++; continue; }
      const key = storage.getStorageKeyFromPublicUrl(e.oldUrl);
      if (!key) { notMigrated++; continue; }
      try { await storage.deleteFile(key); deleted++; } catch { failed++; }
    }
    console.log(`Mapeamentos: ${entries.length} | apagados da zona pública: ${deleted} | ignorados (BD não aponta para a chave nova): ${notMigrated} | falhas: ${failed}`);
    return;
  }

  const pending = await selectPending();
  const own = pending.filter((r) => storage.getStorageKeyFromPublicUrl(r.url));
  const videos = own.filter((r) => r.tipo === "video").length;
  console.log(`Por migrar: ${own.length} ficheiros (${own.length - videos} imagens, ${videos} vídeos); URLs que não são da zona pública (ignorados): ${pending.length - own.length}`);
  if (!APPLY) {
    console.log("Dry-run: nada foi alterado. Usa --apply para migrar.");
    return;
  }

  const missing = storage.getMissingPrivateStorageEnv();
  if (missing.length > 0) throw new Error(`Faltam variáveis da zona privada: ${missing.join(", ")}`);

  let migrated = 0, skipped = 0, failed = 0;
  for (const row of own) {
    try {
      (await migrateRow(row)) === "migrated" ? migrated++ : skipped++;
    } catch {
      failed++; // sem detalhes: o erro pode conter URLs
    }
  }
  console.log(`Migrados: ${migrated} | ignorados: ${skipped} | falhas: ${failed} (re-executar retoma as falhas) | mapeamento: ${path.basename(MAP_FILE)}`);
  if (failed > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await pool.end();
}
