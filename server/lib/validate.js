import { badRequest } from "./errors.js";

// Small, explicit validators for request input at the trust boundary.
// Each returns the normalized value or throws a 400 with the field name.

export function str(value, field, { min = 0, max = 2000, trim = true, optional = false, pattern, message } = {}) {
  if (value === undefined || value === null) {
    if (optional) return "";
    throw badRequest("INVALID_INPUT", message || `缺少参数：${field}`, { field });
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw badRequest("INVALID_INPUT", message || `参数格式不正确：${field}`, { field });
  }
  let out = String(value);
  if (trim) out = out.trim();
  if (!out && optional) return "";
  if (out.length < min || out.length > max) {
    throw badRequest("INVALID_INPUT", message || `${field} 长度需在 ${min}–${max} 个字符之间`, { field });
  }
  if (pattern && !pattern.test(out)) {
    throw badRequest("INVALID_INPUT", message || `参数格式不正确：${field}`, { field });
  }
  return out;
}

export function int(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false, fallback } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return fallback;
    throw badRequest("INVALID_INPUT", `缺少参数：${field}`, { field });
  }
  const out = Number(value);
  if (!Number.isInteger(out) || out < min || out > max) {
    throw badRequest("INVALID_INPUT", `${field} 需为 ${min} 到 ${max} 之间的整数`, { field });
  }
  return out;
}

export function num(value, field, { min = -Infinity, max = Infinity, optional = false, fallback } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return fallback;
    throw badRequest("INVALID_INPUT", `缺少参数：${field}`, { field });
  }
  const out = Number(value);
  if (!Number.isFinite(out) || out < min || out > max) {
    throw badRequest("INVALID_INPUT", `${field} 需在 ${min} 到 ${max} 之间`, { field });
  }
  return out;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function oneOf(value, field, allowed, { optional = false, fallback } = {}) {
  if ((value === undefined || value === null || value === "") && optional) return fallback;
  if (!allowed.includes(value)) {
    throw badRequest("INVALID_INPUT", `参数取值不正确：${field}`, { field });
  }
  return value;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export function email(value, field = "email") {
  const out = str(value, field, { min: 5, max: 254, message: "请输入有效的邮箱地址" }).toLowerCase();
  if (!EMAIL.test(out)) throw badRequest("INVALID_EMAIL", "请输入有效的邮箱地址", { field });
  return out;
}

export function password(value, field = "password") {
  return str(value, field, { min: 8, max: 128, trim: false, message: "密码长度需为 8–128 个字符" });
}

export function page(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const pageNo = int(query.page, "page", { min: 1, max: 100000, optional: true, fallback: 1 });
  const size = int(query.size, "size", { min: 1, max: maxSize, optional: true, fallback: defaultSize });
  return { page: pageNo, size, offset: (pageNo - 1) * size };
}
