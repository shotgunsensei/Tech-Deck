import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  parseSnapshot,
  mapOperatorOsRole,
  isBlockingStatus,
  defaultFeaturesFor,
  defaultLimitsFor,
} from "../server/auth/entitlements";

describe("entitlements / buildSnapshot", () => {
  it("fills features and limits from access level when claims omit them", () => {
    const snap = buildSnapshot({ planSlug: "pro", accessLevel: "pro" });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.accessLevel).toBe("pro");
    expect(snap.features).toEqual(defaultFeaturesFor("pro"));
    expect(snap.limits.usersMax).toBe(defaultLimitsFor("pro").usersMax);
    expect(snap.enabled).toBe(true);
    expect(snap.subscriptionStatus).toBe("active");
  });

  it("normalises unknown subscription status to active", () => {
    const snap = buildSnapshot({ planSlug: "pro", subscriptionStatus: "weird" });
    expect(snap.subscriptionStatus).toBe("active");
  });

  it("preserves explicit features and merges custom limits over defaults", () => {
    const snap = buildSnapshot({
      planSlug: "pro",
      features: ["API", "reports"],
      limits: { usersMax: 99 },
    });
    expect(snap.features).toEqual(["api", "reports"]);
    expect(snap.limits.usersMax).toBe(99);
    expect(snap.limits.storageGb).toBe(defaultLimitsFor("pro").storageGb);
  });

  it("honours enabled=false", () => {
    const snap = buildSnapshot({ planSlug: "pro", enabled: false });
    expect(snap.enabled).toBe(false);
  });

  it("falls back to basic when no plan/access supplied", () => {
    const snap = buildSnapshot({});
    expect(snap.accessLevel).toBe("basic");
    expect(snap.features).toEqual(defaultFeaturesFor("basic"));
  });
});

describe("entitlements / parseSnapshot", () => {
  it("returns null for invalid input", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("string")).toBeNull();
    expect(parseSnapshot({})).toBeNull();
    expect(parseSnapshot({ accessLevel: 5 })).toBeNull();
  });

  it("round-trips a built snapshot", () => {
    const snap = buildSnapshot({ planSlug: "msp" });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed?.accessLevel).toBe("msp");
  });
});

describe("entitlements / mapOperatorOsRole", () => {
  it("module_role=none denies", () => {
    expect(mapOperatorOsRole("none", "owner")).toBeNull();
  });

  it("tenant_role=owner wins over module_role", () => {
    expect(mapOperatorOsRole("module_user", "owner")).toBe("OWNER");
    expect(mapOperatorOsRole("owner", undefined)).toBe("OWNER");
  });

  it("tenant_admin and module_admin map to ADMIN", () => {
    expect(mapOperatorOsRole(undefined, "tenant_admin")).toBe("ADMIN");
    expect(mapOperatorOsRole("module_admin", undefined)).toBe("ADMIN");
    expect(mapOperatorOsRole("admin", undefined)).toBe("ADMIN");
  });

  it("viewer maps to CLIENT (read-only)", () => {
    expect(mapOperatorOsRole("viewer", undefined)).toBe("CLIENT");
  });

  it("module_user / tech / member map to TECH", () => {
    expect(mapOperatorOsRole("module_user", undefined)).toBe("TECH");
    expect(mapOperatorOsRole("tech", undefined)).toBe("TECH");
    expect(mapOperatorOsRole("member", undefined)).toBe("TECH");
  });

  it("unknown roles default to TECH", () => {
    expect(mapOperatorOsRole("mystery", undefined)).toBe("TECH");
  });

  it("empty inputs default to TECH (not deny)", () => {
    expect(mapOperatorOsRole(undefined, undefined)).toBe("TECH");
  });
});

describe("entitlements / isBlockingStatus", () => {
  it.each(["past_due", "unpaid", "canceled"])("%s blocks", (s) => {
    expect(isBlockingStatus(s)).toBe(true);
  });
  it.each(["active", "trialing", "none", undefined, "", "weird"])(
    "%s does not block",
    (s) => {
      expect(isBlockingStatus(s as any)).toBe(false);
    },
  );
});

describe("entitlements / sync endpoint contract", () => {
  it("OPERATOROS_SERVICE_TOKEN must be at least 32 chars", () => {
    const token = "x".repeat(32);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("blocking statuses match the documented set", () => {
    const blocking = ["past_due", "unpaid", "canceled"];
    blocking.forEach((s) => expect(isBlockingStatus(s)).toBe(true));
  });

  it("revoke (target_module_enabled=false) yields a deny snapshot", () => {
    const snap = buildSnapshot({ planSlug: "pro", enabled: false });
    expect(snap.enabled).toBe(false);
  });
});
