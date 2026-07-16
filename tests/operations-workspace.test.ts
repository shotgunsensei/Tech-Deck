import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findForbiddenSecretField, sanitizeDocumentationContent } from "../server/modules/operations/policy";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("TechDeck operations workspace contracts", () => {
  const schema = source("shared/schema.ts");
  const routes = source("server/modules/operations/routes.ts");
  const app = source("client/src/App.tsx");
  const inventory = source("client/src/modules/operations/pages/inventory-workspace.tsx");

  it("persists the core tenant-scoped operations primitives", () => {
    for (const table of [
      "contact_records",
      "configuration_items",
      "configuration_relationships",
      "documentation_folders",
      "documentation_pages",
      "documentation_revisions",
      "operational_attachments",
    ]) {
      expect(schema, `Missing ${table}`).toContain(`"${table}"`);
    }
    expect(schema.match(/tenantId: varchar\("tenant_id"\)/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it("registers staff authorization and inactive-subscription gates for operations writes", () => {
    expect(routes).toContain('const staff = [isAuthenticated, requireRole("OWNER", "ADMIN", "TECH")]');
    expect(routes).toContain('const admins = [isAuthenticated, requireRole("OWNER", "ADMIN")]');
    for (const path of [
      '"/api/ops/items"',
      '"/api/ops/contacts"',
      '"/api/ops/documents"',
      '"/api/ops/relationships"',
      '"/api/ops/attachments"',
      '"/api/ops/import/commit"',
    ]) {
      expect(routes).toContain(path);
    }
    expect(routes.match(/requireNotPaused\(\)/g)?.length).toBeGreaterThanOrEqual(12);
    expect(routes).toContain("eq(configurationItems.tenantId, req.tenantCtx.tenantId)");
    expect(routes).toContain("eq(documentationPages.tenantId, req.tenantCtx.tenantId)");
  });

  it("exposes real inventory, network, documentation, and lifecycle routes", () => {
    for (const route of ["/inventory", "/network", "/documentation", "/lifecycle"]) {
      expect(app).toContain(`path="${route}"`);
    }
  });

  it("rejects secret-bearing metadata keys", () => {
    expect(findForbiddenSecretField({ password: "nope" })).toBe("password");
    expect(findForbiddenSecretField({ api_key: "nope" })).toBe("api_key");
    expect(findForbiddenSecretField({ privateKey: "nope" })).toBe("privateKey");
    expect(findForbiddenSecretField({ username: "allowed", vaultItemId: "allowed" })).toBeNull();
  });

  it("removes active content while preserving normal markdown", () => {
    const value = sanitizeDocumentationContent("# Safe\n<script>alert(1)</script>\n<a onclick=\"bad()\" href=\"javascript:bad()\">x</a>");
    expect(value).toContain("# Safe");
    expect(value).not.toContain("<script");
    expect(value).not.toContain("onclick");
    expect(value).not.toContain("javascript:");
  });

  it("creates a revision in the same transaction as each document create or update", () => {
    expect(routes.match(/db\.transaction/g)?.length).toBe(2);
    expect(routes.match(/documentationRevisions/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("enforces tenant-owned folders and document visibility on indirect operations", () => {
    expect(routes).toContain("validDocumentationFolder");
    expect(routes).toContain("eq(documentationFolders.tenantId, req.tenantCtx.tenantId)");
    expect(routes).toContain("canViewDocument(req.tenantCtx.role, current.minimumRole)");
    expect(routes).toContain("backlinkCandidates.filter");
    expect(routes).toContain("canViewDocument(req.tenantCtx.role, parent[0].minimumRole)");
  });

  it("exposes create/update inventory and contact import workflows", () => {
    expect(inventory).toContain('editingId ? "PATCH" : "POST"');
    expect(inventory).toContain('editingContactId ? "PATCH" : "POST"');
    expect(inventory).toContain('<SelectItem value="contacts">Client contacts</SelectItem>');
    expect(routes).toContain("client_id was not found in this tenant");
    expect(routes).toContain('throw new Error("Duplicate record")');
  });
});
