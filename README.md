# Tech Deck

**The IT operations cockpit for MSPs and senior technical teams.**

A multi-tenant SaaS platform that centralizes tickets, scripts, evidence, automation, and technician workflows. Built for managed service providers, internal IT teams, and solo technicians who are tired of stitching together five disconnected tools.

> Tech Deck is part of the **Shotgun Ninjas Productions** product ecosystem. See [ecosystem](#ecosystem) below for sister platforms.

---

## Ecosystem

Tech Deck is one focused tool in the Shotgun Ninjas Productions suite. Each product solves a specific operational problem; they are designed to interoperate but stand alone.

| Product | Domain | What it does |
|---|---|---|
| **Tech Deck** *(this app)* | techdeck.app | IT operations cockpit — tickets, evidence, automation, audit |
| TradeFlowKit | tradeflowkit.com | Business ops — leads → quotes → jobs → invoices pipeline |
| TorqueShed | torqueshed.pro | Automotive diagnostics, repair cases, mechanic community |
| PulseDesk | pulsedesk.support | Healthcare operations coordination |
| FaultlineLab | faultlinelab.com | Diagnostic challenges & technical problem-solving training |
| ShotgunNinjaVillage | shotgunninjavillage.com | Community, games, merch, creator content |
| ShotgunNinjas.com | shotgunninjas.com | Ecosystem hub — full catalog and brand home |

**Natural pairings for Tech Deck users:**
- **TradeFlowKit** — for IT shops that also need to run sales/quoting/invoicing
- **FaultlineLab** — to train and certify bench techs on real diagnostic scenarios
- **ShotgunNinjas.com** — the central brand hub

---

## Modules

Tech Deck ships with **8 modules**, all enabled by default:

| Module | Description |
|--------|-------------|
| **Core Platform** | Tenants, users, roles (OWNER/ADMIN/TECH/CLIENT), clients, sites, assets, audit log |
| **Evidence Locker** | Upload, tag, search, preview, and download evidence files with SHA-256 deduplication |
| **License Server** | Products, key issuance/revocation, activation tracking, public validation API |
| **Webhooks** | Outbound delivery with HMAC-SHA256 signing, retries, SSRF protection, delivery logs |
| **Status Pages** | Public status pages with component monitoring and incident tracking |
| **Compliance Reports** | ZIP evidence packets with manifest, checksums, audit trail |
| **API Access** | Token-based `/api/v1` endpoints, scoped permissions, headless `API_ONLY` mode |
| **Client Portal** | Read-only portal for CLIENT role users scoped to their assigned clients |

---

## Stack

- **Frontend**: React 18 + Vite + TypeScript, wouter (routing), TanStack Query v5 (data), shadcn/ui + Tailwind CSS (UI)
- **Backend**: Express + TypeScript (single port serves API and SPA)
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Replit Auth (OIDC) via passport / openid-client
- **Storage**: Local disk via `StorageProvider` abstraction (S3-ready)
- **Events**: In-process typed event bus with automatic audit logging

---

## Quick Start (Replit)

1. **Create a Repl** — import this repo or fork the project.
2. **Provision a database** — use the built-in Replit Postgres (automatically sets `DATABASE_URL`).
3. **Set required secrets** in the Secrets tab:

   | Secret | Purpose |
   |--------|---------|
   | `DATABASE_URL` | PostgreSQL connection string (auto-set by Replit DB) |
   | `SESSION_SECRET` | Random string for signing session cookies |

   Replit Auth secrets (`REPL_ID`, `ISSUER_URL`) are provided automatically when Auth is configured.

4. **Push the schema**:
   ```
   npm run db:push
   ```
5. **Run**:
   ```
   npm run dev
   ```

The app starts on port 5000 and serves both the API and the frontend.

### Production build

```
npm run build
npm run start
```

---

## Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_UPLOAD_MB` | `25` | Max evidence upload size in MB |
| `API_ONLY` | `false` | Headless mode — serves only `/api/v1` and `/health` |
| `ALLOW_INTERNAL_WEBHOOKS` | `false` | Permit webhook URLs targeting private IPs (dev only) |
| `DEV_AUTH_BYPASS` | `false` | Skip OIDC login in development |
| `DEV_USER_ID` | `dev-user` | User ID when auth bypass is active |
| `DEV_USER_EMAIL` | `dev@localhost` | Email when auth bypass is active |
| `DEV_TENANT_SLUG` | `dev` | Tenant slug when auth bypass is active |

---

## Module System

Modules are registered in `shared/modules/index.ts` and implemented as:

- **Server routes**: `server/modules/<module>/routes.ts`
- **Client pages**: `client/src/modules/<module>/...`

Each module declares its own events, navigation items, and role restrictions. Enabled modules automatically appear in the sidebar.

---

## Security

- Tenant-scoped data isolation on every query
- Role-based authorization enforced server-side
- Uploads validated and hashed (SHA-256) for integrity and dedup
- API tokens and license keys stored as SHA-256 hashes
- Webhook payloads signed with HMAC-SHA256; SSRF protection with DNS lookup
- Session cookies: httpOnly, secure, sameSite=lax
- Security headers and CSP in production
- Append-only audit log

See [docs/SECURITY.md](docs/SECURITY.md) for full details.

---

## Documentation

- [Release Notes v1.0.0](docs/RELEASE_NOTES_v1.md)
- [Security Policy](docs/SECURITY.md)
- [Deployment Guide (Replit)](docs/DEPLOYMENT_REPLIT.md)
- [Test Checklist](docs/TEST_CHECKLIST.md)

---

## License

MIT (see package.json)
