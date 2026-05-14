import type { Express, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { tenants, tenantMembers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";

export const MODULE_SLUG = "techdeck";
const MAX_TOKEN_AGE_SECONDS = 90;
const CLOCK_SKEW_SECONDS = 5;
const ROLE_MAP: Record<string, "OWNER" | "ADMIN" | "TECH" | "CLIENT"> = {
  owner: "OWNER",
  admin: "ADMIN",
  tech: "TECH",
  technician: "TECH",
  member: "TECH",
  client: "CLIENT",
};

interface SsoConfig {
  secret: string;
  baseUrl: string;
  apiUrl: string;
  audience: string;
  env: string;
}

interface SsoClaims extends JwtPayload {
  iss: string;
  aud: string;
  env: string;
  sub: string;
  user_id?: string;
  email: string;
  role?: string;
  module_slug?: string;
  plan_slug?: string;
  organization_id?: string;
  jti: string;
  iat: number;
  exp: number;
}

function getConfig(): SsoConfig | null {
  const secret = process.env.MODULE_SSO_SECRET;
  if (!secret) return null;
  if (secret.length < 16) {
    throw new Error("MODULE_SSO_SECRET must be at least 16 characters");
  }
  const baseUrl = process.env.OPERATOROS_BASE_URL;
  const apiUrl = process.env.OPERATOROS_API_URL;
  const audience = process.env.OPERATOROS_SSO_AUDIENCE || MODULE_SLUG;
  const env = process.env.OPERATOROS_SSO_ENV;
  if (!baseUrl || !apiUrl || !env) {
    throw new Error(
      "OperatorOS SSO requires OPERATOROS_BASE_URL, OPERATOROS_API_URL, and OPERATOROS_SSO_ENV when MODULE_SSO_SECRET is set",
    );
  }
  if (audience.toLowerCase() !== MODULE_SLUG) {
    throw new Error(`OPERATOROS_SSO_AUDIENCE must be '${MODULE_SLUG}'`);
  }
  return { secret, baseUrl, apiUrl, audience, env };
}

let cachedConfig: SsoConfig | null | undefined;
function config(): SsoConfig | null {
  if (cachedConfig === undefined) cachedConfig = getConfig();
  return cachedConfig;
}

function reject(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: code, message });
}

export function verifyToken(token: string, cfg: SsoConfig):
  | { ok: true; claims: SsoClaims }
  | { ok: false; status: number; code: string; message: string } {
  let decoded: SsoClaims;
  try {
    decoded = jwt.verify(token, cfg.secret, {
      algorithms: ["HS256"],
      audience: cfg.audience,
      clockTolerance: CLOCK_SKEW_SECONDS,
    }) as SsoClaims;
  } catch (err: any) {
    if (err?.name === "TokenExpiredError") {
      return { ok: false, status: 401, code: "expired", message: "Token expired" };
    }
    if (err?.message?.includes("audience")) {
      return { ok: false, status: 401, code: "audience_mismatch", message: "Audience mismatch" };
    }
    return { ok: false, status: 401, code: "signature_invalid", message: "Invalid signature" };
  }

  if (!decoded.iss || decoded.iss !== "operatoros") {
    return { ok: false, status: 401, code: "issuer_mismatch", message: "Issuer mismatch" };
  }
  if (decoded.env !== cfg.env) {
    return { ok: false, status: 401, code: "env_mismatch", message: "Environment mismatch" };
  }
  if (!decoded.jti || !decoded.sub || !decoded.email || !decoded.iat || !decoded.exp) {
    return { ok: false, status: 401, code: "signature_invalid", message: "Missing required claims" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (decoded.iat - nowSec > CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, code: "clock_skew", message: "Token issued in the future" };
  }
  if (nowSec - decoded.iat > MAX_TOKEN_AGE_SECONDS + CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, code: "expired", message: "Token older than 90 seconds" };
  }
  if (decoded.module_slug && decoded.module_slug.toLowerCase() !== MODULE_SLUG) {
    return { ok: false, status: 401, code: "audience_mismatch", message: "Module slug mismatch" };
  }
  return { ok: true, claims: decoded };
}

