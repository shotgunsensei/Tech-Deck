import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("tenant isolation invariant", () => {
  it("keeps operations lookups, joins, and mutations scoped to the authenticated tenant", () => {
    const routes = source("server/modules/operations/routes.ts");
    expect(routes).toContain("eq(configurationItems.tenantId, tenantId)");
    expect(routes).toContain("eq(documentationPages.tenantId, tenantId)");
    expect(routes).toContain("eq(documentationFolders.tenantId, tenantId)");
    expect(routes).toContain("eq(clients.tenantId, req.tenantCtx.tenantId)");
    expect(routes).toContain("eq(sites.tenantId, req.tenantCtx.tenantId)");
  });

  it("ships a database-backed two-tenant denial suite", () => {
    const integration = source("tests/operations.integration.test.ts");
    expect(integration).toContain("denies cross-tenant record access");
    expect(integration).toContain("rejects cross-tenant folder and document associations");
    expect(integration).toContain("set(asTenant(TENANT_A)).expect(404)");
    expect(integration).toContain("client_id was not found in this tenant");
  });
});
