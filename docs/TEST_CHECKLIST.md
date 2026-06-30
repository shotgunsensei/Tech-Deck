# Tech Deck - End-to-End Sanity Test Checklist

## Pre-Flight

- [ ] `npm install` completes without errors
- [ ] `npm run db:push` completes without errors
- [ ] `npm run build` completes without errors
- [ ] `npm run dev` starts without errors on port 5000

## Authentication

- [ ] Launching Tech Deck from OperatorOS redirects to `/sso?token=...`
- [ ] Valid OperatorOS token redirects to the Tech Deck dashboard
- [ ] Wrong `iss`, `aud`, `env`, or module key is rejected before consume
- [ ] Expired, replayed, or old `iat` token is rejected before session creation
- [ ] Consume call posts to `${OPERATOROS_API_URL}/v1/modules/sso/consume`
- [ ] Consume replay returns stable JSON `{ code: "consume_failed", message }`
- [ ] `module_access_denied` browser flow lands on `/access-denied`
- [ ] `/access-denied` links back to OperatorOS
- [ ] Entitlement sync updates the stored snapshot and local role
- [ ] Entitlement sync with `target_module_enabled=false` revokes access and kills existing sessions
- [ ] Revoked users cannot continue using an existing session
- [ ] Direct registration is blocked in production
- [ ] Direct password login in production is limited to local system-admin emergency accounts
- [ ] After SSO login, user is redirected to onboarding (first visit) or dashboard
- [ ] Onboarding creates a tenant with the provided organization name
- [ ] Logout clears the session and redirects to the login page

## Core Module

- [ ] Dashboard loads and displays stats cards (evidence count, client count, etc.)
- [ ] Clients page lists clients; create/edit/delete works
- [ ] Sites page lists sites scoped to clients
- [ ] Assets page lists assets scoped to sites
- [ ] Team page (OWNER/ADMIN) lists members; invite flow works
- [ ] Client Access page (OWNER/ADMIN) assigns CLIENT users to specific clients
- [ ] Audit Log page displays filterable event log
- [ ] Settings page loads tenant settings

## Evidence Module

- [ ] Evidence page lists uploaded files
- [ ] Upload dialog accepts files and creates evidence records
- [ ] Search filters (text query, client, tag, date range) return correct results
- [ ] File preview works for images, PDFs, and text files
- [ ] File download returns the correct file

## License Module

- [ ] License products page lists products; create works
- [ ] License keys can be generated for a product
- [ ] Public validation endpoint (`POST /api/license/validate`) returns valid/invalid
- [ ] Developer docs page (`/license-docs`) renders correctly

## Webhooks Module

- [ ] Webhooks page lists configured endpoints
- [ ] Create webhook with URL and event selection works
- [ ] Webhook deliveries log shows delivery attempts

## Status Pages Module

- [ ] Status admin page lists status pages
- [ ] Create/edit status page works
- [ ] Components can be added with status values
- [ ] Incidents can be created and updated
- [ ] Public status page (`/status/:slug`) renders correctly

## Compliance Reports Module

- [ ] Reports page loads
- [ ] Generate report with filters produces a downloadable ZIP
- [ ] ZIP contains manifest, sha256sums, evidence files, and audit trail

## Client Portal

- [ ] CLIENT role user sees only Portal and My Evidence nav items
- [ ] Portal dashboard shows assigned clients
- [ ] My Evidence page shows evidence scoped to assigned clients only

## API Access Module

- [ ] API Tokens page (OWNER/ADMIN) loads with create button
- [ ] Creating a token shows one-time plaintext (starts with `snv_`)
- [ ] Token can be copied and dismissed
- [ ] Token appears in the active tokens list after dismissal
- [ ] Revoking a token removes it from the list
- [ ] `GET /api/v1/openapi.json` returns 200 with OpenAPI spec
- [ ] `GET /api/v1/evidence` without auth returns 401
- [ ] `GET /api/v1/evidence` with valid token + `evidence:read` scope returns 200
- [ ] `POST /api/v1/license/validate` with token missing `license:validate` scope returns 403
- [ ] `GET /api/v1/status/:slug` returns public status page data (no auth needed)

## API-Only Mode

- [ ] Setting `API_ONLY=true` and restarting serves only `/api/v1/*` and `/health`
- [ ] `/health` returns `{ "status": "ok", "mode": "api_only" }`
- [ ] SPA routes return 404 or are not registered
- [ ] Bearer token auth works for protected v1 endpoints

## Cross-Cutting

- [ ] Sidebar navigation reflects user role (OWNER/ADMIN see admin items, CLIENT sees portal)
- [ ] Dark mode toggle works and persists across page loads
- [ ] All data is tenant-scoped (no cross-tenant data leaks)
- [ ] Breadcrumb navigation updates correctly on page changes
