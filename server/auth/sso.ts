import type { Express, Request, Response } from "express";
import jwt, { type JwtPayload, type Algorithm } from "jsonwebtoken";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { tenants, tenantMembers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";

export const MODULE_SLUG = "techdeck";
const ISSUER = "operatoros";
const MAX_TOKEN_AGE_SECONDS = 90;
const CLOCK_SKEW_SECONDS = 5;
const MIN_SECRET_LEN = 16;
const ROLE_MAP: Record<string, "OWNER" | "ADMIN" | "TECH" | "CLIENT"> = {
  owner: "OWNER",
  admin: "ADMIN",
  tech: "TECH",
  technician: "TECH",
  member: "TECH",
  client: "CLIENT",
};

export interface SsoConfig {
  secret: string;
  baseUrl: string;
  apiUrl: string;
  audience: string;
  env: string;
}

export interface SsoClaims extends JwtPayload {
  iss: string;
  aud: string;
  env: string;
  sub: string;
  user_id?: string;
  email: string;
  role?: string;
  module_slug: string;
  plan_slug?: string;
  organization_id?: string;
  jti: string;
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { ok: true; claims: SsoClaims }
  | { ok: false; status: number; code: string; message: string };

export type ConsumeResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/**
 * Eagerly validate SSO configuration at module load.
 * - If MODULE_SSO_SECRET is set but invalid, throws (server fails to boot — loud, fails closed).
 * - If MODULE_SSO_SECRET is unset, logs a warning and returns null. /sso then returns 503.
 *   This deviates from the strictest reading of the spec (which would crash boot when missing)
 *   in order to keep the existing email/password+TOTP flow working on instances that have not
 *   yet adopted SSO. There is no silent unsigned launch — verifyToken always requires HS256.
 */
function loadConfigAtStartup(): SsoConfig | null {
  const secret = process.env.MODULE_SSO_SECRET;
  if (!secret) {
    logger.warn(
      "[sso] MODULE_SSO_SECRET is not set — OperatorOS SSO is DISABLED. /sso will return 503.",
    );
    return null;
  }
  if (secret.length < MIN_SECRET_LEN) {
    throw new Error(
      `[sso] MODULE_SSO_SECRET must be at least ${MIN_SECRET_LEN} characters (got ${secret.length}).`,
    );
  }
  const baseUrl = process.env.OPERATOROS_BASE_URL;
  const apiUrl = process.env.OPERATOROS_API_URL;
  const env = process.env.OPERATOROS_SSO_ENV;
  const audience = (process.env.OPERATOROS_SSO_AUDIENCE || MODULE_SLUG).toLowerCase();
  if (!baseUrl) throw new Error("[sso] OPERATOROS_BASE_URL is required when MODULE_SSO_SECRET is set");
  if (!apiUrl) throw new Error("[sso] OPERATOROS_API_URL is required when MODULE_SSO_SECRET is set");
  if (!env) throw new Error("[sso] OPERATOROS_SSO_ENV is required when MODULE_SSO_SECRET is set");
  if (audience !== MODULE_SLUG) {
    throw new Error(`[sso] OPERATOROS_SSO_AUDIENCE must be lowercase '${MODULE_SLUG}', got '${audience}'`);
  }
  logger.info({ env, audience, apiUrl }, "[sso] OperatorOS SSO configured");
  return { secret, baseUrl, apiUrl, audience, env };
}

const startupConfig: SsoConfig | null = loadConfigAtStartup();

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function reject(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ code, message });
}

export function verifyToken(token: string, cfg: SsoConfig): VerifyResult {
  const allowedAlgs: Algorithm[] = ["HS256"];
  let decoded: JwtPayload;
  try {
    const result = jwt.verify(token, cfg.secret, {
      algorithms: allowedAlgs,
      audience: cfg.audience,
      issuer: ISSUER,
      clockTolerance: CLOCK_SKEW_SECONDS,
    });
    if (typeof result === "string") {
      return { ok: false, status: 401, code: "signature_invalid", message: "Token payload is not an object" };
    }
    decoded = result;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const msg = errMessage(err);
    if (name === "TokenExpiredError") {
      return { ok: false, status: 401, code: "expired", message: "Token expired" };
    }
    if (msg.includes("audience")) {
      return { ok: false, status: 401, code: "audience_mismatch", message: "Audience mismatch" };
    }
    if (msg.includes("issuer")) {
      return { ok: false, status: 401, code: "issuer_mismatch", message: "Issuer mismatch" };
    }
    return { ok: false, status: 401, code: "signature_invalid", message: "Invalid signature" };
  }

  const claims = decoded as Partial<SsoClaims>;
  if (!claims.iss || claims.iss !== ISSUER) {
    return { ok: false, status: 401, code: "issuer_mismatch", message: "Issuer mismatch" };
  }
  if (claims.env !== cfg.env) {
    return { ok: false, status: 401, code: "env_mismatch", message: "Environment mismatch" };
  }
  if (!claims.module_slug) {
    return { ok: false, status: 401, code: "audience_mismatch", message: "Missing module_slug claim" };
  }
  if (claims.module_slug.toLowerCase() !== MODULE_SLUG) {
    return { ok: false, status: 401, code: "audience_mismatch", message: "Module slug mismatch" };
  }
  if (!claims.jti || !claims.sub || !claims.email || !claims.iat || !claims.exp) {
    return { ok: false, status: 401, code: "signature_invalid", message: "Missing required claims" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.iat - nowSec > CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, code: "clock_skew", message: "Token issued in the future" };
  }
  if (nowSec - claims.iat > MAX_TOKEN_AGE_SECONDS + CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, code: "expired", message: "Token older than 90 seconds" };
  }
  return { ok: true, claims: claims as SsoClaims };
}