export async function consumeToken(
  cfg: SsoConfig,
  jti: string,
  reqId?: string,
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  let response: globalThis.Response;
  try {
    response = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}/v1/modules/sso/consume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Module-Slug": MODULE_SLUG,
        ...(reqId ? { "X-Request-Id": reqId } : {}),
      },
      body: JSON.stringify({ jti, module_slug: MODULE_SLUG }),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[sso] consume call failed");
    return { ok: false, status: 502, code: "sso_consume_unavailable", message: "Upstream consume endpoint unavailable" };
  }
  if (response.status >= 200 && response.status < 300) {
    return { ok: true };
  }
  let body: any = {};
  try { body = await response.json(); } catch { /* ignore */ }
  const upstream = String(body?.error || body?.code || "");
  const map: Record<string, { status: number; code: string }> = {
    TOKEN_UNKNOWN: { status: 401, code: "consume_failed" },
    TOKEN_REPLAYED: { status: 401, code: "consume_failed" },
    TOKEN_EXPIRED: { status: 401, code: "expired" },
    AUDIENCE_MISMATCH: { status: 401, code: "audience_mismatch" },
    ENV_MISMATCH: { status: 401, code: "env_mismatch" },
  };
  const mapped = map[upstream];
  if (mapped) return { ok: false, ...mapped, message: `Consume rejected: ${upstream}` };
  if (response.status >= 500) {
    return { ok: false, status: 502, code: "sso_consume_unavailable", message: "Upstream consume error" };
  }
  return { ok: false, status: 401, code: "consume_failed", message: "Consume rejected" };
}

async function provisionUserAndTenant(claims: SsoClaims): Promise<{ userId: string }> {
  const email = claims.email.toLowerCase();
  const role = ROLE_MAP[(claims.role || "tech").toLowerCase()] || "TECH";

  const existing = await db.select().from(users).where(eq(users.email, email));
  let userRow = existing[0];
  if (!userRow) {
    const [created] = await db
      .insert(users)
      .values({ email, firstName: null, lastName: null })
      .returning();
    userRow = created;
  }

  const rawOrg = (claims.organization_id || `sub-${claims.sub}`).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);
  const orgSlug = `os-${rawOrg}`;
  let [tenant] = await db.select().from(tenants).where(eq(tenants.slug, orgSlug));
  if (!tenant) {
    const [created] = await db
      .insert(tenants)
      .values({ name: claims.organization_id || email, slug: orgSlug, plan: claims.plan_slug || "free" })
      .returning();
    tenant = created;
  }

  const member = await db
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userRow.id)));
  if (member.length === 0) {
    await db.insert(tenantMembers).values({ tenantId: tenant.id, userId: userRow.id, role: role as any });
  }
  return { userId: userRow.id };
}

export function registerSsoRoutes(app: Express) {
  app.get("/sso", async (req: Request, res: Response) => {
    const cfg = (() => {
      try { return config(); }
      catch (err) {
        logger.error({ err: (err as Error).message }, "[sso] misconfiguration");
        return "error" as const;
      }
    })();
    if (cfg === "error") return reject(res, 500, "sso_misconfigured", "SSO is misconfigured");
    if (!cfg) return reject(res, 503, "sso_not_configured", "OperatorOS SSO is not configured on this instance");

    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return reject(res, 400, "missing_token", "Missing token query parameter");
    if (token.length > 4096) return reject(res, 400, "bad_request", "Token too large");

    const verified = verifyToken(token, cfg);
    if (!verified.ok) {
      req.log?.warn({ code: verified.code }, "[sso] token verification failed");
      return reject(res, verified.status, verified.code, verified.message);
    }

    const consumed = await consumeToken(cfg, verified.claims.jti, req.requestId);
    if (!consumed.ok) {
      req.log?.warn({ code: consumed.code, jti: verified.claims.jti }, "[sso] consume failed");
      return reject(res, consumed.status, consumed.code, consumed.message);
    }

    let userId: string;
    try {
      const result = await provisionUserAndTenant(verified.claims);
      userId = result.userId;
    } catch (err) {
      req.log?.error({ err: (err as Error).message }, "[sso] provisioning failed");
      return reject(res, 500, "provision_failed", "Failed to provision user");
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log?.error({ err: regenErr.message }, "[sso] session regenerate failed");
        return reject(res, 500, "session_failed", "Session error");
      }
      (req.session as any).userId = userId;
      (req.session as any).mfaPending = false;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log?.error({ err: saveErr.message }, "[sso] session save failed");
          return reject(res, 500, "session_failed", "Session error");
        }
        req.log?.info({ userId, jti: verified.claims.jti }, "[sso] login success");
        return res.redirect("/");
      });
    });
  });
}
