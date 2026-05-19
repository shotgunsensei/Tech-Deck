import type { Response, NextFunction } from "express";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { parseSnapshot, isBlockingStatus, type EntitlementSnapshot } from "../../auth/entitlements";

/**
 * OperatorOS is the authority for plans/entitlements (Task #12).
 *
 * Both `requireFeature` and `checkLimit` now read the per-user entitlement
 * snapshot persisted at `users.entitlement_snapshot_json` on every SSO
 * login (or the server-to-server sync endpoint). The legacy lookup that
 * consulted `tenant_subscriptions` + `subscription_plans.limits` has been
 * removed. When a request arrives without a hydrated user (public/license/
 * webhook routes mounted before `isAuthenticated`), enforcement is skipped
 * and the route's own auth layer is responsible.
 */

function getSnapshotFromReq(req: any): EntitlementSnapshot | null {
  const profile = req.user?.profile as Record<string, unknown> | undefined;
  if (!profile) return null;
  return parseSnapshot(profile.entitlementSnapshotJson);
}

import { defaultLimitsFor, type EntitlementLimits } from "../../auth/entitlements";
import { db } from "../../db";
import { users, tenantMembers } from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";

/**
 * Back-compat helper for legacy callers that pass either an Express req
 * (preferred — uses the authenticated user's snapshot) or a raw tenantId
 * (used by public/intake routes with no session). When given a tenantId
 * with no usable per-user snapshot we look up the most recent snapshot
 * belonging to any member of that tenant, then fall back to "basic" tier
 * defaults. Returns the entitlement limits object.
 */
export async function getTenantPlanLimits(
  reqOrTenantId: any | string,
): Promise<EntitlementLimits & Record<string, any>> {
  if (reqOrTenantId && typeof reqOrTenantId === "object" && "user" in reqOrTenantId) {
    const snap = getSnapshotFromReq(reqOrTenantId);
    if (snap) return snap.limits as EntitlementLimits & Record<string, any>;
  }
  const tenantId = typeof reqOrTenantId === "string" ? reqOrTenantId : reqOrTenantId?.tenantCtx?.tenantId;
  if (tenantId) {
    try {
      const rows = await db
        .select({ snapshot: users.entitlementSnapshotJson })
        .from(users)
        .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .where(and(eq(tenantMembers.tenantId, tenantId), isNotNull(users.entitlementSnapshotJson)))
        .limit(1);
      const snap = parseSnapshot(rows[0]?.snapshot);
      if (snap) return snap.limits as EntitlementLimits & Record<string, any>;
    } catch {
      // fall through to defaults
    }
  }
  return defaultLimitsFor("basic") as EntitlementLimits & Record<string, any>;
}

function getCurrentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function requireFeature(feature: "api" | "portal" | "status" | "webhooks" | "reports" | "intake") {
  return async (req: any, res: Response, _next: NextFunction) => {
    const next = _next;
    try {
      const snapshot = getSnapshotFromReq(req);
      // No snapshot → user is from a pre-Task-#12 row that hasn't re-SSO'd
      // yet, OR this route runs before auth. Allow through; downstream auth
      // either blocks or the user will get a fresh snapshot on next login.
      if (!snapshot) return next();

      if (isBlockingStatus(snapshot.subscriptionStatus) || !snapshot.enabled) {
        return res.status(402).json({
          error: "subscription_inactive",
          status: snapshot.subscriptionStatus,
          message: "Your OperatorOS subscription is not active. Manage billing in OperatorOS.",
        });
      }

      if (!snapshot.features.includes(feature)) {
        return res.status(402).json({
          error: "plan_required",
          feature,
          accessLevel: snapshot.accessLevel,
          message: `The ${feature} feature is not included in your current OperatorOS plan.`,
        });
      }

      return next();
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[enforcePlan] requireFeature error");
      return next();
    }
  };
}

export function checkLimit(limitType: "usersMax" | "webhooksMax" | "reportsPerMonth" | "storageGb" | "intakeSpacesMax" | "intakeRequestsPerMonth" | "intakeStorageGb") {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const snapshot = getSnapshotFromReq(req);
      const tenantId = req.tenantCtx?.tenantId;
      if (!snapshot || !tenantId) return next();

      const maxValue = snapshot.limits[limitType] as number | undefined;
      if (!maxValue || maxValue <= 0) return next();

      let currentValue = 0;
      switch (limitType) {
        case "usersMax":
          currentValue = await storage.getMemberCountByTenant(tenantId);
          break;
        case "webhooksMax":
          currentValue = await storage.getWebhookEndpointCountByTenant(tenantId);
          break;
        case "reportsPerMonth": {
          const usage = await storage.getOrCreateUsageCounter(tenantId, getCurrentMonthKey());
          currentValue = usage.reportsGenerated;
          break;
        }
        case "storageGb":
        case "intakeStorageGb": {
          const usage = await storage.getOrCreateUsageCounter(tenantId, getCurrentMonthKey());
          currentValue = Math.ceil(usage.evidenceBytesStored / (1024 * 1024 * 1024));
          break;
        }
        case "intakeSpacesMax":
          currentValue = await storage.getIntakeSpaceCount(tenantId);
          break;
        case "intakeRequestsPerMonth": {
          const usage = await storage.getOrCreateUsageCounter(tenantId, getCurrentMonthKey());
          currentValue = (usage as any).intakeRequestsCreated || 0;
          break;
        }
      }

      if (currentValue >= maxValue) {
        return res.status(402).json({
          error: "plan_limit_reached",
          limit: limitType,
          current: currentValue,
          max: maxValue,
          accessLevel: snapshot.accessLevel,
          message: `You have reached the ${limitType} limit for your OperatorOS plan.`,
        });
      }

      return next();
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[enforcePlan] checkLimit error");
      return next();
    }
  };
}
