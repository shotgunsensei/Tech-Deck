import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { verifyToken, consumeToken, MODULE_SLUG } from "../server/auth/sso";

const SECRET = "x".repeat(32);
const cfg = {
  secret: SECRET,
  baseUrl: "https://operatoros.example",
  apiUrl: "https://operatoros.example/api",
  audience: MODULE_SLUG,
  env: "test",
};

function makeToken(overrides: Record<string, any> = {}, signSecret = SECRET, alg: jwt.Algorithm = "HS256") {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "operatoros",
    aud: MODULE_SLUG,
    env: "test",
    sub: "user-123",
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
});

describe("SSO consumeToken", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns ok on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: async () => ({}) }) as any));
    const r = await consumeToken(cfg, "jti-1");
    expect(r.ok).toBe(true);
  });

  it("maps TOKEN_REPLAYED to consume_failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 409, json: async () => ({ error: "TOKEN_REPLAYED" }) }) as any));
    const r = await consumeToken(cfg, "jti-2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("consume_failed");
  });

  it("maps TOKEN_EXPIRED to expired", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 410, json: async () => ({ error: "TOKEN_EXPIRED" }) }) as any));
    const r = await consumeToken(cfg, "jti-3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
  });

  it("maps 5xx to sso_consume_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503, json: async () => ({}) }) as any));
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
