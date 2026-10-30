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
  unavailable: "生成服务暂不可用，请稍后重试。本次点数已退回。",
  internal: "生成过程中出现异常，请稍后重试。本次点数已退回。"
};

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
