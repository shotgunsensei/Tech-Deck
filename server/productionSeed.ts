import { db } from "./db";
import { users } from "@shared/models/auth";
import { tenants, pendingInvitations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "./auth/authService";

export async function ensureProductionSetup() {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  try {
    await ensureSuperAdminAccount({
      email: "john@shotgunninjas.com",
      password: "Dr0p$0fJup1t3r",
      firstName: "John",
      lastName: "Admin",
    });
    await ensureSuperAdminAccount({
      email: "jwilliams@xodus-is.com",
      password: "ApplePiesTasteFine4!",
      firstName: "J",
      lastName: "Williams",
    });
    await ensureSystemAdmin("johntwms355@gmail.com");
    await ensureXodusLegacyTenant();
    await ensurePendingInvitation("Xodus Technology Professionals", "rbest@xodus-is.com", "TECH");
    console.log("[setup] Production setup checks complete");
  } catch (err) {
    console.error("[setup] Production setup error (non-fatal):", err);
  }
}

async function ensureSuperAdminAccount(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}) {
  const normalizedEmail = data.email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalizedEmail));

  if (existing) {
    if (!existing.isSystemAdmin || !existing.passwordHash) {
      const updates: Record<string, unknown> = { isSystemAdmin: true };
      if (!existing.passwordHash) {
        updates.passwordHash = await hashPassword(data.password);
      }
      await db.update(users).set(updates).where(eq(users.id, existing.id));
      console.log(`[setup] Updated ${normalizedEmail} as super admin`);
    }
    return;
  }

  const passwordHash = await hashPassword(data.password);
  await db.insert(users).values({
    email: normalizedEmail,
    passwordHash,
    firstName: data.firstName,
    lastName: data.lastName,
    isSystemAdmin: true,
  });
  console.log(`[setup] Created super admin account: ${normalizedEmail}`);
}

async function ensureSystemAdmin(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (user && !user.isSystemAdmin) {
    await db.update(users).set({ isSystemAdmin: true }).where(eq(users.id, user.id));
    console.log(`[setup] Set ${email} as system admin`);
  }
}

async function ensureXodusLegacyTenant() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.name, "Xodus Technology Professionals"));
  if (!tenant) return;

  console.log("[setup] Xodus tenant exists. Local plan/subscription repair skipped; OperatorOS owns entitlements.");
}

async function ensurePendingInvitation(tenantName: string, email: string, role: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.name, tenantName));
  if (!tenant) return;

  const [existing] = await db
    .select()
    .from(pendingInvitations)
    .where(
      and(eq(pendingInvitations.tenantId, tenant.id), eq(pendingInvitations.email, email.toLowerCase()))
    );

  if (!existing) {
    await db.insert(pendingInvitations).values({
      tenantId: tenant.id,
      email: email.toLowerCase(),
      role: role as any,
    });
    console.log(`[setup] Added pending invitation for ${email} to ${tenantName}`);
  }
}
