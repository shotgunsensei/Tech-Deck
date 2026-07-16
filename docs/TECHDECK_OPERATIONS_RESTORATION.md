# TechDeck Operations Restoration Report

## Outcome

TechDeck is again a working IT documentation and infrastructure operations application rather than a placeholder shell. The existing MSP platform was preserved: OperatorOS SSO and entitlements, tenant membership, clients, sites, legacy assets, evidence, tickets, calendar, time, invoicing, knowledge base, audit, secure intake, licensing, status, webhooks, API tokens, mobile routes, and IT Ops Console remain intact.

The restoration adds a tenant-scoped operations graph and versioned documentation workspace at these primary routes:

- `/inventory` — infrastructure, systems, applications, vendors, configuration records, credential references, contacts, relationships, evidence attachments, and CSV import.
- `/network` — firewalls, switches, access points, network devices, domains, DNS, DHCP, VLANs, subnets, IPs, ISPs, circuits, public IPs, and port mappings.
- `/documentation` — folders, documentation pages, runbooks, procedures, knowledge articles, Markdown content, cross-links, backlinks, role restrictions, evidence attachments, export, and revision history.
- `/lifecycle` — licenses, certificates, warranties, expiration dates, renewal dates, assigned-system relationships, and 90-day dashboard alerts.

Inventory and contact records can be created and edited from the workspace. Contact forms include client/site association, and the import tab supports infrastructure, contact, and IP/subnet datasets with an explicit preview before commit.

## Recovered components

Git history and all available branches were inspected before implementation. There was one branch (`main`) and no deleted historical network/documentation module to restore. The real recoverable product was the existing MSP platform in the current tree. The restoration reuses and preserves:

- Clients, sites, legacy assets, evidence, tags, and audit events.
- OperatorOS SSO identity, tenant, role, entitlement snapshot, coordinated child-app logout, billing return links, and inactive-subscription write blocking.
- Existing Knowledge Base. It remains available at `/kb`; the documentation workspace adds client-aware versioned knowledge articles without removing the original module.
- Existing Evidence Vault for validated file upload and storage. Operational attachments are tenant-checked links to evidence records, avoiding a second upload/security implementation.
- Existing client detail dashboard, now extended with infrastructure, documentation, and contact counts plus record previews.
- Existing command dashboard, now extended with infrastructure, documentation, lifecycle alerts, and quick actions.

## New database schema

All new tables use `tenant_id`, tenant-filtered queries, cascading tenant deletion, and targeted indexes.

| Table | Purpose | Important controls |
|---|---|---|
| `contact_records` | Client/site contacts and escalation references | Client required, optional site, tenant indexes |
| `configuration_items` | Typed inventory for systems, network, lifecycle, vendors, configuration items, and external credential references | No secret fields; external vault reference only; client/site validation; lifecycle dates; JSON metadata; tags |
| `configuration_relationships` | Directed dependencies, connections, hosting, routing, backup, assignment, and coverage | Both endpoints must exist in the same tenant; self-links rejected; uniqueness constraint |
| `documentation_folders` | Hierarchical shared/client folders | Tenant parent lookup; child-safe deletion |
| `documentation_pages` | Documentation, runbooks, procedures, and knowledge articles | Tenant-unique slug; draft/published/archived; minimum role; Markdown stored as text; current version |
| `documentation_revisions` | Immutable page snapshots | Unique page/version; created in the same transaction as page create/update |
| `operational_attachments` | Links existing evidence to a configuration item or documentation page | Both evidence and parent ownership verified in tenant; exactly one parent required |

The schema is defined in `shared/schema.ts`. This repository uses Drizzle `push` rather than checked-in versioned migrations. Apply it with:

```bash
npm run db:push
```

The push was verified against an isolated PostgreSQL 16 database on July 15, 2026.

## Configuration item types

The unified configuration model supports:

- `server`, `workstation`, `network_device`, `firewall`, `switch`, `access_point`, `printer`
- `application`, `domain`, `dns_record`, `dhcp_scope`, `vlan`, `subnet`, `ip_address`, `public_ip`
- `isp`, `circuit`, `vendor`, `license`, `certificate`, `warranty`, `port_mapping`
- `configuration_item`, `credential_reference`

Clients and sites remain first-class existing tables. Contacts are first-class records. Notes, tags, attachments, audit events, and relationships are first-class supporting records. Knowledge articles are supported by both the existing KB module and the versioned documentation page type.

## APIs

All routes below require an authenticated session plus `OWNER`, `ADMIN`, or `TECH` tenant membership. Every write also uses the existing inactive-subscription middleware. Delete operations for contacts, configuration items, folders, and documents require `OWNER` or `ADMIN`.

### Summary and search

- `GET /api/ops/summary`
- `GET /api/ops/search?q=`

### Contacts

- `GET /api/ops/contacts`
- `POST /api/ops/contacts`
- `PATCH /api/ops/contacts/:id`
- `DELETE /api/ops/contacts/:id`

### Configuration inventory

- `GET /api/ops/items`
- `GET /api/ops/items/:id`
- `POST /api/ops/items`
- `PATCH /api/ops/items/:id`
- `DELETE /api/ops/items/:id`

Supported filters include `q`, `clientId`, `siteId`, `status`, `itemType`, and `group=network|lifecycle`.

### Relationships and attachments

- `POST /api/ops/relationships`
- `DELETE /api/ops/relationships/:id`
- `POST /api/ops/attachments`
- `DELETE /api/ops/attachments/:id`

### Documentation

