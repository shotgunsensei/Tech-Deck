import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import jwt from "jsonwebtoken";
import request from "supertest";

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { hydrateUser } from "../server/auth";
import { MODULE_SLUG, registerSsoRoutes, type SsoConfig } from "../server/auth/sso";
import { registerCoreRoutes } from "../server/modules/core/routes";
import { registerOperationsRoutes } from "../server/modules/operations/routes";
import { tenants } from "../shared/schema";
import { users } from "../shared/models/auth";

const SECRET = "operatoros-integration-secret-32-chars";
const OPERATOROS_USER_ID = "operatoros-techdeck-integration-user";
const ORGANIZATION_ID = "operatoros-techdeck-integration-org";
const cfg: SsoConfig = {
  secret: SECRET,
  baseUrl: "https://operatoros.integration.test",
  apiUrl: "https://operatoros.integration.test/api",
  expectedIssuer: "https://operatoros.integration.test",
  audience: MODULE_SLUG,
  env: "integration",
  moduleKey: MODULE_SLUG,
  allowLegacyIssuer: false,
};

const integrationDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integrationDescribe("OperatorOS SSO to TechDeck operations journey", () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "techdeck-integration-session-secret", resave: false, saveUninitialized: false }));
  registerSsoRoutes(app, cfg);
  app.use(hydrateUser);
  registerCoreRoutes(app);
  registerOperationsRoutes(app);

  beforeAll(async () => {
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.operatorosUserId, OPERATOROS_USER_ID));
    const [existingTenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, ORGANIZATION_ID));
    if (existingTenant) await db.delete(tenants).where(eq(tenants.id, existingTenant.id));
    if (existingUser) await db.delete(users).where(eq(users.id, existingUser.id));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  afterAll(async () => {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.operatorosUserId, OPERATOROS_USER_ID));
    const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, ORGANIZATION_ID));
    if (tenant) await db.delete(tenants).where(eq(tenants.id, tenant.id));
    if (user) await db.delete(users).where(eq(users.id, user.id));
    vi.unstubAllGlobals();
    await pool.end();
  });

  it("launches through SSO and persists the core client infrastructure and runbook workflow", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({
      iss: cfg.expectedIssuer,
      aud: MODULE_SLUG,
      env: cfg.env,
      sub: OPERATOROS_USER_ID,
      user_id: OPERATOROS_USER_ID,
      email: "operatoros-integration@techdeck.test",
      name: "OperatorOS Integration Admin",
      role: "admin",
      module_slug: MODULE_SLUG,
      plan_slug: "business",
      organization_id: ORGANIZATION_ID,
      target_module_key: MODULE_SLUG,
      target_module_enabled: true,
      target_module_access_level: "business",
      target_module_features: ["reports", "intake", "api"],
      target_module_limits: { usersMax: 25 },
      module_role: "module_admin",
      tenant_role: "tenant_admin",
      subscription_status: "active",
      jti: `integration-${Date.now()}`,
      iat: now,
      exp: now + 60,
    }, SECRET, { algorithm: "HS256" });

    const agent = request.agent(app);
    await agent.get(`/sso?token=${encodeURIComponent(token)}`).expect(302).expect("Location", "/");

    const client = await agent.post("/api/clients").send({ name: "OperatorOS Managed Client" }).expect(200);
    const site = await agent.post("/api/sites").send({ name: "Primary Datacenter", clientId: client.body.id }).expect(200);

    const createItem = (name: string, itemType: string, extra: Record<string, unknown> = {}) => agent.post("/api/ops/items").send({
      clientId: client.body.id,
      siteId: site.body.id,
      name,
      itemType,
      status: "active",
      details: {},
      tags: [],
      ...extra,
    }).expect(201);

    const server = await createItem("OPS-DC-01", "server", { ipAddress: "10.50.0.10" });
    const firewall = await createItem("OPS-FW-01", "firewall", { ipAddress: "10.50.0.1" });
    await createItem("Operations VLAN 50", "vlan", { details: { vlan_id: 50 } });
    await createItem("Operations Subnet", "subnet", { details: { cidr: "10.50.0.0/24", gateway: "10.50.0.1" } });

    await agent.post("/api/ops/relationships").send({
      sourceItemId: firewall.body.id,
      targetItemId: server.body.id,
      relationshipType: "routes_to",
      notes: "Primary datacenter route",
    }).expect(201);

    const runbook = await agent.post("/api/ops/documents").send({
      clientId: client.body.id,
      siteId: site.body.id,
      pageType: "runbook",
      title: "Datacenter identity recovery",
      content: "# Recovery\n\n1. Validate the firewall route.\n2. Verify directory services.",
      status: "published",
      minimumRole: "TECH",
      tags: ["identity", "recovery"],
      changeNote: "Initial OperatorOS integration test version",
    }).expect(201);

    const reloadedServer = await agent.get(`/api/ops/items/${server.body.id}`).expect(200);
    expect(reloadedServer.body.relationships).toHaveLength(1);
    const reloadedRunbook = await agent.get(`/api/ops/documents/${runbook.body.id}`).expect(200);
    expect(reloadedRunbook.body.version).toBe(1);
    expect(reloadedRunbook.body.revisions).toHaveLength(1);

    const documentSearch = await agent.get("/api/ops/search?q=Datacenter").expect(200);
    expect(documentSearch.body.documents.map((document: any) => document.id)).toContain(runbook.body.id);
    const itemSearch = await agent.get("/api/ops/search?q=OPS-FW").expect(200);
    expect(itemSearch.body.items.map((item: any) => item.id)).toContain(firewall.body.id);

    expect(fetch).toHaveBeenCalledWith(`${cfg.apiUrl}/v1/modules/sso/consume`, expect.objectContaining({ method: "POST" }));
  });
});
