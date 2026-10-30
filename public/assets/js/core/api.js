// JSON API client: sends the CSRF header on writes and turns error bodies
// into ApiError with the server's code and user-facing message.
export class ApiError extends Error {
  constructor(status, code, message, data = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)pw_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

const listeners = new Set();
export const onUnauthorized = (fn) => listeners.add(fn);

async function request(method, path, { body, query, form } = {}) {
  let url = path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, v);
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const headers = { Accept: "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK", "网络连接失败，请检查网络后重试");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = data?.error || {};
    const error = new ApiError(res.status, err.code || `HTTP_${res.status}`, err.message || `请求失败（${res.status}）`, err);
    if (res.status === 401) listeners.forEach((fn) => fn(error));
    throw error;
  }
  return data;
}

export const api = {
  get: (path, query) => request("GET", path, { query }),
  post: (path, body) => request("POST", path, { body: body ?? {} }),
  put: (path, body) => request("PUT", path, { body: body ?? {} }),
  patch: (path, body) => request("PATCH", path, { body: body ?? {} }),
  del: (path) => request("DELETE", path),
  upload: (path, form) => request("POST", path, { form })
};