- `GET /api/ops/folders`
- `POST /api/ops/folders`
- `DELETE /api/ops/folders/:id`
- `GET /api/ops/documents`
- `GET /api/ops/documents/:id`
- `POST /api/ops/documents`
- `PATCH /api/ops/documents/:id`
- `DELETE /api/ops/documents/:id`
- `GET /api/ops/documents/export?ids=<comma-separated ids>`

### Import

- `POST /api/ops/import/preview`
- `POST /api/ops/import/commit`

Import kinds are `items`, `contacts`, and `ip_records`. Preview normalizes headers, validates tenant-owned client/site IDs and client/site pairing, validates email and record types, detects both persisted and within-file duplicates, and returns row-level errors. Commit revalidates every row, rechecks duplicates to prevent preview/commit drift, caps batches at 1,000 rows, audits the result, and returns row-level errors without hiding partial success. IP imports accept DNS, DHCP, VLAN, subnet, private IP, and public IP record types.

## Security controls

- All database reads and writes include the authenticated tenant ID.
- Client and site IDs are verified against that tenant before writes.
- Relationship endpoints verify both records in the same tenant.
- Attachment endpoints verify the evidence record and parent record in the same tenant.
- `CLIENT` users cannot access the staff operations APIs or workspace routes.
- Publishing and role-restricting documentation is limited to owners/admins.
- Documentation list/detail/search/export filters by minimum role server-side.
- Documentation folder/client associations are tenant-validated, and tenant predicates are repeated on relational joins as defense in depth.
- Restricted documents cannot be downgraded or modified by a lower-role user who knows the record ID; backlinks and attachment mutations apply the same document visibility policy.
- Documentation writes create an audit event and an immutable revision transactionally.
- Configuration items reject detail keys matching password, passphrase, secret, token, API key, private key, or credential value.
- Credential references require an external vault reference. TechDeck does not store or reveal secret values and never returns them from list APIs.
- Documentation strips script/iframe/object blocks, inline event handlers, JavaScript URLs, and null bytes. The React preview renders stored content as text and never uses raw HTML injection.
- Operational files continue through Evidence Vault upload validation and audit controls.
- Existing application CSRF, session, rate-limit, structured logging, and OperatorOS entitlement protections remain in force.

## Verification

Completed locally on July 15, 2026:

| Check | Result |
|---|---|
| `npm run check` | Passed |
| `npm test` | 15 files, 155 tests passed |
| `TEST_DATABASE_URL=<isolated-postgres-url> npm run test:operations:db` | 2 files, 5 database integration tests passed |
| `npm run build` | Passed; Vite client and bundled Express server produced |
| `npm run db:push` against PostgreSQL 16 | Passed; schema applied successfully |
| Persistence probe | Configuration items, relationships, documents, revisions, and imports persisted across API reloads |
| Tenant isolation probe | A second tenant's configuration item returned 404; cross-tenant client/folder associations were rejected |

The automated suite now includes operations schema, route registration, authorization/tenant contracts, secret-field rejection, stored-XSS sanitization, primary UI route registration, transactional revision coverage, two-tenant database denial, restricted-document enforcement, relationship persistence, search, and import duplicate validation. A combined integration journey signs an OperatorOS-style launch JWT, consumes it through a mocked OperatorOS endpoint, provisions the tenant session, and creates/reloads/searches a client, site, server, firewall, VLAN, subnet, relationship, and published runbook. Existing SSO, session revocation, OperatorOS entitlements, billing decommission, and route-navigation coverage continues to pass.

## Deployment requirements

1. Configure the existing TechDeck and OperatorOS environment variables documented in `docs/OPERATOROS_SSO.md` and `docs/OPERATOROS_ENTITLEMENTS.md`.
2. Provide `DATABASE_URL` and run `npm run db:push` before deploying the new build.
3. Run `npm run check`, `npm test`, and `npm run build` in the deployment environment. Point `TEST_DATABASE_URL` at a disposable PostgreSQL database and run `npm run test:operations:db` for the persistence/isolation suite.
4. Deploy the full Express application. This is not a static-only site; SSO, sessions, APIs, tenant enforcement, PostgreSQL, and file/evidence routes require the server.
5. Keep OperatorOS as the only subscription and entitlement authority. Do not re-enable TechDeck-local billing mutations.
6. Configure an approved external vault and store only its non-secret item URL/ID in `externalVaultReference` for credential references.
7. Perform the live SSO launch/return/revocation matrix in `docs/TECHDECK_OPERATOROS_SMOKE_TEST.md` with production-matching secrets.

No new environment variables are required by the operations workspace itself.

## Known limitations

- Live OperatorOS launch, session renewal, revocation, and return navigation were not exercised in this local run because production SSO secrets and endpoints were not present. The existing 24-case SSO harness and all OperatorOS regression tests passed.
- Lifecycle notifications are currently in-app dashboard alerts for the next 90 days. Email/SMS/webhook renewal delivery is not added in this restoration.
- Documentation editing is portable Markdown with a safe text preview, not a WYSIWYG editor.
- CSV preview/commit and the primary UI support items, contacts, and IP records. Imports currently use canonical column names and tenant UUIDs; a name-to-ID mapping wizard is not included.
- The configuration model uses typed records plus validated metadata so new infrastructure categories do not require new tables. Highly specialized forms (for example switch port matrices) use key/value technical details in this release.
- A live browser end-to-end run through OperatorOS requires environment credentials. Route, auth, persistence, tenant, and production-build checks were completed locally; the deployment smoke checklist remains mandatory.

## Recommended next increment

Add scheduled lifecycle notification delivery through the existing webhook/event system and a Playwright environment that launches from a real OperatorOS test tenant. That closes the two remaining environment-dependent acceptance items without changing the restored data model.
