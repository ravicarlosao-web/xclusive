import { createHash } from "node:crypto";

/** JSON canónico (chaves ordenadas, recursivo): o mesmo conteúdo dá sempre o mesmo texto, mesmo depois de passar pelo jsonb. */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(",")}}`;
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");
