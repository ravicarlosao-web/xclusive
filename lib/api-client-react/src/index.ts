export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthTokenGetter,
  setTokenRefreshHandler,
  setOnTokenRefreshed,
  setOnSessionExpired,
  executeTokenRefresh,
  getFreshAuthToken,
  customFetch,
} from "./custom-fetch";
export type {
  AuthTokenGetter,
  TokenRefreshHandler,
  TokenRefreshedCallback,
  SessionExpiredCallback,
  CustomFetchOptions,
  ErrorType,
  BodyType,
} from "./custom-fetch";
export { ApiError } from "./custom-fetch";
