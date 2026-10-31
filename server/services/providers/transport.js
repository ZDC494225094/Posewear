import { Agent } from "undici";

const agents = new Map();

export function requestOptions(timeoutMs, connectTimeoutSec = 30) {
  const connectTimeoutMs = Math.min(timeoutMs,
    Math.max(1, Math.min(120, Math.round(Number(connectTimeoutSec) || 30))) * 1000);
  if (!agents.has(connectTimeoutMs)) {
    // fetch's default 10s connection deadline is independent of AbortSignal.
    // The signal below owns the full request, including reading the response.
    agents.set(connectTimeoutMs, new Agent({
      connect: { timeout: connectTimeoutMs }, headersTimeout: 0, bodyTimeout: 0
    }));
  }
  return { dispatcher: agents.get(connectTimeoutMs), signal: AbortSignal.timeout(timeoutMs) };
}
