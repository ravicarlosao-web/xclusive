export * from "./generated/api";
export * from "./generated/types";
// GetUserPostsParams existe nos dois módulos (parâmetros de caminho em zod e de pesquisa em tipos): prevalece o schema zod.
export { GetUserPostsParams } from "./generated/api";
