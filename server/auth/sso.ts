import type { Express, Request, Response } from "express";
import jwt, { type JwtPayload, type Algorithm } from "jsonwebtoken";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { tenants, tenantMembers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { renderSsoErrorPage, ssoErrorPageOptionsFromRequest } from "./ssoErrorPage";
import {
  buildSnapshot,
  mapOperatorOsRole,
  type EntitlementSnapshot,
  type EntitlementLimits,
  type LocalRole,
} from "./entitlements";

export const MODULE_SLUG = "techdeck";
const ISSUER = "operatoros";
const MAX_TOKEN_AGE_SECONDS = 90;
const CLOCK_SKEW_SECONDS = 5;
const MIN_SECRET_LEN = 16;
const MIN_SERVICE_TOKEN_LEN = 32;

const CHILD_APP_MODULE_KEY = (process.env.CHILD_APP_MODULE_KEY || MODULE_SLUG).toLowerCase();

export interface SsoConfig {
  secret: string;
  baseUrl: string;
  apiUrl: string;
  audience: string;
  env: string;
  moduleKey: string;
}

export interface SsoClaims extends JwtPayload {
  iss: string;
  aud: string;
  env: string;
  sub: string;
  user_id?: string;
  email: string;
  name?: string;
  role?: string;
  module_slug: string;
  plan_slug?: string;
  organization_id?: string;
  lang?: string;
  jti: string;
  iat: number;
  exp: number;
  // OperatorOS entitlement claims (Task #12).
  target_module_key?: string;
  target_module_enabled?: boolean;
  target_module_access_level?: string;
  target_module_features?: string[];
  target_module_limits?: EntitlementLimits;
  module_role?: string;
  tenant_role?: string;
  subscription_status?: string;
}

export type VerifyResult =
  | { ok: true; claims: SsoClaims }
  | { ok: false; status: number; code: string; message: string };

export type ConsumeResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/**
 * Eagerly validate SSO configuration at module load.
 * - If MODULE_SSO_SECRET is set but invalid → throw (server fails to boot, fails closed).
 * - If MODULE_SSO_SECRET is unset AND MODULE_SSO_DISABLED is not "true" → throw
 *   (default-secure: instances adopting SSO MUST configure it explicitly).
 * - If MODULE_SSO_DISABLED=true → log a warning and return null; /sso then returns 503.
 *
 * Task #12 additions:
 * - OPERATOROS_SERVICE_TOKEN is required when SSO is enabled (>= 32 chars).
 *   It authenticates the server-to-server entitlement sync endpoint.
 * - CHILD_APP_MODULE_KEY (default "techdeck") names the module this app binds to.
 */
function loadConfigAtStartup(): SsoConfig | null {
  const secret = process.env.MODULE_SSO_SECRET;
  const disabled = process.env.MODULE_SSO_DISABLED === "true";
  if (!secret) {
    if (!disabled) {
      throw new Error(
        "[sso] MODULE_SSO_SECRET is required. To explicitly disable SSO on this instance, " +
        "set MODULE_SSO_DISABLED=true.",
      );
    }
    logger.warn(
      "[sso] MODULE_SSO_DISABLED=true — OperatorOS SSO is DISABLED. /sso will return 503.",
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
  const serviceToken = process.env.OPERATOROS_SERVICE_TOKEN;
  if (!baseUrl) throw new Error("[sso] OPERATOROS_BASE_URL is required when MODULE_SSO_SECRET is set");
  if (!apiUrl) throw new Error("[sso] OPERATOROS_API_URL is required when MODULE_SSO_SECRET is set");
  if (!env) throw new Error("[sso] OPERATOROS_SSO_ENV is required when MODULE_SSO_SECRET is set");
  if (audience !== MODULE_SLUG) {
    throw new Error(`[sso] OPERATOROS_SSO_AUDIENCE must be lowercase '${MODULE_SLUG}', got '${audience}'`);
  }
  if (!serviceToken) {
    throw new Error(
      "[sso] OPERATOROS_SERVICE_TOKEN is required when MODULE_SSO_SECRET is set. " +
      "It authenticates POST /api/operatoros/entitlements/sync from OperatorOS.",
    );
  }
  if (serviceToken.length < MIN_SERVICE_TOKEN_LEN) {
    throw new Error(
      `[sso] OPERATOROS_SERVICE_TOKEN must be at least ${MIN_SERVICE_TOKEN_LEN} characters (got ${serviceToken.length}).`,
    );
  }
  logger.info({ env, audience, apiUrl, moduleKey: CHILD_APP_MODULE_KEY }, "[sso] OperatorOS SSO configured");
  return { secret, baseUrl, apiUrl, audience, env, moduleKey: CHILD_APP_MODULE_KEY };
}

const startupConfig: SsoConfig | null = loadConfigAtStartup();

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function wantsHtml(req: Request): boolean {
  const accept = req.headers.accept;
  if (typeof accept !== "string" || accept.length === 0) return false;
  const best = req.accepts(["application/json", "text/html"]);
  return best === "text/html";
}

function reject(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  cfg: SsoConfig | null,
  claimLang?: string,
) {
  // Browser-friendly redirect for module_access_denied — we route to a public
  // SPA page rather than rendering a translated error card, so the user lands
  // in a fully-styled "managed by OperatorOS" experience.
  if (code === "module_access_denied" && wantsHtml(req)) {
    return res.redirect(303, "/access-denied");
  }
  if (wantsHtml(req)) {
    const baseOpts = ssoErrorPageOptionsFromRequest(req);
    const opts = claimLang ? { ...baseOpts, langOverride: claimLang } : baseOpts;
    const html = renderSsoErrorPage(code, message, cfg?.baseUrl, opts);
    res.status(status).type("html").send(html);
    return;
  }
  return res.status(status).json({ code, message });
}

function logSsoOutcome(
  req: Request,
  outcome: "accept" | "reject",
  code: string,
  ctx: { jti?: string | null; sub?: string | null; userId?: string; tenantId?: string; err?: string } = {},
) {
  const payload = {
    outcome,
    code,
    jti: ctx.jti ?? "<unverified>",
    sub: ctx.sub ?? "<unverified>",
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
    ...(ctx.err ? { err: ctx.err } : {}),
  };
  if (outcome === "accept") req.log?.info(payload, "[sso] outcome");
  else req.log?.warn(payload, "[sso] outcome");
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

  // Task #12: enforce module entitlement claims. `target_module_key` is the
  // new authoritative claim; we accept tokens without it for rollout-compat
  // but require it to match this app when present. `target_module_enabled`
  // and `module_role` together decide whether the user may enter.
  if (typeof claims.target_module_key === "string") {
    if (claims.target_module_key.toLowerCase() !== cfg.moduleKey) {
      return { ok: false, status: 401, code: "audience_mismatch", message: "Target module key mismatch" };
    }
  }
  const moduleEnabledClaim = claims.target_module_enabled;
  const moduleRoleClaim = (claims.module_role || "").toLowerCase();
  // Reject when the claim is explicitly false, OR when module_role is "none".
  // Absence of the claim is permitted (legacy rollout) — only an explicit
  // negative answer denies.
  if (moduleEnabledClaim === false || moduleRoleClaim === "none") {
    return {
      ok: false,
      status: 401,
      code: "module_access_denied",
      message: "Access to this module is managed by OperatorOS",
    };
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
  role: LocalRole;
  planSlug?: string;
  organizationId?: string;
  operatorosUserId?: string;
  snapshot: EntitlementSnapshot;
}

export interface FindOrCreateSsoUserResult {
  userId: string;
  tenantId: string;
}

/**
 * Idempotently provision the SSO user, tenant, and membership, AND persist
 * the OperatorOS entitlement snapshot atomically inside the same transaction.
 *
 * Lookup order:
 *   1. users.operatoros_user_id (new key, preferred)
 *   2. users.sso_subject        (legacy key, fallback for pre-Task-#12 rows)
 *
 * On every login the snapshot, local_role, and last_entitlement_sync_at
 * are overwritten — OperatorOS is the source of truth, so the latest
 * answer wins.
 */
export async function findOrCreateSsoUser(
  input: FindOrCreateSsoUserInput,
): Promise<FindOrCreateSsoUserResult> {
  const email = input.email.toLowerCase();
  const rawOrg = (input.organizationId || `sub-${input.ssoSubject}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 50);
  const orgSlug = `os-${rawOrg}`;
  const now = new Date();

  return await db.transaction(async (tx) => {
    // 1) Look up by operatoros_user_id first (Task #12 preferred key).
    let userRow: typeof users.$inferSelect | undefined;
    if (input.operatorosUserId) {
      const found = await tx
        .select()
        .from(users)
        .where(eq(users.operatorosUserId, input.operatorosUserId));
      userRow = found[0];
    }
    // 2) Fall back to sso_subject for legacy rows.
    if (!userRow) {
      const found = await tx
        .select()
        .from(users)
        .where(eq(users.ssoSubject, input.ssoSubject));
      userRow = found[0];
    }

    const sharedUserFields = {
      email,
      ssoRole: input.role,
      ssoPlanSlug: input.planSlug,
      ssoOrganizationId: input.organizationId,
      operatorosUserId: input.operatorosUserId ?? null,
      operatorosTenantId: input.organizationId ?? null,
      localRole: input.role,
      lastEntitlementSyncAt: now,
      entitlementSnapshotJson: input.snapshot,
      revokedAt: null,
      updatedAt: now,
    };

    if (userRow) {
      const updated = await tx
        .update(users)
        .set({ ...sharedUserFields, ssoSubject: input.ssoSubject })
        .where(eq(users.id, userRow.id))
        .returning();
      userRow = updated[0];
    } else {
      // First time we've ever seen this user. Insert with ON CONFLICT so two
      // concurrent /sso redirects for a brand-new user can't race into a
      // unique-constraint violation on sso_subject.
      const inserted = await tx
        .insert(users)
        .values({
          email,
          ssoSubject: input.ssoSubject,
          ...sharedUserFields,
        })
        .onConflictDoUpdate({
          target: users.ssoSubject,
          set: sharedUserFields,
        })
        .returning();
      userRow = inserted[0];
    }

    // Tenants: insert-or-select on the unique slug.
    const insertedTenants = await tx
      .insert(tenants)
      .values({
        name: input.organizationId || email,
        slug: orgSlug,
        plan: input.snapshot.accessLevel,
      })
      .onConflictDoNothing({ target: tenants.slug })
      .returning();
    let tenant = insertedTenants[0];
    if (!tenant) {
      const existing = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.slug, orgSlug));
      tenant = existing[0];
    }
    if (!tenant) {
      throw new Error("[sso] failed to load tenant after upsert");
    }

    // Membership: insert-or-update role on the (tenant_id, user_id) unique index.
    await tx
      .insert(tenantMembers)
      .values({
        tenantId: tenant.id,
        userId: userRow!.id,
        role: input.role,
      })
      .onConflictDoUpdate({
        target: [tenantMembers.tenantId, tenantMembers.userId],
        set: { role: input.role },
      });

    return { userId: userRow!.id, tenantId: tenant.id };
  });
}

export function getStartupConfig(): SsoConfig | null {
  return startupConfig;
}

export { mapOperatorOsRole } from "./entitlements";

export function registerSsoRoutes(
  app: Express,
  cfg: SsoConfig | null = startupConfig,
  provisioner: (input: FindOrCreateSsoUserInput) => Promise<FindOrCreateSsoUserResult> = findOrCreateSsoUser,
) {
  app.get("/sso", async (req: Request, res: Response) => {
    if (!cfg) {
      logSsoOutcome(req, "reject", "sso_not_configured");
      return reject(req, res, 503, "sso_not_configured", "OperatorOS SSO is not configured on this instance", cfg);
    }

    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      logSsoOutcome(req, "reject", "missing_token");
      return reject(req, res, 400, "missing_token", "Missing token query parameter", cfg);
    }
    if (token.length > 4096) {
      logSsoOutcome(req, "reject", "bad_request");
      return reject(req, res, 400, "bad_request", "Token too large", cfg);
    }

    const verified = verifyToken(token, cfg);
    if (!verified.ok) {
      logSsoOutcome(req, "reject", verified.code);
      return reject(req, res, verified.status, verified.code, verified.message, cfg);
    }

    const claimLang = typeof verified.claims.lang === "string" ? verified.claims.lang : undefined;

    const consumed = await consumeToken(cfg, verified.claims.jti, req.requestId);
    if (!consumed.ok) {
      logSsoOutcome(req, "reject", consumed.code, { jti: verified.claims.jti, sub: verified.claims.sub });
      return reject(req, res, consumed.status, consumed.code, consumed.message, cfg, claimLang);
    }

    const localRole = mapOperatorOsRole(verified.claims.module_role, verified.claims.tenant_role);
    if (!localRole) {
      logSsoOutcome(req, "reject", "module_access_denied", {
        jti: verified.claims.jti, sub: verified.claims.sub,
      });
      return reject(req, res, 401, "module_access_denied",
        "Access to this module is managed by OperatorOS", cfg, claimLang);
    }

    const snapshot = buildSnapshot({
      planSlug: verified.claims.plan_slug,
      subscriptionStatus: verified.claims.subscription_status,
      accessLevel: verified.claims.target_module_access_level || verified.claims.plan_slug,
      features: verified.claims.target_module_features,
      limits: verified.claims.target_module_limits,
      moduleRole: verified.claims.module_role,
      tenantRole: verified.claims.tenant_role,
      organizationId: verified.claims.organization_id,
      operatorosUserId: verified.claims.user_id,
      enabled: verified.claims.target_module_enabled !== false,
    });

    let provisioned: FindOrCreateSsoUserResult;
    try {
      provisioned = await provisioner({
        ssoSubject: verified.claims.sub,
        email: verified.claims.email,
        role: localRole,
        planSlug: verified.claims.plan_slug,
        organizationId: verified.claims.organization_id,
        operatorosUserId: verified.claims.user_id,
        snapshot,
      });
    } catch (err) {
      logSsoOutcome(req, "reject", "server_error", {
        jti: verified.claims.jti, sub: verified.claims.sub, err: errMessage(err),
      });
      return reject(req, res, 500, "server_error", "Failed to provision user", cfg, claimLang);
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logSsoOutcome(req, "reject", "server_error", {
          jti: verified.claims.jti, sub: verified.claims.sub, err: regenErr.message,
        });
        return reject(req, res, 500, "server_error", "Session error", cfg, claimLang);
      }
      req.session.userId = provisioned.userId;
      req.session.mfaPending = false;
      req.session.save((saveErr) => {
        if (saveErr) {
          logSsoOutcome(req, "reject", "server_error", {
            jti: verified.claims.jti, sub: verified.claims.sub, err: saveErr.message,
          });
          return reject(req, res, 500, "server_error", "Session error", cfg, claimLang);
        }
        logSsoOutcome(req, "accept", "ok", {
          jti: verified.claims.jti,
          sub: verified.claims.sub,
          userId: provisioned.userId,
          tenantId: provisioned.tenantId,
        });
        return res.redirect("/");
      });
    });
  });
}
