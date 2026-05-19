import type { Response, NextFunction } from "express";
import { parseSnapshot, isBlockingStatus, type EntitlementSnapshot } from "../../auth/entitlements";
import { storage } from "../../storage";
import { logger } from "../../logger";

const _legacyWarnedTenants = new Set<string>();
function warnLegacyOnce(tenantId: string) {
  if (_legacyWarnedTenants.has(tenantId)) return;
  _legacyWarnedTenants.add(tenantId);
  logger.warn({ tenantId }, "[requireNotPaused] using legacy fallback (snapshot not yet hydrated)");
}

/**
 * Task #12: OperatorOS is the source of truth for subscription status.
 *
 * We block writes when the per-user entitlement snapshot reports a
 * subscription_status of past_due / unpaid / canceled, OR when the
 * snapshot reports the module is disabled for this user. The legacy
 * `tenant_subscriptions.pausedAt` column is no longer consulted —
 * Stripe webhooks still record events for audit but cannot independently
 * pause an account.
 *
 * When no snapshot is present (e.g., this middleware mounted on a route
 * served before authentication, or a legacy local-account user pre-Task-#12),
 * we allow the request through and let downstream auth do its job.
 */
function getSnapshotFromReq(req: any): EntitlementSnapshot | null {
  const profile = req.user?.profile as Record<string, unknown> | undefined;
  if (!profile) return null;
  return parseSnapshot(profile.entitlementSnapshotJson);
}

export function requireNotPaused() {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const snapshot = getSnapshotFromReq(req);
      if (!snapshot) {
        // Legacy fallback so we don't fail open for pre-Task-#12 users.
        const tenantId = req.tenantCtx?.tenantId;
        if (!tenantId) return next();
        try {
          const sub = await storage.getTenantSubscription(tenantId);
          if (!sub) return next();
          warnLegacyOnce(tenantId);
          const status = (sub.status || "").toLowerCase();
          if (["past_due", "unpaid", "canceled"].includes(status) || (sub as any).pausedAt) {
            return res.status(402).json({
              error: "subscription_inactive",
              status,
              message: "Your subscription is not active. Manage billing in OperatorOS.",
            });
          }
          return next();
        } catch {
          return next();
        }
      }
      if (snapshot.enabled === false) {
        return res.status(402).json({
          error: "module_access_denied",
          message: "Access to Tech Deck is disabled for your OperatorOS account.",
        });
      }
      if (isBlockingStatus(snapshot.subscriptionStatus)) {
        return res.status(402).json({
          error: "subscription_inactive",
          status: snapshot.subscriptionStatus,
          accessLevel: snapshot.accessLevel,
          message: "Your OperatorOS subscription is not active. Manage billing in OperatorOS to restore access.",
        });
      }
      return next();
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[requireNotPaused] error");
      return next();
    }
  };
}
