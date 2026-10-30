// Errors thrown from services carry an HTTP status, a stable machine-readable
// code for the client, and a message that is safe to show to end users.
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code, message, extra) => new HttpError(400, code, message, extra);
export const unauthorized = (message = "请先登录") => new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "没有权限执行此操作", code = "FORBIDDEN") => new HttpError(403, code, message);
export const notFound = (message = "内容不存在或已被删除") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (code, message) => new HttpError(409, code, message);
export const tooMany = (message = "操作太频繁，请稍后再试") => new HttpError(429, "RATE_LIMITED", message);
export const paymentRequired = (message, extra) => new HttpError(402, "INSUFFICIENT_CREDITS", message, extra);
