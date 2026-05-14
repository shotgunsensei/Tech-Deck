# Tech Deck

## Overview
Tech Deck is a multi-tenant SaaS web application for IT professionals and Managed Service Providers (MSPs). It provides a comprehensive platform for managing MSP operations, including ticketing, invoicing, role-based access control, evidence file management, client and asset tracking, and audit logging. The platform aims to streamline workflows, enhance security, and provide robust reporting for compliance and operational efficiency. Key modules include `core`, `evidence`, `license`, `webhooks`, `status`, and `reports`, designed for scalability and extensibility.

## User Preferences
I prefer detailed explanations.
I want iterative development.
Ask before making major changes.
Do not make changes to the `shared/modules/index.ts` file.
Do not make changes to the `server/authz.ts` file.

## System Architecture

### UI/UX Decisions
The frontend is built with React, Vite, wouter for routing, TanStack Query for data fetching, shadcn/ui for UI components, and Tailwind CSS for styling. The design focuses on a clean, intuitive, and responsive interface with clear navigation, accessible data presentation, a persistent sidebar, dynamic breadcrumbs, and consistent theming. A dedicated mobile technician view (`/m`) provides a compact, bottom-tab-navigated experience for on-the-go field access to tickets (with CRUD, status changes, comments), time tracking (with quick-log presets and today/week summaries), and the dispatch calendar (day-view timeline with create/edit/delete).

### Landing Page
Public landing page at `/` is positioned as "IT operations cockpit for MSPs and senior technical teams" (Shotgun Ninjas Productions ecosystem branding). Sections: sticky header with anchor nav (Features/Use Cases/Pricing/FAQ), hero with techdeckhero image and screen-reader h1, stats strip, problem section (3 pain points), solution intro, 9-card feature grid, 3-card use cases (MSPs/Internal IT/Solo), 3-tier pricing preview (Solo Free, Pro $29, MSP $79 — values match `DEFAULT_PLANS` in `server/modules/billing/stripe.ts`), trust section, FAQ accordion (8 items), final CTA, enhanced footer with Shotgun Ninjas Productions attribution. Plan tier numbers (price, users, storage) MUST stay in sync with backend `DEFAULT_PLANS`.

