/** 端口与适配器共享的显式成功/失败结果。 */
export type ApiResult<T> =
  { ok: true; data: T | null } | { ok: false; message: string; status?: number }
