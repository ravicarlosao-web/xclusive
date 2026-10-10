/**
 * POST /api/upload
 * Recebe ficheiros multipart (imagens e vídeos), envia-os para Bunny Storage e devolve URLs BunnyCDN.
 * Máximo: 10 ficheiros, 500 MB cada.
 */

import { Router, type RequestHandler } from "express";
import multer from "multer";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createStorageKey,
  deleteFile,
  deletePrivate,
  getPublicUrl,
  isPaidKey,
  isPrivateStorageConfigured,
  isStorageConfigured,
  uploadFile,
  uploadFileStream,
  uploadPrivate,
  uploadPrivateStream,
} from "../lib/storage";

const router = Router();
const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
]);

interface CustomMulterFile extends Express.Multer.File {
  storageKey?: string;
  streamBytes?: number;
}

const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR || os.tmpdir();

/**
 * Checks if there is enough free disk space in the temporary directory.
 * Requires at least 2.5x the requested file buffer size + 500 MB safety buffer.
 */
async function checkAvailableDiskSpace(requiredBytes: number): Promise<boolean> {
  try {
    if (typeof fs.promises.statfs === "function") {
      const stats = await fs.promises.statfs(UPLOAD_TMP_DIR);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const minRequired = requiredBytes * 2.5 + 500 * 1024 * 1024;
      return freeBytes >= minRequired;
    }
    return true;
  } catch {
    return true;
  }
}

class TranscodeQueue {
  private queue: Array<() => void> = [];
  private active = 0;
  private maxActive = 1;
  private maxQueue = 3;

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.maxQueue) {
      throw new Error("Servidor ocupado, tenta novamente daqui a alguns minutos.");
    }

    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.active++;
        try {
          const result = await task();
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          this.active--;
          this.next();
        }
      };

      if (this.active < this.maxActive) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }

  next() {
    if (this.active < this.maxActive && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) task();
    }
  }
  
  getStatus() {
    return { active: this.active, queued: this.queue.length };
  }
}

const videoQueue = new TranscodeQueue();

/**
 * Transcodes video to H.264, scales to max 1080p, applies CRF compression,
 * and relocates the moov atom with +faststart.
 */
function transcodeAndFaststart(inputPath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const crf = process.env.VIDEO_TRANSCODE_CRF || "23";
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", "scale=w='min(iw,1920)':h='min(ih,1080)':force_original_aspect_ratio=decrease",
      "-c:v", "libx264",
      "-crf", crf,
      "-preset", "fast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        logger.warn({ code, stderr: stderr.slice(-300) }, "FFmpeg transcode falhou; a usar vídeo original");
        resolve(false);
      }
    });

    ffmpeg.on("error", (err) => {
      logger.warn({ err: (err as Error).message }, "FFmpeg não disponível no servidor; a enviar vídeo original");
      resolve(false);
    });
  });
}

const imageStorage = multer.memoryStorage();

/** Apaga um objecto na zona certa: "paid/..." → privada, restantes → pública. */
function removeObject(key: string): Promise<void> {
  return isPaidKey(key) ? deletePrivate(key) : deleteFile(key);
}

/** `?privado=1`: ficheiros de posts exclusivos vão para a zona privada (paid/<userId>/...). */
const isPrivateUpload = (req: { query: Record<string, unknown> }): boolean => req.query.privado === "1";

const requirePrivateUploadAccess: RequestHandler = async (req, res, next) => {
  if (!isPrivateUpload(req)) {
    next();
    return;
  }
  if (!isPrivateStorageConfigured()) {
    res.status(503).json({ error: "Armazenamento privado de media não está configurado." });
    return;
  }
  const [author] = await db
    .select({ tipoConta: usersTable.tipoConta, verificado: usersTable.verificado })
    .from(usersTable)
    .where(eq(usersTable.id, (req as AuthRequest).userId!));
  if (!author || author.tipoConta !== "criador" || !author.verificado) {
    res.status(403).json({ error: "Apenas criadores verificados podem publicar conteúdo exclusivo." });
    return;
  }
  next();
};

const requireStorage: RequestHandler = (req, res, next) => {
  if (isPrivateUpload(req)) {
    next();
    return;
  }
  if (!isStorageConfigured()) {
    res.status(503).json({ error: "Armazenamento de media não está configurado." });
    return;
  }
  next();
};

/**
 * Stores large video files in a temporary file, optimizes container layout
 * with FFmpeg (+faststart for instant progressive mobile playback),
 * and streams the resulting optimized MP4 directly to Bunny Storage.
 */
