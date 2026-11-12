export * from "./generated/api";
export * from "./generated/types";
// GetUserPostsParams e GetMessagesParams existem nos dois módulos (parâmetros de caminho em zod e de pesquisa em tipos): prevalece o schema zod.
export { GetUserPostsParams, GetMessagesParams } from "./generated/api";
