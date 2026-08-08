/**
 * POST /api/upload
 * Recebe ficheiros multipart (imagens e vídeos), envia-os para B2 e devolve URLs BunnyCDN.
 * Máximo: 10 ficheiros, 100 MB cada.
 */

import { Router } from "express";
import multer from "multer";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { createStorageKey, getPublicUrl, isStorageConfigured, uploadFile } from "../lib/storage";

const router = Router();

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Tipo não suportado: ${file.mimetype}`));
  },
});

router.post(
  "/upload",
  requireAuth,
  upload.array("files", 10),
  async (req: AuthRequest, res): Promise<void> => {
    if (!isStorageConfigured()) {
      res.status(503).json({ error: "Armazenamento de media não está configurado." });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: "Nenhum ficheiro enviado." });
      return;
    }

    const uploaded = await Promise.all(files.map(async (file) => {
      const extension = file.mimetype.split("/")[1] ?? "bin";
      const key = createStorageKey(`users/${req.userId}/media`, extension);
      await uploadFile(file.buffer, key, file.mimetype);
      return {
        url: getPublicUrl(key),
        tipo: file.mimetype.startsWith("video/") ? "video" : "imagem",
        size: file.size,
      };
    }));

    res.status(201).json({ files: uploaded });
  },
);

export default router;
