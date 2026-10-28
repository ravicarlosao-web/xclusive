import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Erros de consulta à BD (drizzle e pg) trazem a query e os parâmetros (emails, ids, jti...) em query/params, na
// mensagem, em detail/where e na 1.ª linha da stack. Estes nunca vão para os logs: ficam o nome, o código e as
// linhas "at ...". Qualquer OUTRO erro passa intacto (mensagem, código e stack). Um hook (e não um serializer)
// porque o pino-http cria loggers filhos com o seu próprio serializer "err".
const MSG_ERRO_BD = "[REDIGIDO: erro de consulta à base de dados]";

type ErroComCausa = Error & { code?: unknown; severity?: unknown; cause?: unknown };

function eErroDeBD(err: unknown, profundidade = 0): boolean {
  if (!(err instanceof Error) || profundidade > 3) return false;
  const e = err as ErroComCausa;
  if ("query" in e || "params" in e || /^Failed query:/.test(e.message)) return true;
  // pg DatabaseError (erro vindo do servidor Postgres): tem severity e um código SQLSTATE.
  if (typeof e.severity === "string" && typeof e.code === "string") return true;
  return eErroDeBD(e.cause, profundidade + 1);
}

function codigoDoErro(err: unknown, profundidade = 0): string | undefined {
  if (!(err instanceof Error) || profundidade > 3) return undefined;
  const e = err as ErroComCausa;
  return typeof e.code === "string" ? e.code : codigoDoErro(e.cause, profundidade + 1);
}

function redigirErroDeBD(err: Error): Error {
  const redigido = new Error(MSG_ERRO_BD) as Error & { code?: string };
  redigido.name = err.name;
  const code = codigoDoErro(err);
  if (code) redigido.code = code;
  const frames = (err.stack ?? "").split("\n").filter((l) => /^\s+at /.test(l));
  redigido.stack = [`${err.name}: ${MSG_ERRO_BD}`, ...frames].join("\n");
  return redigido;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  hooks: {
    logMethod(args, method) {
      const primeiro = args[0] as unknown;
      if (primeiro instanceof Error) {
        if (eErroDeBD(primeiro)) args[0] = redigirErroDeBD(primeiro) as never;
      } else if (primeiro && typeof primeiro === "object" && (primeiro as { err?: unknown }).err instanceof Error) {
        const o = primeiro as { err: Error };
        if (eErroDeBD(o.err)) args[0] = { ...o, err: redigirErroDeBD(o.err) } as never;
      }
      return method.apply(this, args as never);
    },
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
