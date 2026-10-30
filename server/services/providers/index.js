import * as openai from "./openai.js";
import * as mock from "./mock.js";

const providers = { openai, mock };

export function providerFor(channel) {
  const provider = providers[channel.kind];
  if (!provider) throw new Error(`Unknown channel kind: ${channel.kind}`);
  return provider;
}

export { ProviderError, PUBLIC_MESSAGES } from "./errors.js";