### Technical Implementations
The application follows a modular, multi-tenant architecture with strict data isolation (`tenantId` scoping).
- **Frontend**: React, Vite, wouter, TanStack Query, shadcn/ui, Tailwind CSS.
- **Backend**: Express.js with TypeScript, providing a robust API.
- **Database**: PostgreSQL with Drizzle ORM for type-safe data interaction.
- **Authentication**: Custom email/password authentication with TOTP-based MFA. Uses bcrypt for password hashing (12 salt rounds), `otplib` for TOTP generation/verification, `qrcode` for QR code rendering, and `connect-pg-simple` for PostgreSQL session storage. Features account lockout (5 failed attempts, 15-min lockout), rate limiting on auth endpoints, session regeneration on login/register, and hashed recovery codes. Auth module located at `server/auth/`. Account Security page at `/account-security` provides password change and MFA enable/disable controls, accessible from sidebar user dropdown.
- **Authorization**: Fine-grained role-based access control (OWNER, ADMIN, TECH, CLIENT) and client-specific permissions.
- **File Storage**: Local disk storage with a `StorageProvider` interface, featuring SHA-256 deduplication for evidence files.
- **Module System**: Dynamic module registry defining six core modules (`core`, `evidence`, `license`, `webhooks`, `status`, `reports`), each capable of registering server routes and client pages.
- **Event-Driven Architecture**: Utilizes an `EventBus` for typed domain events, supporting decoupled components and automatic audit logging.
- **Feature Set**: Includes comprehensive evidence management (upload, deduplicate, search, tag), a license server, a restricted client portal, compliance report generation (ZIP packets), public status pages, configurable webhooks with HMAC-SHA256 signing, detailed audit logging, user and team management, and a role-tailored dashboard.
- **API Access Module**: Manages API tokens with scopes, enabling programmatic access to specific endpoints.
- **Billing Module**: Integrates with Stripe for subscription management (plans: solo, pro, msp, enterprise), usage tracking, and plan enforcement. Includes a payment grace period system for paused accounts and scheduled tenant deletion.
- **System Admin Module**: Provides system-wide administrative functions for managing tenants and users.
- **Pending Invitations**: Supports auto-joining users to tenants upon registration via pending invitations.
- **CSV Import/Export**: Backend endpoints for CSV template downloads and bulk import of clients, sites, and assets with per-row validation and audit trails.
- **Demo Data Module** (`server/modules/demo/routes.ts`): One-click sample data seeding for empty workspaces. `POST /api/demo/seed` (OWNER/ADMIN) creates 3 demo clients, 3 sites, 3 assets, and 5 tickets. Idempotent (refuses if any clients exist). Emits `demo_seed` audit event.
- **OperatorOS SSO** (`server/auth/sso.ts`): Accepts HS256 JWT handoffs at `GET /sso?token=...` from the OperatorOS parent platform. Verifies signature, `iss=operatoros`, `aud=techdeck` (audience env default, must be lowercase), `env`, `exp`, `iat ≤ 90s` (±5s skew), and required `module_slug` claim. POSTs `{jti, aud, env}` to `{OPERATOROS_API_URL}/v1/modules/sso/consume` for single-use enforcement, then lazily provisions via `findOrCreateSsoUser` keyed on the **JWT `sub` claim** (stored in `users.sso_subject`, never on email — emails can change/collide). Tenants are namespaced with an `os-` slug prefix so a hostile `organization_id` claim cannot hijack a locally-registered tenant. Membership role is mapped from the claim (owner/admin/tech/client). Mints a fresh express-session via `regenerate`+`save` and redirects to `/`. Coexists with email/password+TOTP login. **Startup behavior:** if `MODULE_SSO_SECRET` is set but invalid (<16 chars, or missing `OPERATOROS_BASE_URL`/`OPERATOROS_API_URL`/`OPERATOROS_SSO_ENV`, or wrong audience) the server fails to boot loudly. If completely unset, a loud WARN is logged and `/sso` returns `503 sso_not_configured` — this lets instances that haven't adopted SSO continue to boot. Response shape is always `{code, message}`. Reject codes: `missing_token`/`bad_request` (400), `signature_invalid`/`issuer_mismatch`/`audience_mismatch`/`env_mismatch`/`expired`/`clock_skew`/`consume_failed` (401), `sso_consume_unavailable` (502). Upstream consume errors mapped: `TOKEN_UNKNOWN`/`TOKEN_REPLAYED`→`consume_failed`, `TOKEN_EXPIRED`→`expired`, `AUDIENCE_MISMATCH`/`ENV_MISMATCH`→matching codes, 5xx/network→`sso_consume_unavailable` (fail-closed). Token never persisted; `MODULE_SSO_SECRET` and `req.query.token` redacted in logs. Module slug is lowercase `techdeck`. Tests at `tests/sso.test.ts` (24 cases covering verify, consume, and `/sso` route end-to-end).
- **Mail Abstraction** (`server/mail.ts`): Lazy SMTP transport via dynamic `nodemailer` import. Falls back to console-log no-op when `SMTP_HOST` is not set. Used by password reset / invitations / billing receipts. Install nodemailer to enable live SMTP.
- **Global Write Rate Limit** (`server/index.ts`): 120 writes/min per IP across POST/PATCH/PUT/DELETE. Excludes `/v1/*` (API tokens have their own quotas), `/api/auth/*` (separate auth limiter), `/t/upload/*` (public intake), and `/api/stripe/webhook`.
- **Plan Badge & Upgrade Overlay** (`client/src/components/plan-badge.tsx`, `upgrade-overlay.tsx`): Sidebar header shows current plan tier (Solo/Pro/MSP/Enterprise) linking to /billing; `<UpgradeOverlay>` renders in place of locked features with a clear upgrade CTA instead of silent hiding.
- **Public Pricing Page** (`/pricing`): Side-by-side 4-plan comparison with 19-row feature matrix and FAQ. Plan numbers must stay in sync with `DEFAULT_PLANS` in `server/modules/billing/stripe.ts`.
- **Legal Pages**: `/terms` and `/refund` static pages linked from landing footer.
- **Reusable UI Primitives**: `<EmptyState>`, `<ListSkeleton>`, `<CardGridSkeleton>`, `<PageHeaderSkeleton>`, `<ErrorBoundary>` in `client/src/components/`. Used in route shells and list pages.
- **Code-Splitting**: All routes in `client/src/App.tsx` use `React.lazy` + `Suspense`, wrapped in a `RouteShell` that combines `ErrorBoundary` + lazy fallback. Page modules export defaults directly (no shim files in `client/src/pages/` for module routes).
- **Mobile Auto-Redirect** (`client/src/hooks/use-mobile-redirect.ts`): On first authenticated load, mobile UA visitors are routed to `/m`; dismissal stored in localStorage.
- **SEO**: `client/public/robots.txt` and `client/public/sitemap.xml` shipped at site root.
- **Structured Logging** (`server/logger.ts`): pino with pretty-print in dev, JSON in prod. Auto-redacts auth headers, cookies, password fields, TOTP tokens, and recovery codes. `requestIdMiddleware` assigns/propagates `x-request-id` and exposes `req.log` as a child logger with `reqId` binding for correlated traces.
- **Test Suite** (`vitest.config.ts`, `tests/`): vitest + supertest scaffold. Smoke, auth-schema-contract, and tenant-isolation invariant tests in place. Run with `npx vitest run`.
- **Per-Module Index** (`server/modules/MODULES.md`): table of all 21 server modules with owner/public/plan-gated columns and the global write-limiter exclusion list.
- **Dependency Audit** (`SECURITY_AUDIT.md`): npm audit results and mitigations.
- **Refactor Plan** (`REFACTOR_PLAN.md`): documented plans for T10 (storage.ts decomposition) and T11 (schema.ts split). Both deferred to dedicated follow-up sessions due to drizzle `relations()` circular-import risk.
- **IT Ops Console Module**: AI-powered operations tool for senior engineers and MSPs. Features five modes (Quick Fix, Script Builder, Deep Dive, Network Analysis, System Design) with structured response engine (Summary → Action Steps → Commands → Advanced Insight). Uses OpenAI via Replit AI Integrations with streaming SSE responses and retry logic on connection failures. Dark terminal-style UI (expert-only, no beginner mode). Features: syntax highlighting for code blocks (PowerShell/Bash/Python), Copy All button, per-block copy buttons, localStorage-cached last 5 queries, Knowledge Vault (save/tag/search/load responses locally), export as Markdown or text file, Run Again button. Role-gated to OWNER/ADMIN/TECH with Zod input validation, XSS-safe rendering, size limits, and client disconnect handling.
- **Secure Intake Module**: Multi-tenant secure file intake for receiving documents from external parties. Features: intake spaces (organized containers with per-space settings), upload requests (token-based secure links with optional password protection, expiration, upload limits), file management (upload, download, review/approve/reject workflow), immutable audit logging, tenant-level policies (default file types, retention, compliance notices), storage quota monitoring with plan-based limits. Public upload page at `/t/upload/:token` supports drag-and-drop, file type restrictions, and one-time-use links. Backend at `server/modules/secure-intake/routes.ts`, frontend at `client/src/modules/secure-intake/`. Role-gated: OWNER/ADMIN for policies/audit/storage, TECH+ for spaces/requests/files. Plan limits: `intakeSpacesMax`, `intakeRequestsPerMonth`, `intakeStorageGb`. Security: dangerous extension blocklist, MIME-vs-extension validation, filename sanitization, tenant pause/deleted checks on all public endpoints (info/verify-password/upload), bcrypt password hashing (12 rounds) with audit logging on failures, `X-Content-Type-Options: nosniff` on downloads. Integration: `requireFeature("intake")` and `checkLimit("intakeSpacesMax")` via `enforcePlan.ts`, `emitEvent()` on all state-changing operations including public uploads and auto-expiry, Zod validation on all request bodies.
- **Core MSP Functionality**:
    - **Ticketing System**: Full CRUD for tickets, comments, and SLA profiles with status indicators.
    - **Dispatch Calendar**: CRUD for appointments with date range filtering and a weekly grid view.
    - **Time Tracking**: Log time entries, linked to tickets, clients, and users.
    - **Invoicing System**: Manages billing configurations, invoice generation, line items, and public invoice views.
    - **Knowledge Base**: CRUD for articles with categories and search functionality.
    - **Recurring Ticket Templates**: Defines scheduled ticket creation via cron expressions.
    - **Client Portal Extensions**: Allows clients to submit and view tickets, and view invoices.
    - **Dashboard Widgets**: Provides an overview of key statistics and alerts.

## External Dependencies
- **PostgreSQL**: Primary database.
- **bcrypt**: Password hashing.
- **otplib**: TOTP MFA generation and verification.
- **qrcode**: QR code generation for MFA setup.
- **connect-pg-simple**: PostgreSQL session store.
- **Express.js**: Backend web framework.
- **React**: Frontend library.
- **Vite**: Frontend build tool.
- **wouter**: Frontend router.
- **TanStack Query**: Data fetching and caching.
- **shadcn/ui**: UI component library.
- **Tailwind CSS**: CSS framework.
- **Drizzle ORM**: TypeScript ORM.
- **papaparse**: Server-side CSV parsing.
- **Stripe**: Payment processing via Replit connector.
- **OpenAI**: AI capabilities via Replit AI Integrations (no API key required, billed to Replit credits).