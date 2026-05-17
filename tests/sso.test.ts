import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import jwt, { type Algorithm } from "jsonwebtoken";
import { verifyToken, consumeToken, registerSsoRoutes, MODULE_SLUG, type SsoConfig } from "../server/auth/sso";

const SECRET = "x".repeat(32);
const cfg: SsoConfig = {
  secret: SECRET,
  baseUrl: "https://operatoros.example",
  apiUrl: "https://operatoros.example/api",
  audience: MODULE_SLUG,
  env: "test",
};

function makeToken(overrides: Record<string, unknown> = {}, signSecret = SECRET, alg: Algorithm = "HS256") {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "operatoros",
    aud: MODULE_SLUG,
    env: "test",
    sub: "user-123",
    user_id: "user-123",
    email: "alice@example.com",
    role: "admin",
    module_slug: MODULE_SLUG,
    plan_slug: "pro",
    organization_id: "acme",
    jti: "jti-" + Math.random().toString(36).slice(2),
    iat: now,
    exp: now + 60,
    ...overrides,
  };
  return jwt.sign(payload, signSecret, { algorithm: alg });
}

describe("SSO verifyToken", () => {
  it("accepts a valid token", () => {
    const r = verifyToken(makeToken(), cfg);
    expect(r.ok).toBe(true);
  });

  it("rejects bad signature", () => {
    const r = verifyToken(makeToken({}, "wrong-secret-wrong-secret"), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("signature_invalid");
  });

  it("rejects wrong audience", () => {
    const r = verifyToken(makeToken({ aud: "other" }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("audience_mismatch");
  });

  it("rejects wrong issuer", () => {
    const r = verifyToken(makeToken({ iss: "evil" }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("issuer_mismatch");
  });

  it("rejects wrong env", () => {
    const r = verifyToken(makeToken({ env: "prod" }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("env_mismatch");
  });

  it("rejects expired token", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = verifyToken(makeToken({ iat: now - 200, exp: now - 100 }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
  });

  it("rejects token older than 90s by iat", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = verifyToken(makeToken({ iat: now - 200, exp: now + 600 }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
  });

  it("rejects future iat beyond skew", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = verifyToken(makeToken({ iat: now + 60, exp: now + 600 }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("clock_skew");
  });

  it("rejects mismatched module_slug", () => {
    const r = verifyToken(makeToken({ module_slug: "other" }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("audience_mismatch");
  });

  it("rejects token missing module_slug entirely", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        iss: "operatoros", aud: MODULE_SLUG, env: "test",
        sub: "u", email: "a@b.com", jti: "j", iat: now, exp: now + 60,
      },
      SECRET, { algorithm: "HS256" },
    );
    const r = verifyToken(token, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("audience_mismatch");
  });
});

describe("SSO consumeToken", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("sends {jti, aud, env} payload to consume endpoint", async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchSpy);
    await consumeToken(cfg, "jti-abc");
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe("https://operatoros.example/api/v1/modules/sso/consume");
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body).toEqual({ jti: "jti-abc", aud: MODULE_SLUG, env: "test" });
  });

  it("returns ok on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: async () => ({}) } as unknown as Response)));
    const r = await consumeToken(cfg, "jti-1");
    expect(r.ok).toBe(true);
  });

  it("maps TOKEN_REPLAYED to consume_failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 409, json: async () => ({ error: "TOKEN_REPLAYED" }) } as unknown as Response)));
    const r = await consumeToken(cfg, "jti-2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("consume_failed");
  });

  it("maps TOKEN_EXPIRED to expired", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 410, json: async () => ({ error: "TOKEN_EXPIRED" }) } as unknown as Response)));
    const r = await consumeToken(cfg, "jti-3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
  });

  it("maps 5xx to sso_consume_unavailable (fail-closed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503, json: async () => ({}) } as unknown as Response)));
    const r = await consumeToken(cfg, "jti-4");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("sso_consume_unavailable");
  });

  it("maps network failure to sso_consume_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const r = await consumeToken(cfg, "jti-5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("sso_consume_unavailable");
  });
});

