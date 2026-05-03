# Server Modules

Each module lives under `server/modules/<name>/` and registers its routes from `server/routes.ts`. All modules use the shared `storage` (`server/storage.ts`), `emitEvent` for audit logging, and the `requireRole` / `requireTenant` / `requireClientAccess` helpers from `server/authz.ts`.

| Module | Owner concern | Public? | Plan-gated? |
|--------|---------------|---------|-------------|
| `account` | Per-user account settings, password change, MFA | Auth | No |
| `admin` | System-wide tenant/user admin (system_admin only) | Auth | No |
| `api` | API token management + `/v1/*` token-scoped public API | Mixed | No |
| `billing` | Stripe subscription management, plans, usage, customer portal | Auth | – |
| `calendar` | Dispatch calendar appointments | Auth | No |
| `core` | Tenants, clients, sites, assets, members, audit, CSV import/export | Auth | No |
| `demo` | One-click sample data seed for empty workspaces | Auth (OWNER/ADMIN) | No |
| `evidence` | Compliance evidence files with SHA-256 dedupe | Auth | No |
| `invoicing` | Billing config, invoice generation, line items, public invoice view | Auth + public | No |
| `itops` | AI-powered IT operations console (OpenAI streaming SSE) | Auth (OWNER/ADMIN/TECH) | Yes |
| `kb` | Knowledge base articles, categories, search | Auth | No |
| `license` | License server endpoints | Public (token) | No |
| `portal` | Client-portal extensions: tickets/invoices for CLIENT role | Auth (CLIENT) | No |
| `recurring` | Recurring ticket templates (cron-driven) | Auth | No |
| `reports` | Compliance report generation (ZIP packets) | Auth | Yes |
| `reviewer` | Evidence reviewer workflow | Auth | No |
| `secure-intake` | Multi-tenant external file intake with per-link tokens | Mixed (`/t/upload/:token` is public) | Yes (`intake`) |
| `status` | Public status pages | Public | No |
| `tickets` | Ticketing CRUD, comments, SLA profiles | Auth | No |
| `time` | Time entries linked to tickets/clients/users | Auth | No |
| `webhooks` | Outbound webhooks with HMAC-SHA256 signing + worker | Auth + public sink | No |

## Conventions

- **Routes**: `server/modules/<name>/routes.ts` exports `register<Name>Routes(app)`; mounted in `server/routes.ts`.
- **Workers**: Background jobs (e.g. `webhooks/worker.ts`) are started from `server/routes.ts` after route registration.
- **Validation**: All `req.body` parsing goes through Zod schemas — usually the `insertXxxSchema` from `@shared/schema` extended via `.pick`/`.extend`.
- **Tenant isolation**: Every storage call is scoped by `tenantId` from `req.tenantCtx`. Never trust a tenantId from the request body.
- **Events**: State-changing operations call `emitEvent(action, tenantId, userId, entity, entityId, payload)` for the audit trail.
- **Plan enforcement**: Plan-gated modules use `requireFeature("featureName")` and/or `checkLimit("limitName")` from `server/core/billing/enforcePlan.ts`.

## Excluded from the global write rate limiter

`server/index.ts` exempts the following from the 120 writes/min limiter (each has its own controls):

- `/v1/*` — API token routes (per-token quotas)
- `/api/auth/*` — separate stricter auth limiter
- `/t/upload/*` — public intake (per-link upload caps)
- `/api/stripe/webhook` — signed Stripe webhooks
