// How the worker reacts to a provider failure:
// - "user": the request itself was rejected (moderation, invalid prompt). Fail
//   the job and refund; retrying or switching channels would not help.
// - "channel": this channel is misconfigured or out of quota. Try the next one.
// - "transient": rate limit, timeout, 5xx. Try the next channel, then retry later.
export class ProviderError extends Error {
  constructor(kind, message, { status = 0, code = "", detail = "", publicMessage = "" } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.publicMessage = publicMessage;
  }
}

export const PUBLIC_MESSAGES = {
  moderation: "内容未通过模型的安全审核，请调整描述或参考图后重试。本次点数已退回。",
  rejected: "模型无法处理这次请求，请调整描述或参考图后重试。本次点数已退回。",
  busy: "生成服务暂时繁忙，请稍后重试。本次点数已退回。",
  network: "无法连接生成服务，请稍后重试或联系管理员。本次点数已退回。",
  connectTimeout: "连接生成服务超时，请稍后重试。本次点数已退回。",
  timeout: "等待生成服务响应超时，请稍后重试。本次点数已退回。",
  unavailable: "生成服务暂不可用，请稍后重试。本次点数已退回。",
  internal: "生成过程中出现异常，请稍后重试。本次点数已退回。"
};

export function classifyTransportError(err, timeoutMs) {
  if (err instanceof ProviderError) return err;
  const cause = err?.cause || err;
  const code = cause?.code || cause?.errors?.[0]?.code || "";
  const detail = JSON.stringify({ name: err?.name, code, message: err?.message,
    cause: err?.cause?.message, errors: cause?.errors?.map((e) => ({ code: e.code, address: e.address, port: e.port })),
    timeoutMs });
  if (code === "UND_ERR_CONNECT_TIMEOUT") {
    return new ProviderError("transient", `Connection timed out: ${code}`, {
      code: "CONNECT_TIMEOUT", detail, publicMessage: PUBLIC_MESSAGES.connectTimeout
    });
  }
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || /UND_ERR_(HEADERS|BODY)_TIMEOUT/.test(code)) {
    return new ProviderError("transient", `Request timed out after ${Math.round(timeoutMs / 1000)}s`, {
      code: "TIMEOUT", detail, publicMessage: PUBLIC_MESSAGES.timeout
    });
  }
  return new ProviderError("transient", `Network error: ${code || err?.message || err}`, {
    code: "NETWORK", detail, publicMessage: PUBLIC_MESSAGES.network
  });
}

export function summarizeFailures(errors) {
  const transient = errors.filter((e) => e.kind === "transient");
  const last = errors.at(-1);
  const relevant = transient.at(-1) || last;
  return {
    code: last?.kind === "channel" ? "CHANNEL_ERROR" : "UPSTREAM_ERROR",
    publicMessage: relevant?.publicMessage || (transient.length ? PUBLIC_MESSAGES.busy : PUBLIC_MESSAGES.unavailable),
    detail: JSON.stringify(errors)
  };
}

export function classifyHttpError(status, json, raw) {
  const err = (json && typeof json === "object" && json.error) || {};
  const code = String(err.code || err.type || `HTTP_${status}`);
  const message = String(err.message || (typeof raw === "string" ? raw.slice(0, 300) : "") || `HTTP ${status}`);
  const haystack = `${code} ${message}`;
  const detail = JSON.stringify({ status, code, message, moderation: err.moderation_details || undefined }).slice(0, 2000);

  if (/moderation_blocked|content_policy|safety system|safety_violation|moderation/i.test(haystack)) {
    return new ProviderError("user", message, { status, code: "moderation_blocked", detail, publicMessage: PUBLIC_MESSAGES.moderation });
  }
  // Out of credit on this key or relay account: whatever the status code
  // (relays use 400, 402, 403 or 429 for this), switch to the next channel.
  if (status === 402 || /insufficient_quota|insufficient_balance|quota|billing|balance|余额|额度|欠费/i.test(haystack)) {
    return new ProviderError("channel", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.unavailable });
  }
  if (status === 401 || status === 403 || status === 404) {
    return new ProviderError("channel", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.unavailable });
  }
  if (status === 429) {
    return new ProviderError("transient", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.busy });
  }
  if (status === 400 || status === 422 || status === 413) {
    // Parameter and model errors mean the channel is set up wrong for this
    // endpoint (e.g. a relay that rejects `moderation`), not that the user erred.
    if (/unknown parameter|unrecognized|unsupported|not supported|invalid model|model.*(not found|does not exist)|no such model|invalid_api_key/i.test(haystack)) {
      return new ProviderError("channel", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.unavailable });
    }
    return new ProviderError("user", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.rejected });
  }
  return new ProviderError("transient", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.busy });
}
