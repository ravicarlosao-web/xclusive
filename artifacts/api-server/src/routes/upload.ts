/**
 * POST /api/upload
 * Recebe ficheiros multipart (imagens e vídeos), envia-os para Bunny Storage e devolve URLs BunnyCDN.
 * Máximo: 10 ficheiros, 500 MB cada.
 */

import { Router, type RequestHandler } from "express";
import multer from "multer";
import { PassThrough, type Readable } from "node:stream";
import { requireAuth, type AuthRequest } from "../lib/auth";
import {
  createStorageKey,
  deleteFile,
  getPublicUrl,
  isStorageConfigured,
  uploadFile,
  uploadFileStream,
} from "../lib/storage";

const router = Router();
const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
]);

type StreamUploadState = {
  bytes: number;
  truncated: boolean;
};

type StreamUploadInfo = {
  storageKey: string;
  streamState: StreamUploadState;
};

interface CustomMulterFile extends Express.Multer.File {
  storageKey?: string;
  streamBytes?: number;
}

const imageStorage = multer.memoryStorage();

const requireStorage: RequestHandler = (_req, res, next) => {
  if (!isStorageConfigured()) {
    res.status(503).json({ error: "Armazenamento de media não está configurado." });
    return;
  }
  next();
};

/**
 * Keeps the existing memoryStorage behaviour for images. Videos are piped to
 * Bunny while Multer is parsing the multipart request; this is important
 * because the route handler only runs after Multer has finished parsing.
 */
const streamingVideoStorage: multer.StorageEngine = {
  _handleFile: (req, file, cb) => {
    const streamState: StreamUploadState = { bytes: 0, truncated: false };
    const stream = new PassThrough();
    const extension = file.mimetype.split("/")[1] ?? "bin";
    const storageKey = createStorageKey(`users/${(req as AuthRequest).userId}/media`, extension);

    file.stream.on("data", (chunk: Buffer) => {
      streamState.bytes += chunk.length;
    });
    file.stream.on("limit", () => {
      streamState.truncated = true;
      stream.destroy(new Error("O vídeo excede o limite de 500 MB."));
    });
    file.stream.on("error", (error) => stream.destroy(error));
    file.stream.pipe(stream);

    void uploadFileStream(stream, storageKey, file.mimetype)
      .then(() => {
        if (streamState.truncated) {
          cb(new Error("O vídeo excede o limite de 500 MB."));
          return;
        }
        (file as CustomMulterFile).storageKey = storageKey;
        (file as CustomMulterFile).streamBytes = streamState.bytes;
        cb(null, {
          path: storageKey,
          size: streamState.bytes,
        });
      })
      .catch((error: unknown) => {
        void deleteFile(storageKey).catch(() => undefined).finally(() => {
          cb(error as Error);
        });
      });
  },
  _removeFile: (_req, file, cb) => {
    const key = (file as CustomMulterFile).storageKey;
    if (key) {
      void deleteFile(key).catch(() => undefined).finally(() => cb(null));
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
  requireStorage,
  upload.array("files", 10),
  async (req: AuthRequest, res): Promise<void> => {
    if (!isStorageConfigured()) {
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
          key = createStorageKey(`users/${req.userId}/media`, extension);
          size = file.size;
        }
        uploadedKeys.push(key);

        if (isVideo) {
          // The streaming storage engine already completed this upload while
          // Multer was parsing the request.
        } else {
          await uploadFile(file.buffer, key, file.mimetype);
        }

        return {
          url: getPublicUrl(key),
          tipo: isVideo ? "video" : "imagem",
          size,
        };
      }));

      res.status(201).json({ files: uploaded });
    } catch (error) {
      // Remove objects created by a partially failed multi-file upload.
      await Promise.allSettled(uploadedKeys.map((key) => deleteFile(key)));
      throw error;
    }
  },
);

export default router;
