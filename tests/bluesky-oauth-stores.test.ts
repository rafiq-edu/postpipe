import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  requestLock,
  sessionStore,
  stateStore,
} from "../lib/connect/bluesky-oauth";
import { hasDb, testDb } from "./db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasDb)("bluesky oauth stores", () => {
  beforeAll(() => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
  });

  it("state works once", async () => {
    const key = randomUUID();
    await stateStore.set(key, { iss: "https://x", appState: "s1" } as never);
    expect(await stateStore.get(key)).toMatchObject({ appState: "s1" });
    expect(await stateStore.get(key)).toBeUndefined();
  });

  it("an expired state is not returned", async () => {
    const key = randomUUID();
    await stateStore.set(key, { iss: "https://x" } as never);
    const db = await testDb();
    await db
      .from("bluesky_oauth_states")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("key", key);
    expect(await stateStore.get(key)).toBeUndefined();
  });

  it("session roundtrips and is encrypted at rest", async () => {
    const sub = `did:plc:${randomUUID()}`;
    const value = { tokenSet: { access_token: "PLAIN-SECRET" } } as never;
    await sessionStore.set(sub, value);
    expect(await sessionStore.get(sub)).toEqual(value);
    const db = await testDb();
    const { data } = await db
      .from("bluesky_oauth_sessions")
      .select("session_enc")
      .eq("sub", sub)
      .single();
    expect(data?.session_enc).not.toContain("PLAIN-SECRET");
    await sessionStore.del(sub);
    expect(await sessionStore.get(sub)).toBeUndefined();
  });

  it("the lock runs two functions one after the other", async () => {
    const name = randomUUID();
    const log: string[] = [];
    const job = (id: string) => () =>
      Promise.resolve().then(async () => {
        log.push(`${id}:in`);
        await sleep(80);
        log.push(`${id}:out`);
      });
    await Promise.all([
      requestLock(name, job("a")),
      requestLock(name, job("b")),
    ]);
    expect(log[0].endsWith(":in")).toBe(true);
    expect(log[1]).toBe(`${log[0][0]}:out`);
    expect(log).toHaveLength(4);
  });

  it("a holder whose lease ended does not delete the new holder's lock", async () => {
    const name = randomUUID();
    const db = await testDb();
    let rowsWhileB = -1;
    await requestLock(name, async () => {
      await db
        .from("oauth_locks")
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq("name", name);
      void requestLock(name, async () => {
        await sleep(250);
        const { data } = await db
          .from("oauth_locks")
          .select("name")
          .eq("name", name);
        rowsWhileB = data?.length ?? 0;
      });
      await sleep(120); // B takes over; then A leaves
    });
    await sleep(400);
    expect(rowsWhileB).toBe(1);
  });
});
