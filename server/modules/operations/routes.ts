import type { Express } from "express";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";
import { isAuthenticated } from "../../auth";
import { requireNotPaused } from "../../core/middleware/requireNotPaused";
import { emitEvent } from "../../core/events/helpers";
import { requireRole } from "../../authz";
import { db } from "../../db";
import {
  clients,
  sites,
  contactRecords,
  configurationItems,
  configurationRelationships,
  documentationFolders,
  documentationPages,
  documentationRevisions,
  operationalAttachments,
  evidenceItems,
} from "@shared/schema";
import { findForbiddenSecretField, sanitizeDocumentationContent } from "./policy";

const staff = [isAuthenticated, requireRole("OWNER", "ADMIN", "TECH")] as const;
const admins = [isAuthenticated, requireRole("OWNER", "ADMIN")] as const;

export const configurationItemTypes = [
  "server", "workstation", "network_device", "firewall", "switch", "access_point", "printer",
  "application", "domain", "dns_record", "dhcp_scope", "vlan", "subnet", "ip_address",
  "public_ip", "isp", "circuit", "vendor", "license", "certificate", "warranty",
  "configuration_item", "port_mapping", "credential_reference",
] as const;

const networkTypes = new Set([
  "network_device", "firewall", "switch", "access_point", "domain", "dns_record", "dhcp_scope",
  "vlan", "subnet", "ip_address", "public_ip", "isp", "circuit", "port_mapping",
]);
const lifecycleTypes = new Set(["license", "certificate", "warranty"]);
const ipRecordTypes = new Set(["dns_record", "dhcp_scope", "vlan", "subnet", "ip_address", "public_ip"]);
const roleRank: Record<string, number> = { CLIENT: 1, TECH: 2, ADMIN: 3, OWNER: 4 };

const nullableId = z.string().uuid().nullable().optional();
const nullableText = z.string().trim().max(5000).nullable().optional();
const optionalDate = z.string().datetime().nullable().optional();

const contactInput = z.object({
  clientId: z.string().uuid(),
  siteId: nullableId,
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  contactType: z.enum(["primary", "technical", "billing", "emergency", "vendor"]).default("technical"),
  notes: nullableText,
});

const configurationInput = z.object({
  clientId: nullableId,
  siteId: nullableId,
  name: z.string().trim().min(1).max(240),
  itemType: z.enum(configurationItemTypes),
  status: z.enum(["active", "inactive", "planned", "retired", "warning", "expired"]).default("active"),
  owner: z.string().trim().max(200).nullable().optional(),
  vendor: z.string().trim().max(200).nullable().optional(),
  product: z.string().trim().max(200).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  serialNumber: z.string().trim().max(300).nullable().optional(),
  ipAddress: z.string().trim().max(100).nullable().optional(),
  macAddress: z.string().trim().max(100).nullable().optional(),
  externalVaultReference: z.string().trim().max(1000).nullable().optional(),
  expirationDate: optionalDate,
  renewalDate: optionalDate,
  warrantyEndDate: optionalDate,
  details: z.record(z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({}),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  notes: nullableText,
});

const folderInput = z.object({
  clientId: nullableId,
  parentId: nullableId,
  name: z.string().trim().min(1).max(200),
});

const documentInput = z.object({
  clientId: nullableId,
  siteId: nullableId,
  folderId: nullableId,
  pageType: z.enum(["documentation", "runbook", "procedure", "knowledge_article"]).default("documentation"),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().max(1000).nullable().optional(),
  content: z.string().max(250_000).default(""),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  category: z.string().trim().max(120).nullable().optional(),
  minimumRole: z.enum(["TECH", "ADMIN", "OWNER"]).default("TECH"),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  changeNote: z.string().trim().max(500).nullable().optional(),
});

function dates<T extends Record<string, unknown>>(value: T) {
  return {
    ...value,
    expirationDate: value.expirationDate ? new Date(String(value.expirationDate)) : null,
    renewalDate: value.renewalDate ? new Date(String(value.renewalDate)) : null,
    warrantyEndDate: value.warrantyEndDate ? new Date(String(value.warrantyEndDate)) : null,
  };
}

function assertNoSecretMaterial(input: z.infer<typeof configurationInput>): string | null {
  if (input.itemType === "credential_reference" && !input.externalVaultReference) {
    return "Credential references require an external vault reference";
  }
  const badKey = findForbiddenSecretField(input.details);
  return badKey ? `Secret-bearing field '${badKey}' is not allowed; store it in the external vault` : null;
}

function slugify(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "document";
}

function canViewDocument(role: string, minimumRole: string): boolean {
  return (roleRank[role] ?? 0) >= (roleRank[minimumRole] ?? roleRank.TECH);
}

function visibleDocumentRoles(role: string): Array<"TECH" | "ADMIN" | "OWNER"> {
  return (["TECH", "ADMIN", "OWNER"] as const).filter((minimumRole) => canViewDocument(role, minimumRole));
}

type ImportKind = "items" | "contacts" | "ip_records";

function importDuplicateKey(kind: ImportKind, row: Record<string, string>): string {
  const clean = (value?: string) => (value ?? "").trim().toLowerCase();
  if (kind === "contacts") {
    return [clean(row.client_id), clean(row.name), clean(row.email)].join("|");
  }
  const itemType = kind === "ip_records" ? clean(row.item_type) || "ip_address" : clean(row.item_type);
  return [clean(row.client_id), itemType, clean(row.name)].join("|");
}

async function validClientAndSite(tenantId: string, clientId?: string | null, siteId?: string | null) {
  if (clientId) {
    const [client] = await db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId))).limit(1);
    if (!client) return "Client not found";
  }
  if (siteId) {
    const [site] = await db.select({ id: sites.id, clientId: sites.clientId }).from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.id, siteId))).limit(1);
    if (!site) return "Site not found";
    if (site.clientId && site.clientId !== clientId) return "Site does not belong to the selected client";
  }
  return null;
}