const streamingVideoStorage: multer.StorageEngine = {
  _handleFile: async (req, file, cb) => {
    const hasSpace = await checkAvailableDiskSpace(MAX_UPLOAD_SIZE_BYTES);
    if (!hasSpace) {
      cb(new Error("Espaço em disco temporário insuficiente no servidor."));
      return;
    }

    const uuid = randomUUID();
    const extension = file.mimetype.split("/")[1] ?? "mp4";
    const inputTempPath = path.join(UPLOAD_TMP_DIR, `xclusive_${uuid}_raw.${extension}`);
    const outputTempPath = path.join(UPLOAD_TMP_DIR, `xclusive_${uuid}_faststart.mp4`);
    const privado = isPrivateUpload(req);
    const storageKey = createStorageKey(
      privado ? `paid/${(req as AuthRequest).userId}` : `users/${(req as AuthRequest).userId}/media`,
      "mp4",
    );

    const writeStream = fs.createWriteStream(inputTempPath);
    let bytesWritten = 0;
    let truncated = false;

    file.stream.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });
    file.stream.on("limit", () => {
      truncated = true;
      writeStream.destroy(new Error("O vídeo excede o limite de 500 MB."));
    });
    file.stream.on("error", (err) => writeStream.destroy(err));
    file.stream.pipe(writeStream);

    writeStream.on("error", (err) => {
      void fs.promises.unlink(inputTempPath).catch(() => undefined);
      cb(err);
    });

    writeStream.on("finish", async () => {
      if (truncated) {
        void fs.promises.unlink(inputTempPath).catch(() => undefined);
        cb(new Error("O vídeo excede o limite de 500 MB."));
        return;
      }

      let finalUploadPath = inputTempPath;
      let faststartApplied = false;

      try {
        try {
          faststartApplied = await videoQueue.enqueue(() => transcodeAndFaststart(inputTempPath, outputTempPath));
        } catch (queueErr) {
          cb(queueErr as Error);
          return;
        }

        if (faststartApplied) {
          finalUploadPath = outputTempPath;
        }

        const stat = await fs.promises.stat(finalUploadPath);
        const finalSize = stat.size;
        const uploadReadStream = fs.createReadStream(finalUploadPath);

        if (privado) {
          await uploadPrivateStream(uploadReadStream, storageKey, "video/mp4");
        } else {
          await uploadFileStream(uploadReadStream, storageKey, "video/mp4");
        }

        (file as CustomMulterFile).storageKey = storageKey;
        (file as CustomMulterFile).streamBytes = finalSize;

        cb(null, {
          path: storageKey,
          size: finalSize,
        });
      } catch (uploadError) {
        void removeObject(storageKey).catch(() => undefined);
        cb(uploadError as Error);
      } finally {
        // Limpeza garantida de todos os ficheiros temporários do disco
        await Promise.allSettled([
          fs.promises.unlink(inputTempPath).catch(() => undefined),
          fs.promises.unlink(outputTempPath).catch(() => undefined),
        ]);
      }
    });
  },
  _removeFile: (_req, file, cb) => {
    const key = (file as CustomMulterFile).storageKey;
    if (key) {
      void removeObject(key).catch(() => undefined).finally(() => cb(null));
    } else {
      cb(null);
    }
  },
};

const hybridStorage: multer.StorageEngine = {
  _handleFile: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      streamingVideoStorage._handleFile(req, file, cb);
      return;
    }
    imageStorage._handleFile(req, file, cb);
  },
  _removeFile: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      streamingVideoStorage._removeFile(req, file, cb);
      return;
    }
    imageStorage._removeFile(req, file, cb);
  },
};

const upload = multer({
  storage: hybridStorage,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Tipo não suportado: ${file.mimetype}`));
  },
});

router.post(
  "/upload",
  requireAuth,
  requirePrivateUploadAccess,
  requireStorage,
  upload.array("files", 10),
  async (req: AuthRequest, res): Promise<void> => {
    const privado = isPrivateUpload(req);
    if (!privado && !isStorageConfigured()) {
      res.status(503).json({ error: "Armazenamento de media não está configurado." });
      return;
    }

    const files = req.files as CustomMulterFile[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: "Nenhum ficheiro enviado." });
      return;
    }

    const uploadedKeys: string[] = [];

    try {
      const uploaded = await Promise.all(files.map(async (file) => {
        const isVideo = file.mimetype.startsWith("video/");
        const extension = file.mimetype.split("/")[1] ?? "bin";
        let key: string;
        let size: number;

        if (isVideo) {
          key = file.storageKey || (file as any).path;
          size = file.streamBytes ?? file.size ?? 0;
          if (!key) {
            throw new Error("Metadata do upload de vídeo não encontrado.");
          }
        } else {
          key = createStorageKey(privado ? `paid/${req.userId}` : `users/${req.userId}/media`, extension);
          size = file.size;
        }
        uploadedKeys.push(key);

        if (isVideo) {
          // The streaming storage engine already completed this upload while
          // Multer was parsing the request.
        } else {
          if (privado) await uploadPrivate(file.buffer, key, file.mimetype);
          else await uploadFile(file.buffer, key, file.mimetype);
        }

        return {
          // Privado: pseudo-URL; a chave é validada (prefixo do autor) ao criar o post.
          url: privado ? `private://${key}` : getPublicUrl(key),
          tipo: isVideo ? "video" : "imagem",
          size,
        };
      }));

      res.status(201).json({ files: uploaded });
    } catch (error) {
      // Remove objects created by a partially failed multi-file upload.
      await Promise.allSettled(uploadedKeys.map((key) => removeObject(key)));
      throw error;
    }
  },
);

router.get("/upload/queue-status", (req, res) => {
  res.json(videoQueue.getStatus());
});

export default router;
