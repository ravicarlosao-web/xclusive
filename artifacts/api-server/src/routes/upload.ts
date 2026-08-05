/**
 * POST /api/upload
 * Recebe ficheiros multipart (imagens e vídeos), guarda em /uploads/ e devolve URLs permanentes.
 * Máximo: 10 ficheiros, 100 MB cada.
 */

import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

// Diretório persistente na raiz do workspace
const UPLOADS_DIR = path.resolve(process.cwd(), "../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
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
  (req: AuthRequest, res): void => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: "Nenhum ficheiro enviado." });
      return;
    }

    const baseUrl = `/api/media`;
    const result = files.map((f) => ({
      url: `${baseUrl}/${f.filename}`,
      tipo: f.mimetype.startsWith("video/") ? "video" : "imagem",
      size: f.size,
    }));

    res.status(201).json({ files: result });
  },
);

export default router;