export async function consumeToken(
  cfg: SsoConfig,
  jti: string,
  reqId?: string,
): Promise<ConsumeResult> {
  let response: globalThis.Response;
  try {
    response = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}/v1/modules/sso/consume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Module-Slug": MODULE_SLUG,
        ...(reqId ? { "X-Request-Id": reqId } : {}),
      },
      body: JSON.stringify({ jti, aud: cfg.audience, env: cfg.env }),
    });
  } catch (err) {
    logger.error({ err: errMessage(err) }, "[sso] consume call failed");
    return { ok: false, status: 502, code: "sso_consume_unavailable", message: "Upstream consume endpoint unavailable" };
  }
  if (response.status >= 200 && response.status < 300) {
    return { ok: true };
  }
  let body: { error?: string; code?: string } = {};
  try { body = (await response.json()) as { error?: string; code?: string }; } catch { /* non-JSON */ }
  const upstream = String(body.error || body.code || "");
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

export interface FindOrCreateSsoUserInput {
  ssoSubject: string;
  email: string;
  role: "OWNER" | "ADMIN" | "TECH" | "CLIENT";
  planSlug?: string;
  organizationId?: string;
}

export interface FindOrCreateSsoUserResult {
  userId: string;
  tenantId: string;
}

/**
 * Idempotently provision the SSO user, tenant, and membership.
 * Identity is keyed on ssoSubject (the JWT `sub` claim) — never email — so renames are safe.
 * SSO-provisioned tenants are namespaced with an `os-` slug prefix so a hostile
 * organization_id claim can never collide with a locally-registered tenant.
 */
export async function findOrCreateSsoUser(
  input: FindOrCreateSsoUserInput,
): Promise<FindOrCreateSsoUserResult> {
  const email = input.email.toLowerCase();

  let [userRow] = await db.select().from(users).where(eq(users.ssoSubject, input.ssoSubject));
  if (!userRow) {
    const inserted = await db
      .insert(users)
      .values({ email, ssoSubject: input.ssoSubject })
      .onConflictDoUpdate({
        target: users.ssoSubject,
        set: { updatedAt: new Date() },
      })
      .returning();
    userRow = inserted[0];
  } else if (userRow.email !== email) {
    await db.update(users).set({ email, updatedAt: new Date() }).where(eq(users.id, userRow.id));
  }

  const rawOrg = (input.organizationId || `sub-${input.ssoSubject}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 50);
  const orgSlug = `os-${rawOrg}`;
  let [tenant] = await db.select().from(tenants).where(eq(tenants.slug, orgSlug));
  if (!tenant) {
    const created = await db
      .insert(tenants)
      .values({
        name: input.organizationId || email,
        slug: orgSlug,
        plan: input.planSlug || "free",
      })
      .returning();
    tenant = created[0];
  }

  const member = await db
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userRow.id)));
  if (member.length === 0) {
    await db.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId: userRow.id,
      role: input.role,
    });
  }

  return { userId: userRow.id, tenantId: tenant.id };
}

export function getStartupConfig(): SsoConfig | null {
  return startupConfig;
}

export function registerSsoRoutes(app: Express, cfg: SsoConfig | null = startupConfig) {
  app.get("/sso", async (req: Request, res: Response) => {
    if (!cfg) {
      return reject(res, 503, "sso_not_configured", "OperatorOS SSO is not configured on this instance");
    }

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

    const role = ROLE_MAP[(verified.claims.role || "tech").toLowerCase()] || "TECH";
    let provisioned: FindOrCreateSsoUserResult;
    try {
      provisioned = await findOrCreateSsoUser({
        ssoSubject: verified.claims.sub,
        email: verified.claims.email,
        role,
        planSlug: verified.claims.plan_slug,
        organizationId: verified.claims.organization_id,
      });
    } catch (err) {
      req.log?.error({ err: errMessage(err) }, "[sso] provisioning failed");
      return reject(res, 500, "bad_request", "Failed to provision user");
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log?.error({ err: regenErr.message }, "[sso] session regenerate failed");
        return reject(res, 500, "bad_request", "Session error");
      }
      req.session.userId = provisioned.userId;
      req.session.mfaPending = false;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log?.error({ err: saveErr.message }, "[sso] session save failed");
          return reject(res, 500, "bad_request", "Session error");
        }
        req.log?.info(
          { userId: provisioned.userId, tenantId: provisioned.tenantId, jti: verified.claims.jti },
          "[sso] login success",
        );
        return res.redirect("/");
      });
    });
  });
}
