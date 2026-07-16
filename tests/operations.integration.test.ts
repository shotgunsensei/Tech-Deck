import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

vi.mock("../server/auth", () => ({
  isAuthenticated: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { claims: { sub: req.headers["x-test-user"] || "integration-owner" } };
    next();
  },
}));

vi.mock("../server/authz", () => ({
  requireRole: (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
    const role = String(req.headers["x-test-role"] || "OWNER");
    if (!roles.includes(role)) return res.status(403).json({ message: "Insufficient permissions" });
    (req as any).tenantCtx = {
      tenantId: String(req.headers["x-test-tenant"] || ""),
      userId: String(req.headers["x-test-user"] || "integration-owner"),
      role,
    };
    next();
  },
}));

vi.mock("../server/core/middleware/requireNotPaused", () => ({
  requireNotPaused: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/core/events/helpers", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import { registerOperationsRoutes } from "../server/modules/operations/routes";
import {
  clients,
  configurationItems,
  contactRecords,
  documentationFolders,
  documentationPages,
  sites,
  tenants,
} from "../shared/schema";
import { users } from "../shared/models/auth";

const TENANT_A = "10000000-0000-4000-8000-000000000001";
const TENANT_B = "10000000-0000-4000-8000-000000000002";
const CLIENT_A = "20000000-0000-4000-8000-000000000001";
const CLIENT_B = "20000000-0000-4000-8000-000000000002";
const SITE_A = "30000000-0000-4000-8000-000000000001";
const USER_ID = "integration-owner";

const integrationDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integrationDescribe("operations API database integration", () => {
  const app = express();
  app.use(express.json());
  registerOperationsRoutes(app);

  const asTenant = (tenantId: string, role = "OWNER") => ({
    "x-test-tenant": tenantId,
    "x-test-user": USER_ID,
    "x-test-role": role,
  });

  beforeAll(async () => {
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
    await db.insert(users).values({ id: USER_ID, email: "operations-integration@techdeck.test" }).onConflictDoNothing();
    await db.insert(tenants).values([
      { id: TENANT_A, name: "Integration Tenant A", slug: "integration-tenant-a" },
      { id: TENANT_B, name: "Integration Tenant B", slug: "integration-tenant-b" },
    ]);
    await db.insert(clients).values([
      { id: CLIENT_A, tenantId: TENANT_A, name: "A Client" },
      { id: CLIENT_B, tenantId: TENANT_B, name: "B Client" },
    ]);
    await db.insert(sites).values({ id: SITE_A, tenantId: TENANT_A, clientId: CLIENT_A, name: "A Site" });
  });

  afterAll(async () => {
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
    await db.delete(users).where(eq(users.id, USER_ID));
    await pool.end();
  });

  it("persists inventory relationships and denies cross-tenant record access", async () => {
    const server = await request(app).post("/api/ops/items").set(asTenant(TENANT_A)).send({
      clientId: CLIENT_A,
      siteId: SITE_A,
      name: "A-DC-01",
      itemType: "server",
      status: "active",
      details: { operating_system: "Windows Server 2025" },
      tags: ["identity"],
    }).expect(201);

    const firewall = await request(app).post("/api/ops/items").set(asTenant(TENANT_A)).send({
      clientId: CLIENT_A,
      siteId: SITE_A,
      name: "A-FW-01",
      itemType: "firewall",
      status: "active",
      ipAddress: "10.20.0.1",
      details: {},
      tags: ["edge"],
    }).expect(201);

    await request(app).post("/api/ops/relationships").set(asTenant(TENANT_A)).send({
      sourceItemId: firewall.body.id,
      targetItemId: server.body.id,
      relationshipType: "routes_to",
      notes: "Identity services path",
    }).expect(201);

    const reloaded = await request(app).get(`/api/ops/items/${server.body.id}`).set(asTenant(TENANT_A)).expect(200);
    expect(reloaded.body.name).toBe("A-DC-01");
    expect(reloaded.body.relationships).toHaveLength(1);

    const foreign = await request(app).post("/api/ops/items").set(asTenant(TENANT_B)).send({
      clientId: CLIENT_B,
      name: "B-SECRET-SERVER",
      itemType: "server",
      status: "active",
      details: {},
      tags: [],
    }).expect(201);

    await request(app).get(`/api/ops/items/${foreign.body.id}`).set(asTenant(TENANT_A)).expect(404);
    const search = await request(app).get("/api/ops/search?q=A-DC").set(asTenant(TENANT_A)).expect(200);
    expect(search.body.items.map((item: any) => item.id)).toContain(server.body.id);
    expect(search.body.items.map((item: any) => item.id)).not.toContain(foreign.body.id);
  });

  it("rejects cross-tenant folder and document associations", async () => {
    const [foreignFolder] = await db.insert(documentationFolders).values({
      tenantId: TENANT_B,
      clientId: CLIENT_B,
      name: "B Restricted Folder",
    }).returning();

    await request(app).post("/api/ops/folders").set(asTenant(TENANT_A)).send({
      clientId: CLIENT_B,
      parentId: null,
      name: "Invalid foreign client folder",
    }).expect(400);

    await request(app).post("/api/ops/documents").set(asTenant(TENANT_A)).send({
      clientId: CLIENT_A,
      siteId: SITE_A,
      folderId: foreignFolder.id,
      pageType: "runbook",
      title: "Invalid foreign folder document",
      content: "Do not persist",
      status: "draft",
      minimumRole: "TECH",
      tags: [],
    }).expect(400);
  });

  it("hides restricted backlinks and prevents a technician from downgrading restricted documents", async () => {
    const visible = await request(app).post("/api/ops/documents").set(asTenant(TENANT_A)).send({
      clientId: CLIENT_A,
      pageType: "procedure",
      title: "Visible procedure",
      content: "Safe procedure",
      status: "draft",
      minimumRole: "TECH",
      tags: [],
    }).expect(201);

    const restricted = await request(app).post("/api/ops/documents").set(asTenant(TENANT_A)).send({
      clientId: CLIENT_A,
      pageType: "runbook",
      title: "Owner recovery runbook",
      content: `References [[${visible.body.slug}]]`,
      status: "published",
      minimumRole: "OWNER",
      tags: ["restricted"],
    }).expect(201);

    const technicianView = await request(app).get(`/api/ops/documents/${visible.body.id}`).set(asTenant(TENANT_A, "TECH")).expect(200);
    expect(technicianView.body.backlinks).toEqual([]);

    const technicianSummary = await request(app).get("/api/ops/summary").set(asTenant(TENANT_A, "TECH")).expect(200);
    expect(technicianSummary.body.totalDocuments).toBe(1);
    expect(technicianSummary.body.recentDocuments.map((document: any) => document.id)).not.toContain(restricted.body.id);

    const restrictedSearch = await request(app).get("/api/ops/search?q=Owner%20recovery").set(asTenant(TENANT_A, "TECH")).expect(200);
    expect(restrictedSearch.body.documents).toEqual([]);

    await request(app).patch(`/api/ops/documents/${restricted.body.id}`).set(asTenant(TENANT_A, "TECH")).send({
      status: "draft",
      minimumRole: "TECH",
      content: "Attempted downgrade",
    }).expect(404);

    const [persisted] = await db.select().from(documentationPages).where(eq(documentationPages.id, restricted.body.id));
    expect(persisted.minimumRole).toBe("OWNER");
    expect(persisted.status).toBe("published");
  });

  it("previews contact imports with tenant validation and duplicate detection, then rechecks on commit", async () => {
    await db.insert(contactRecords).values({
      tenantId: TENANT_A,
      clientId: CLIENT_A,
      name: "Existing Contact",
      email: "existing@example.test",
      contactType: "technical",
    });

    const csv = [
      "client_id,name,email,contact_type",
      `${CLIENT_A},Existing Contact,existing@example.test,technical`,
      `${CLIENT_A},New Contact,new@example.test,primary`,
      `${CLIENT_A},New Contact,new@example.test,primary`,
      `${CLIENT_B},Foreign Contact,foreign@example.test,technical`,
    ].join("\n");

    const preview = await request(app).post("/api/ops/import/preview").set(asTenant(TENANT_A)).send({
      kind: "contacts",
      csv,
    }).expect(200);

    expect(preview.body.valid).toBe(1);
    expect(preview.body.rows[0].duplicate).toBe(true);
    expect(preview.body.rows[2].duplicate).toBe(true);
    expect(preview.body.rows[3].errors).toContain("client_id was not found in this tenant");

    const duplicateCommit = await request(app).post("/api/ops/import/commit").set(asTenant(TENANT_A)).send({
      kind: "contacts",
      rows: [{ client_id: CLIENT_A, name: "Existing Contact", email: "existing@example.test", contact_type: "technical" }],
    }).expect(200);
    expect(duplicateCommit.body.imported).toBe(0);
    expect(duplicateCommit.body.errors[0].message).toBe("Duplicate record");
  });
});