describe("/sso route", () => {
  function buildApp(routeCfg: SsoConfig | null) {
    const app = express();
    app.use(session({ secret: "test-session-secret", resave: false, saveUninitialized: false }));
    const provisioner = async () => ({ userId: "u1", tenantId: "t1" });
    registerSsoRoutes(app, routeCfg, provisioner);
    return app;
  }

  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns 503 sso_not_configured when MODULE_SSO_SECRET is unset", async () => {
    const app = buildApp(null);
    const res = await request(app).get("/sso?token=anything");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("sso_not_configured");
  });

  it("returns 400 missing_token when token is absent", async () => {
    const app = buildApp(cfg);
    const res = await request(app).get("/sso");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("missing_token");
  });

  it("returns 400 bad_request when token is too large", async () => {
    const app = buildApp(cfg);
    const res = await request(app).get(`/sso?token=${"a".repeat(5000)}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("returns 401 expired for an old token (no consume call)", async () => {
    const app = buildApp(cfg);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const now = Math.floor(Date.now() / 1000);
    const tok = makeToken({ iat: now - 1000, exp: now - 500 });
    const res = await request(app).get(`/sso?token=${tok}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("expired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 401 signature_invalid for tampered token (no consume call)", async () => {
    const app = buildApp(cfg);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const tok = makeToken({}, "different-secret-different");
    const res = await request(app).get(`/sso?token=${tok}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("signature_invalid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 401 consume_failed when upstream replays the jti", async () => {
    const app = buildApp(cfg);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 409, json: async () => ({ error: "TOKEN_REPLAYED" }) } as unknown as Response)));
    const res = await request(app).get(`/sso?token=${makeToken()}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("consume_failed");
  });

  it("returns 502 sso_consume_unavailable when consume endpoint is down", async () => {
    const app = buildApp(cfg);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const res = await request(app).get(`/sso?token=${makeToken()}`);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("sso_consume_unavailable");
  });

  it("happy path: verifies, consumes, mints session, redirects to /", async () => {
    const provisionSpy = vi.fn(async () => ({ userId: "user-uuid-1", tenantId: "tenant-uuid-1" }));
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchSpy);

    const app = express();
    app.use(session({ secret: "test-session-secret", resave: false, saveUninitialized: false }));
    const { registerSsoRoutes: register } = await import("../server/auth/sso");
    register(app, cfg, provisionSpy);

    const tok = makeToken({ jti: "happy-path-jti" });
    const res = await request(app).get(`/sso?token=${tok}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
    expect(cookies).toBeDefined();
    expect(cookies!.some((c) => c.startsWith("connect.sid="))).toBe(true);
    expect(provisionSpy).toHaveBeenCalledWith(expect.objectContaining({
      ssoSubject: "user-123",
      email: "alice@example.com",
      role: "ADMIN",
      organizationId: "acme",
      planSlug: "pro",
    }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const consumeBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(consumeBody).toEqual({ jti: "happy-path-jti", aud: MODULE_SLUG, env: "test" });
  });

  it("never echoes the JWT secret in any response body", async () => {
    const app = buildApp(cfg);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    const res = await request(app).get(`/sso?token=${makeToken()}`);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});

describe("findOrCreateSsoUser concurrent provisioning", () => {
  beforeEach(() => { vi.resetModules(); });

  it("two simultaneous calls for the same new user both succeed, no duplicate member rows", async () => {
    // Simulate two concurrent transactions racing to provision the same brand-new SSO user.
    // Caller A "wins" every insert; caller B sees ON CONFLICT DO NOTHING return empty
    // and falls back to a follow-up SELECT — exactly the race the production code now handles.
    const TENANT_ID = "tenant-shared-uuid";
    const USER_ID = "user-shared-uuid";

    let tenantExists = false;
    let memberExists = false;
    const memberInsertAttempts: number[] = [];

    function makeTx() {
      const tx = {
        insert: (table: { _: { name?: string } } | unknown) => {
          const tableName = (table as { [k: string]: unknown })[
            Object.getOwnPropertySymbols(table as object).find(
              (s) => s.description === "drizzle:Name",
            ) as symbol
          ] as string | undefined;
          return {
            values: (_v: unknown) => ({
              onConflictDoUpdate: (_o: unknown) => ({
                returning: async () => [{ id: USER_ID, email: "alice@example.com" }],
              }),
              onConflictDoNothing: (_o?: unknown) => {
                if (tableName === "tenants") {
                  if (tenantExists) {
                    return { returning: async () => [] };
                  }
                  tenantExists = true;
                  return { returning: async () => [{ id: TENANT_ID, slug: "os-acme" }] };
                }
                if (tableName === "tenant_members") {
                  memberInsertAttempts.push(Date.now());
                  if (memberExists) {
                    return Promise.resolve([]);
                  }
                  memberExists = true;
                  return Promise.resolve([{ id: "member-1" }]);
                }
                return { returning: async () => [] };
              },
            }),
          };
        },
        select: () => ({
          from: (_t: unknown) => ({
            where: async () => (tenantExists ? [{ id: TENANT_ID, slug: "os-acme" }] : []),
          }),
        }),
      };
      return tx;
    }

    vi.doMock("../server/db", () => ({
      db: {
        transaction: async <T,>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>) => fn(makeTx()),
      },
    }));

    const { findOrCreateSsoUser } = await import("../server/auth/sso");

    const input = {
      ssoSubject: "sub-race",
      email: "alice@example.com",
      role: "ADMIN" as const,
      planSlug: "pro",
      organizationId: "acme",
    };

    const [a, b] = await Promise.all([
      findOrCreateSsoUser(input),
      findOrCreateSsoUser(input),
    ]);

    expect(a).toEqual({ userId: USER_ID, tenantId: TENANT_ID });
    expect(b).toEqual({ userId: USER_ID, tenantId: TENANT_ID });
    // Both transactions attempted the membership insert, but only one row was created
    // (the second hits ON CONFLICT DO NOTHING and returns silently).
    expect(memberInsertAttempts.length).toBe(2);
    expect(memberExists).toBe(true);
  });
});