async function validDocumentationFolder(tenantId: string, folderId?: string | null, clientId?: string | null) {
  if (!folderId) return null;
  const [folder] = await db.select({ id: documentationFolders.id, clientId: documentationFolders.clientId })
    .from(documentationFolders).where(and(
      eq(documentationFolders.tenantId, tenantId),
      eq(documentationFolders.id, folderId),
    )).limit(1);
  if (!folder) return "Folder not found";
  if (folder.clientId && folder.clientId !== clientId) return "Folder does not belong to the selected client";
  return null;
}

export function registerOperationsRoutes(app: Express) {
  app.get("/api/ops/summary", ...staff, async (req: any, res) => {
    const { tenantId } = req.tenantCtx;
    const documentRoles = visibleDocumentRoles(req.tenantCtx.role);
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const [itemsCount, docsCount, contactsCount, dueItems, recentDocs, byClient] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(configurationItems).where(eq(configurationItems.tenantId, tenantId)),
      db.select({ count: sql<number>`count(*)::int` }).from(documentationPages).where(and(
        eq(documentationPages.tenantId, tenantId), inArray(documentationPages.minimumRole, documentRoles),
      )),
      db.select({ count: sql<number>`count(*)::int` }).from(contactRecords).where(eq(contactRecords.tenantId, tenantId)),
      db.select().from(configurationItems).where(and(
        eq(configurationItems.tenantId, tenantId),
        or(
          and(gte(configurationItems.expirationDate, now), lte(configurationItems.expirationDate, horizon)),
          and(gte(configurationItems.renewalDate, now), lte(configurationItems.renewalDate, horizon)),
          and(gte(configurationItems.warrantyEndDate, now), lte(configurationItems.warrantyEndDate, horizon)),
        ),
      )).orderBy(asc(configurationItems.expirationDate)).limit(20),
      db.select().from(documentationPages).where(and(
        eq(documentationPages.tenantId, tenantId), inArray(documentationPages.minimumRole, documentRoles),
      ))
        .orderBy(desc(documentationPages.updatedAt)).limit(8),
      db.select({ clientId: configurationItems.clientId, clientName: clients.name, count: sql<number>`count(*)::int` })
        .from(configurationItems).leftJoin(clients, and(
          eq(configurationItems.clientId, clients.id), eq(clients.tenantId, tenantId),
        ))
        .where(eq(configurationItems.tenantId, tenantId)).groupBy(configurationItems.clientId, clients.name)
        .orderBy(desc(sql`count(*)`)).limit(10),
    ]);
    res.json({
      totalItems: itemsCount[0]?.count ?? 0,
      totalDocuments: docsCount[0]?.count ?? 0,
      totalContacts: contactsCount[0]?.count ?? 0,
      dueItems,
      recentDocuments: recentDocs,
      infrastructureByClient: byClient,
    });
  });

  app.get("/api/ops/contacts", ...staff, async (req: any, res) => {
    const conditions = [eq(contactRecords.tenantId, req.tenantCtx.tenantId)];
    if (typeof req.query.clientId === "string") conditions.push(eq(contactRecords.clientId, req.query.clientId));
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const pattern = `%${req.query.q.trim()}%`;
      conditions.push(or(ilike(contactRecords.name, pattern), ilike(contactRecords.email, pattern))!);
    }
    const rows = await db.select({ contact: contactRecords, clientName: clients.name, siteName: sites.name })
      .from(contactRecords).leftJoin(clients, and(
        eq(contactRecords.clientId, clients.id), eq(clients.tenantId, req.tenantCtx.tenantId),
      )).leftJoin(sites, and(
        eq(contactRecords.siteId, sites.id), eq(sites.tenantId, req.tenantCtx.tenantId),
      )).where(and(...conditions))
      .orderBy(asc(contactRecords.name));
    res.json(rows.map((row) => ({ ...row.contact, clientName: row.clientName, siteName: row.siteName })));
  });

  app.post("/api/ops/contacts", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = contactInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const { tenantId, userId } = req.tenantCtx;
    const invalid = await validClientAndSite(tenantId, parsed.data.clientId, parsed.data.siteId);
    if (invalid) return res.status(400).json({ message: invalid });
    const [record] = await db.insert(contactRecords).values({ ...parsed.data, tenantId }).returning();
    await emitEvent("contact.created", tenantId, userId, "contact", record.id, { name: record.name });
    res.status(201).json(record);
  });

  app.patch("/api/ops/contacts/:id", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = contactInput.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const { tenantId, userId } = req.tenantCtx;
    const [current] = await db.select().from(contactRecords).where(and(
      eq(contactRecords.tenantId, tenantId), eq(contactRecords.id, req.params.id),
    )).limit(1);
    if (!current) return res.status(404).json({ message: "Contact not found" });
    const merged = contactInput.parse({ ...current, ...parsed.data });
    const invalid = await validClientAndSite(tenantId, merged.clientId, merged.siteId);
    if (invalid) return res.status(400).json({ message: invalid });
    const [record] = await db.update(contactRecords).set({ ...merged, updatedAt: new Date() })
      .where(and(eq(contactRecords.tenantId, tenantId), eq(contactRecords.id, req.params.id))).returning();
    await emitEvent("contact.updated", tenantId, userId, "contact", record.id, {});
    res.json(record);
  });

  app.delete("/api/ops/contacts/:id", ...admins, requireNotPaused(), async (req: any, res) => {
    const [record] = await db.delete(contactRecords).where(and(
      eq(contactRecords.tenantId, req.tenantCtx.tenantId), eq(contactRecords.id, req.params.id),
    )).returning();
    if (!record) return res.status(404).json({ message: "Contact not found" });
    await emitEvent("contact.deleted", req.tenantCtx.tenantId, req.tenantCtx.userId, "contact", record.id, {});
    res.json({ deleted: true });
  });

  app.get("/api/ops/items", ...staff, async (req: any, res) => {
    const conditions = [eq(configurationItems.tenantId, req.tenantCtx.tenantId)];
    if (typeof req.query.clientId === "string") conditions.push(eq(configurationItems.clientId, req.query.clientId));
    if (typeof req.query.siteId === "string") conditions.push(eq(configurationItems.siteId, req.query.siteId));
    if (typeof req.query.status === "string") conditions.push(eq(configurationItems.status, req.query.status));
    if (typeof req.query.itemType === "string") conditions.push(eq(configurationItems.itemType, req.query.itemType));
    if (req.query.group === "network") conditions.push(inArray(configurationItems.itemType, Array.from(networkTypes)));
    if (req.query.group === "lifecycle") conditions.push(inArray(configurationItems.itemType, Array.from(lifecycleTypes)));
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const pattern = `%${req.query.q.trim()}%`;
      conditions.push(or(
        ilike(configurationItems.name, pattern), ilike(configurationItems.serialNumber, pattern),
        ilike(configurationItems.ipAddress, pattern), ilike(configurationItems.vendor, pattern),
        ilike(configurationItems.notes, pattern),
      )!);
    }
    const rows = await db.select({ item: configurationItems, clientName: clients.name, siteName: sites.name })
      .from(configurationItems).leftJoin(clients, and(
        eq(configurationItems.clientId, clients.id), eq(clients.tenantId, req.tenantCtx.tenantId),
      )).leftJoin(sites, and(
        eq(configurationItems.siteId, sites.id), eq(sites.tenantId, req.tenantCtx.tenantId),
      )).where(and(...conditions))
      .orderBy(desc(configurationItems.updatedAt)).limit(500);
    res.json(rows.map((row) => ({ ...row.item, clientName: row.clientName, siteName: row.siteName })));
  });

  app.get("/api/ops/items/:id", ...staff, async (req: any, res) => {
    const tenantId = req.tenantCtx.tenantId;
    const [row] = await db.select({ item: configurationItems, clientName: clients.name, siteName: sites.name })
      .from(configurationItems).leftJoin(clients, and(
        eq(configurationItems.clientId, clients.id), eq(clients.tenantId, tenantId),
      )).leftJoin(sites, and(
        eq(configurationItems.siteId, sites.id), eq(sites.tenantId, tenantId),
      ))
      .where(and(eq(configurationItems.tenantId, tenantId), eq(configurationItems.id, req.params.id))).limit(1);
    if (!row) return res.status(404).json({ message: "Configuration item not found" });
    const [relationships, attachments] = await Promise.all([
      db.select().from(configurationRelationships).where(and(
        eq(configurationRelationships.tenantId, tenantId),
        or(eq(configurationRelationships.sourceItemId, row.item.id), eq(configurationRelationships.targetItemId, row.item.id)),
      )),
      db.select({ attachment: operationalAttachments, evidenceTitle: evidenceItems.title, fileName: evidenceItems.fileName })
        .from(operationalAttachments).innerJoin(evidenceItems, and(
          eq(operationalAttachments.evidenceItemId, evidenceItems.id), eq(evidenceItems.tenantId, tenantId),
        ))
        .where(and(eq(operationalAttachments.tenantId, tenantId), eq(operationalAttachments.configurationItemId, row.item.id))),
    ]);
    res.json({ ...row.item, clientName: row.clientName, siteName: row.siteName, relationships, attachments });
  });

  app.post("/api/ops/items", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = configurationInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const secretError = assertNoSecretMaterial(parsed.data);
    if (secretError) return res.status(400).json({ message: secretError, code: "secret_material_rejected" });
    const { tenantId, userId } = req.tenantCtx;
    const invalid = await validClientAndSite(tenantId, parsed.data.clientId, parsed.data.siteId);
    if (invalid) return res.status(400).json({ message: invalid });
    const [item] = await db.insert(configurationItems).values({
      ...dates(parsed.data), tenantId, createdById: userId,
    }).returning();
    await emitEvent("configuration_item.created", tenantId, userId, "configuration_item", item.id, { name: item.name, itemType: item.itemType });
    res.status(201).json(item);
  });

  app.patch("/api/ops/items/:id", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = configurationInput.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const current = await db.select().from(configurationItems).where(and(
      eq(configurationItems.tenantId, req.tenantCtx.tenantId), eq(configurationItems.id, req.params.id),
    )).limit(1);
    if (!current[0]) return res.status(404).json({ message: "Configuration item not found" });
    const merged = configurationInput.parse({ ...current[0], ...req.body, expirationDate: req.body.expirationDate ?? current[0].expirationDate?.toISOString(), renewalDate: req.body.renewalDate ?? current[0].renewalDate?.toISOString(), warrantyEndDate: req.body.warrantyEndDate ?? current[0].warrantyEndDate?.toISOString() });
    const secretError = assertNoSecretMaterial(merged);
    if (secretError) return res.status(400).json({ message: secretError, code: "secret_material_rejected" });
    const invalid = await validClientAndSite(req.tenantCtx.tenantId, merged.clientId, merged.siteId);
    if (invalid) return res.status(400).json({ message: invalid });
    const [item] = await db.update(configurationItems).set({ ...dates(merged), updatedAt: new Date() })
      .where(and(eq(configurationItems.tenantId, req.tenantCtx.tenantId), eq(configurationItems.id, req.params.id))).returning();
    await emitEvent("configuration_item.updated", req.tenantCtx.tenantId, req.tenantCtx.userId, "configuration_item", item.id, {});
    res.json(item);
  });

  app.delete("/api/ops/items/:id", ...admins, requireNotPaused(), async (req: any, res) => {
    const [item] = await db.delete(configurationItems).where(and(
      eq(configurationItems.tenantId, req.tenantCtx.tenantId), eq(configurationItems.id, req.params.id),
    )).returning();
    if (!item) return res.status(404).json({ message: "Configuration item not found" });
    await emitEvent("configuration_item.deleted", req.tenantCtx.tenantId, req.tenantCtx.userId, "configuration_item", item.id, {});
    res.json({ deleted: true });
  });

  app.post("/api/ops/relationships", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = z.object({
      sourceItemId: z.string().uuid(), targetItemId: z.string().uuid(),
      relationshipType: z.enum(["depends_on", "connects_to", "hosts", "routes_to", "backs_up", "assigned_to", "covered_by"]),
      notes: nullableText,
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    if (parsed.data.sourceItemId === parsed.data.targetItemId) return res.status(400).json({ message: "An item cannot relate to itself" });
    const items = await db.select({ id: configurationItems.id }).from(configurationItems).where(and(
      eq(configurationItems.tenantId, req.tenantCtx.tenantId),
      inArray(configurationItems.id, [parsed.data.sourceItemId, parsed.data.targetItemId]),
    ));
    if (items.length !== 2) return res.status(404).json({ message: "One or both configuration items were not found" });
    const [relationship] = await db.insert(configurationRelationships).values({
      ...parsed.data, tenantId: req.tenantCtx.tenantId, createdById: req.tenantCtx.userId,
    }).returning();
    await emitEvent("configuration_relationship.created", req.tenantCtx.tenantId, req.tenantCtx.userId, "configuration_relationship", relationship.id, {});
    res.status(201).json(relationship);
  });

  app.delete("/api/ops/relationships/:id", ...staff, requireNotPaused(), async (req: any, res) => {
    const [relationship] = await db.delete(configurationRelationships).where(and(
      eq(configurationRelationships.tenantId, req.tenantCtx.tenantId), eq(configurationRelationships.id, req.params.id),
    )).returning();
    if (!relationship) return res.status(404).json({ message: "Relationship not found" });
    await emitEvent("configuration_relationship.deleted", req.tenantCtx.tenantId, req.tenantCtx.userId, "configuration_relationship", relationship.id, {});
    res.json({ deleted: true });
  });

  app.get("/api/ops/folders", ...staff, async (req: any, res) => {
    const rows = await db.select().from(documentationFolders)
      .where(eq(documentationFolders.tenantId, req.tenantCtx.tenantId)).orderBy(asc(documentationFolders.name));
    res.json(rows);
  });

  app.post("/api/ops/folders", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = folderInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const invalidClient = await validClientAndSite(req.tenantCtx.tenantId, parsed.data.clientId, null);
    if (invalidClient) return res.status(400).json({ message: invalidClient });
    if (parsed.data.parentId) {
      const parent = await db.select({ id: documentationFolders.id, clientId: documentationFolders.clientId }).from(documentationFolders).where(and(
        eq(documentationFolders.tenantId, req.tenantCtx.tenantId), eq(documentationFolders.id, parsed.data.parentId),
      )).limit(1);
      if (!parent[0]) return res.status(404).json({ message: "Parent folder not found" });
      if (parent[0].clientId && parent[0].clientId !== parsed.data.clientId) {
        return res.status(400).json({ message: "Parent folder does not belong to the selected client" });
      }
    }
    const [folder] = await db.insert(documentationFolders).values({ ...parsed.data, tenantId: req.tenantCtx.tenantId }).returning();
    await emitEvent("documentation_folder.created", req.tenantCtx.tenantId, req.tenantCtx.userId, "documentation_folder", folder.id, { name: folder.name });
    res.status(201).json(folder);
  });

  app.delete("/api/ops/folders/:id", ...admins, requireNotPaused(), async (req: any, res) => {
    const child = await db.select({ id: documentationFolders.id }).from(documentationFolders).where(and(
      eq(documentationFolders.tenantId, req.tenantCtx.tenantId), eq(documentationFolders.parentId, req.params.id),
    )).limit(1);
    if (child[0]) return res.status(409).json({ message: "Move or delete child folders first" });
    const [folder] = await db.delete(documentationFolders).where(and(
      eq(documentationFolders.tenantId, req.tenantCtx.tenantId), eq(documentationFolders.id, req.params.id),
    )).returning();
    if (!folder) return res.status(404).json({ message: "Folder not found" });
    res.json({ deleted: true });
  });

  app.get("/api/ops/documents/export", ...staff, async (req: any, res) => {
    const ids = String(req.query.ids ?? "").split(",").filter(Boolean);
    if (!ids.length || ids.length > 100) return res.status(400).json({ message: "Select between 1 and 100 documents" });
    const docs = await db.select().from(documentationPages).where(and(
      eq(documentationPages.tenantId, req.tenantCtx.tenantId), inArray(documentationPages.id, ids),
    )).orderBy(asc(documentationPages.title));
    const visible = docs.filter((doc) => canViewDocument(req.tenantCtx.role, doc.minimumRole));
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=techdeck-documentation.md");
    res.send(visible.map((doc) => `# ${doc.title}\n\n${doc.summary ?? ""}\n\n${doc.content}`).join("\n\n---\n\n"));
  });

  app.get("/api/ops/documents", ...staff, async (req: any, res) => {
    const conditions = [eq(documentationPages.tenantId, req.tenantCtx.tenantId)];
    if (typeof req.query.clientId === "string") conditions.push(eq(documentationPages.clientId, req.query.clientId));
    if (typeof req.query.folderId === "string") conditions.push(eq(documentationPages.folderId, req.query.folderId));
    if (typeof req.query.pageType === "string") conditions.push(eq(documentationPages.pageType, req.query.pageType));
    if (typeof req.query.status === "string") conditions.push(eq(documentationPages.status, req.query.status));
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const pattern = `%${req.query.q.trim()}%`;
      conditions.push(or(ilike(documentationPages.title, pattern), ilike(documentationPages.summary, pattern), ilike(documentationPages.content, pattern))!);
    }
    const rows = await db.select({ page: documentationPages, clientName: clients.name, folderName: documentationFolders.name })
      .from(documentationPages).leftJoin(clients, and(
        eq(documentationPages.clientId, clients.id), eq(clients.tenantId, req.tenantCtx.tenantId),
      )).leftJoin(documentationFolders, and(
        eq(documentationPages.folderId, documentationFolders.id),
        eq(documentationFolders.tenantId, req.tenantCtx.tenantId),
      ))
      .where(and(...conditions)).orderBy(desc(documentationPages.updatedAt)).limit(500);
    res.json(rows.filter((row) => canViewDocument(req.tenantCtx.role, row.page.minimumRole))
      .map((row) => ({ ...row.page, clientName: row.clientName, folderName: row.folderName })));
  });

  app.get("/api/ops/documents/:id", ...staff, async (req: any, res) => {
    const tenantId = req.tenantCtx.tenantId;
    const [page] = await db.select().from(documentationPages).where(and(
      eq(documentationPages.tenantId, tenantId), eq(documentationPages.id, req.params.id),
    )).limit(1);
    if (!page || !canViewDocument(req.tenantCtx.role, page.minimumRole)) return res.status(404).json({ message: "Document not found" });
    const [revisions, backlinkCandidates, attachments] = await Promise.all([
      db.select().from(documentationRevisions).where(and(eq(documentationRevisions.tenantId, tenantId), eq(documentationRevisions.pageId, page.id))).orderBy(desc(documentationRevisions.version)),
      db.select({
        id: documentationPages.id,
        title: documentationPages.title,
        slug: documentationPages.slug,
        minimumRole: documentationPages.minimumRole,
      })
        .from(documentationPages).where(and(eq(documentationPages.tenantId, tenantId), ilike(documentationPages.content, `%[[${page.slug}]]%`))),
      db.select({ attachment: operationalAttachments, evidenceTitle: evidenceItems.title, fileName: evidenceItems.fileName })
        .from(operationalAttachments).innerJoin(evidenceItems, and(
          eq(operationalAttachments.evidenceItemId, evidenceItems.id), eq(evidenceItems.tenantId, tenantId),
        ))
        .where(and(eq(operationalAttachments.tenantId, tenantId), eq(operationalAttachments.documentationPageId, page.id))),
    ]);
    const backlinks = backlinkCandidates.filter((candidate) => canViewDocument(req.tenantCtx.role, candidate.minimumRole));
    res.json({ ...page, revisions, backlinks, attachments });
  });

  app.post("/api/ops/documents", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = documentInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    if ((parsed.data.status === "published" || parsed.data.minimumRole !== "TECH") && !["OWNER", "ADMIN"].includes(req.tenantCtx.role)) {
      return res.status(403).json({ message: "Only owners and admins can publish or restrict documentation" });
    }
    const invalid = await validClientAndSite(req.tenantCtx.tenantId, parsed.data.clientId, parsed.data.siteId);
    if (invalid) return res.status(400).json({ message: invalid });
    const invalidFolder = await validDocumentationFolder(req.tenantCtx.tenantId, parsed.data.folderId, parsed.data.clientId);
    if (invalidFolder) return res.status(400).json({ message: invalidFolder });
    const baseSlug = slugify(parsed.data.title);
    const [existing] = await db.select({ id: documentationPages.id }).from(documentationPages).where(and(
      eq(documentationPages.tenantId, req.tenantCtx.tenantId), eq(documentationPages.slug, baseSlug),
    )).limit(1);
    const slug = existing ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;
    const content = sanitizeDocumentationContent(parsed.data.content);
    const { changeNote, ...pageData } = parsed.data;
    const page = await db.transaction(async (tx) => {
      const [created] = await tx.insert(documentationPages).values({
        ...pageData, content, slug, tenantId: req.tenantCtx.tenantId,
        createdById: req.tenantCtx.userId, updatedById: req.tenantCtx.userId,
        publishedAt: parsed.data.status === "published" ? new Date() : null,
      }).returning();
      await tx.insert(documentationRevisions).values({
        tenantId: req.tenantCtx.tenantId, pageId: created.id, version: 1,
        title: created.title, summary: created.summary, content: created.content, status: created.status,
        changeNote: changeNote ?? "Initial version", createdById: req.tenantCtx.userId,
      });
      return created;
    });
    await emitEvent("documentation_page.created", req.tenantCtx.tenantId, req.tenantCtx.userId, "documentation_page", page.id, { title: page.title, pageType: page.pageType });
    res.status(201).json(page);
  });

  app.patch("/api/ops/documents/:id", ...staff, requireNotPaused(), async (req: any, res) => {
    const [current] = await db.select().from(documentationPages).where(and(
      eq(documentationPages.tenantId, req.tenantCtx.tenantId), eq(documentationPages.id, req.params.id),
    )).limit(1);
    if (!current || !canViewDocument(req.tenantCtx.role, current.minimumRole)) return res.status(404).json({ message: "Document not found" });
    const parsed = documentInput.safeParse({ ...current, ...req.body });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    if ((parsed.data.status === "published" || parsed.data.minimumRole !== "TECH") && !["OWNER", "ADMIN"].includes(req.tenantCtx.role)) {
      return res.status(403).json({ message: "Only owners and admins can publish or restrict documentation" });
    }
    const invalid = await validClientAndSite(req.tenantCtx.tenantId, parsed.data.clientId, parsed.data.siteId);
    if (invalid) return res.status(400).json({ message: invalid });
    const invalidFolder = await validDocumentationFolder(req.tenantCtx.tenantId, parsed.data.folderId, parsed.data.clientId);
    if (invalidFolder) return res.status(400).json({ message: invalidFolder });
    const nextVersion = current.version + 1;
    const content = sanitizeDocumentationContent(parsed.data.content);
    const { changeNote, ...pageData } = parsed.data;
    const page = await db.transaction(async (tx) => {
      const [updated] = await tx.update(documentationPages).set({
        ...pageData, content, version: nextVersion, updatedById: req.tenantCtx.userId,
        updatedAt: new Date(), publishedAt: parsed.data.status === "published" ? (current.publishedAt ?? new Date()) : null,
      }).where(and(eq(documentationPages.tenantId, req.tenantCtx.tenantId), eq(documentationPages.id, current.id))).returning();
      await tx.insert(documentationRevisions).values({
        tenantId: req.tenantCtx.tenantId, pageId: current.id, version: nextVersion,
        title: updated.title, summary: updated.summary, content: updated.content, status: updated.status,
        changeNote: changeNote ?? null, createdById: req.tenantCtx.userId,
      });
      return updated;
    });
    await emitEvent("documentation_page.updated", req.tenantCtx.tenantId, req.tenantCtx.userId, "documentation_page", page.id, { version: nextVersion });
    res.json(page);
  });

  app.delete("/api/ops/documents/:id", ...admins, requireNotPaused(), async (req: any, res) => {
    const [page] = await db.delete(documentationPages).where(and(
      eq(documentationPages.tenantId, req.tenantCtx.tenantId), eq(documentationPages.id, req.params.id),
    )).returning();
    if (!page) return res.status(404).json({ message: "Document not found" });
    await emitEvent("documentation_page.deleted", req.tenantCtx.tenantId, req.tenantCtx.userId, "documentation_page", page.id, {});
    res.json({ deleted: true });
  });

  app.post("/api/ops/attachments", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = z.object({
      evidenceItemId: z.string().uuid(), configurationItemId: nullableId, documentationPageId: nullableId,
      label: z.string().trim().max(200).nullable().optional(),
    }).refine((value) => Number(Boolean(value.configurationItemId)) + Number(Boolean(value.documentationPageId)) === 1, {
      message: "Choose exactly one configuration item or document",
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const tenantId = req.tenantCtx.tenantId;
    const evidence = await db.select({ id: evidenceItems.id }).from(evidenceItems).where(and(eq(evidenceItems.tenantId, tenantId), eq(evidenceItems.id, parsed.data.evidenceItemId))).limit(1);
    if (!evidence[0]) return res.status(404).json({ message: "Evidence item not found" });
    if (parsed.data.configurationItemId) {
      const parent = await db.select({ id: configurationItems.id }).from(configurationItems).where(and(eq(configurationItems.tenantId, tenantId), eq(configurationItems.id, parsed.data.configurationItemId))).limit(1);
      if (!parent[0]) return res.status(404).json({ message: "Configuration item not found" });
    }
    if (parsed.data.documentationPageId) {
      const parent = await db.select({ id: documentationPages.id, minimumRole: documentationPages.minimumRole }).from(documentationPages).where(and(eq(documentationPages.tenantId, tenantId), eq(documentationPages.id, parsed.data.documentationPageId))).limit(1);
      if (!parent[0] || !canViewDocument(req.tenantCtx.role, parent[0].minimumRole)) return res.status(404).json({ message: "Document not found" });
    }
    const [attachment] = await db.insert(operationalAttachments).values({ ...parsed.data, tenantId, createdById: req.tenantCtx.userId }).returning();
    await emitEvent("operational_attachment.created", tenantId, req.tenantCtx.userId, "operational_attachment", attachment.id, {});
    res.status(201).json(attachment);
  });

  app.delete("/api/ops/attachments/:id", ...staff, requireNotPaused(), async (req: any, res) => {
    const [existing] = await db.select({
      id: operationalAttachments.id,
      documentationPageId: operationalAttachments.documentationPageId,
      minimumRole: documentationPages.minimumRole,
    }).from(operationalAttachments).leftJoin(documentationPages, and(
      eq(operationalAttachments.documentationPageId, documentationPages.id),
      eq(documentationPages.tenantId, req.tenantCtx.tenantId),
    )).where(and(
      eq(operationalAttachments.tenantId, req.tenantCtx.tenantId),
      eq(operationalAttachments.id, req.params.id),
    )).limit(1);
    if (!existing || (existing.documentationPageId && !canViewDocument(req.tenantCtx.role, existing.minimumRole ?? "OWNER"))) {
      return res.status(404).json({ message: "Attachment not found" });
    }
    const [attachment] = await db.delete(operationalAttachments).where(and(eq(operationalAttachments.tenantId, req.tenantCtx.tenantId), eq(operationalAttachments.id, req.params.id))).returning();
    if (!attachment) return res.status(404).json({ message: "Attachment not found" });
    res.json({ deleted: true });
  });

  app.post("/api/ops/import/preview", ...staff, async (req: any, res) => {
    const parsed = z.object({ kind: z.enum(["items", "contacts", "ip_records"]), csv: z.string().min(1).max(2_000_000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const result = Papa.parse<Record<string, string>>(parsed.data.csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase(),
    });
    if (result.errors.length) return res.status(400).json({ message: result.errors[0].message });
    if (result.data.length > 1000) return res.status(400).json({ message: "Maximum 1,000 rows per import" });
    const tenantId = req.tenantCtx.tenantId;
    const [existingItems, existingContacts, tenantClients, tenantSites] = await Promise.all([
      db.select({ clientId: configurationItems.clientId, itemType: configurationItems.itemType, name: configurationItems.name })
        .from(configurationItems).where(eq(configurationItems.tenantId, tenantId)),
      db.select({ clientId: contactRecords.clientId, name: contactRecords.name, email: contactRecords.email })
        .from(contactRecords).where(eq(contactRecords.tenantId, tenantId)),
      db.select({ id: clients.id }).from(clients).where(eq(clients.tenantId, tenantId)),
      db.select({ id: sites.id, clientId: sites.clientId }).from(sites).where(eq(sites.tenantId, tenantId)),
    ]);
    const existingKeys = new Set(
      parsed.data.kind === "contacts"
        ? existingContacts.map((row) => importDuplicateKey("contacts", {
          client_id: row.clientId ?? "", name: row.name, email: row.email ?? "",
        }))
        : existingItems.map((row) => importDuplicateKey(parsed.data.kind, {
          client_id: row.clientId ?? "", item_type: row.itemType, name: row.name,
        })),
    );
    const clientIds = new Set(tenantClients.map((client) => client.id));
    const siteClients = new Map(tenantSites.map((site) => [site.id, site.clientId]));
    const seenKeys = new Set<string>();
    const rows = result.data.map((row, index) => {
      const errors: string[] = [];
      const name = (row.name ?? "").trim();
      if (!name) errors.push("name is required");
      const clientId = (row.client_id ?? "").trim();
      const siteId = (row.site_id ?? "").trim();
      if (clientId && !z.string().uuid().safeParse(clientId).success) errors.push("client_id must be a UUID");
      else if (clientId && !clientIds.has(clientId)) errors.push("client_id was not found in this tenant");
      if (siteId && !z.string().uuid().safeParse(siteId).success) errors.push("site_id must be a UUID");
      else if (siteId && !siteClients.has(siteId)) errors.push("site_id was not found in this tenant");
      else if (siteId && clientId && siteClients.get(siteId) !== clientId) errors.push("site_id does not belong to client_id");
      if (parsed.data.kind !== "contacts") {
        const type = parsed.data.kind === "ip_records" ? (row.item_type || "ip_address") : row.item_type;
        if (!configurationItemTypes.includes(type as any)) errors.push("item_type is invalid");
        else if (parsed.data.kind === "ip_records" && !ipRecordTypes.has(type)) errors.push("item_type is not an IP or subnet record type");
      } else {
        if (!clientId) errors.push("client_id is required");
        if (row.email && !z.string().email().safeParse(row.email.trim()).success) errors.push("email is invalid");
      }
      const key = importDuplicateKey(parsed.data.kind, row);
      const duplicate = Boolean(name) && (existingKeys.has(key) || seenKeys.has(key));
      if (name) seenKeys.add(key);
      return { row: index + 2, data: row, duplicate, errors };
    });
    res.json({ kind: parsed.data.kind, total: rows.length, valid: rows.filter((row) => !row.errors.length && !row.duplicate).length, rows });
  });

  app.post("/api/ops/import/commit", ...staff, requireNotPaused(), async (req: any, res) => {
    const parsed = z.object({ kind: z.enum(["items", "contacts", "ip_records"]), rows: z.array(z.record(z.string())).min(1).max(1000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
    const errors: Array<{ row: number; message: string }> = [];
    let imported = 0;
    const tenantId = req.tenantCtx.tenantId;
    const [existingItems, existingContacts] = await Promise.all([
      db.select({ clientId: configurationItems.clientId, itemType: configurationItems.itemType, name: configurationItems.name })
        .from(configurationItems).where(eq(configurationItems.tenantId, tenantId)),
      db.select({ clientId: contactRecords.clientId, name: contactRecords.name, email: contactRecords.email })
        .from(contactRecords).where(eq(contactRecords.tenantId, tenantId)),
    ]);
    const duplicateKeys = new Set(
      parsed.data.kind === "contacts"
        ? existingContacts.map((row) => importDuplicateKey("contacts", {
          client_id: row.clientId ?? "", name: row.name, email: row.email ?? "",
        }))
        : existingItems.map((row) => importDuplicateKey(parsed.data.kind, {
          client_id: row.clientId ?? "", item_type: row.itemType, name: row.name,
        })),
    );
    for (let index = 0; index < parsed.data.rows.length; index += 1) {
      const row = parsed.data.rows[index];
      try {
        const duplicateKey = importDuplicateKey(parsed.data.kind, row);
        if (duplicateKeys.has(duplicateKey)) throw new Error("Duplicate record");
        if (parsed.data.kind === "contacts") {
          const data = contactInput.parse({ clientId: row.client_id, siteId: row.site_id || null, name: row.name, title: row.title || null, email: row.email || null, phone: row.phone || null, contactType: row.contact_type || "technical", notes: row.notes || null });
          const invalid = await validClientAndSite(tenantId, data.clientId, data.siteId);
          if (invalid) throw new Error(invalid);
          await db.insert(contactRecords).values({ ...data, tenantId });
        } else {
          const itemType = parsed.data.kind === "ip_records" ? (row.item_type || "ip_address") : row.item_type;
          if (parsed.data.kind === "ip_records" && !ipRecordTypes.has(itemType)) throw new Error("item_type is not an IP or subnet record type");
          const data = configurationInput.parse({ name: row.name, itemType, clientId: row.client_id || null, siteId: row.site_id || null, status: row.status || "active", vendor: row.vendor || null, product: row.product || null, model: row.model || null, serialNumber: row.serial_number || null, ipAddress: row.ip_address || null, macAddress: row.mac_address || null, externalVaultReference: row.external_vault_reference || null, tags: row.tags ? row.tags.split(";").map((tag) => tag.trim()).filter(Boolean) : [], details: {}, notes: row.notes || null });
          const secretError = assertNoSecretMaterial(data);
          if (secretError) throw new Error(secretError);
          const invalid = await validClientAndSite(tenantId, data.clientId, data.siteId);
          if (invalid) throw new Error(invalid);
          await db.insert(configurationItems).values({ ...dates(data), tenantId, createdById: req.tenantCtx.userId });
        }
        duplicateKeys.add(duplicateKey);
        imported += 1;
      } catch (error: any) {
        errors.push({ row: index + 2, message: error.message });
      }
    }
    await emitEvent("operations.imported", req.tenantCtx.tenantId, req.tenantCtx.userId, "operations_import", undefined, { kind: parsed.data.kind, imported, errorCount: errors.length });
    res.json({ imported, errors });
  });

  app.get("/api/ops/search", ...staff, async (req: any, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json({ items: [], documents: [], contacts: [], clients: [], sites: [] });
    const tenantId = req.tenantCtx.tenantId;
    const pattern = `%${q}%`;
    const [items, documents, contactsFound, clientsFound, sitesFound] = await Promise.all([
      db.select().from(configurationItems).where(and(eq(configurationItems.tenantId, tenantId), or(ilike(configurationItems.name, pattern), ilike(configurationItems.ipAddress, pattern), ilike(configurationItems.serialNumber, pattern)))).limit(20),
      db.select().from(documentationPages).where(and(
        eq(documentationPages.tenantId, tenantId),
        inArray(documentationPages.minimumRole, visibleDocumentRoles(req.tenantCtx.role)),
        or(ilike(documentationPages.title, pattern), ilike(documentationPages.content, pattern)),
      )).limit(20),
      db.select().from(contactRecords).where(and(eq(contactRecords.tenantId, tenantId), or(ilike(contactRecords.name, pattern), ilike(contactRecords.email, pattern)))).limit(20),
      db.select().from(clients).where(and(eq(clients.tenantId, tenantId), ilike(clients.name, pattern))).limit(20),
      db.select().from(sites).where(and(eq(sites.tenantId, tenantId), ilike(sites.name, pattern))).limit(20),
    ]);
    res.json({ items, documents, contacts: contactsFound, clients: clientsFound, sites: sitesFound });
  });
}
