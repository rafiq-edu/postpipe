import { AsyncLocalStorage } from "node:async_hooks";
import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export class MissingSecret extends Error {
  constructor(name: string) {
    super(`MissingSecret: ${name}, see docs/ops/keys-registry.md`);
    this.name = "MissingSecret";
  }
}

const cache = new Map<string, string>();
let client: SecretsManagerClient | undefined;
const overrideStore = new AsyncLocalStorage<Record<string, string>>();

export function withSecretOverrides<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  // Always a fresh store, even when empty: a global-keys call nested in an org's store must not inherit its keys.
  return overrideStore.run(overrides, fn);
}

export async function getSecret(name: string): Promise<string> {
  const store = overrideStore.getStore();
  if (store && Object.hasOwn(store, name)) {
    // Present but empty means masked: never fall through to the global value.
    if (!store[name]) throw new MissingSecret(name);
    return store[name];
  }
  if ((process.env.SECRETS_SOURCE ?? "env") !== "aws") {
    const value = process.env[name];
    if (!value) throw new MissingSecret(name);
    return value;
  }
  const stage = process.env.STAGE;
  if (!stage) throw new MissingSecret("STAGE");
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  client ??= new SecretsManagerClient({});
  const out = await client
    .send(new GetSecretValueCommand({ SecretId: `postpipe/${stage}/${name}` }))
    .catch((e) => {
      if (e instanceof ResourceNotFoundException) throw new MissingSecret(name);
      throw e;
    });
  if (!out.SecretString) throw new MissingSecret(name);
  cache.set(name, out.SecretString);
  return out.SecretString;
}
