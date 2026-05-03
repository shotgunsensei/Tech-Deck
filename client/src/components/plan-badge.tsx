import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { Link } from "wouter";

interface SubscriptionData {
  subscription: { planCode?: string | null; status?: string | null } | null;
  plan?: { name?: string | null } | null;
}

const PLAN_VARIANTS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  solo: { label: "Solo", variant: "outline" },
  pro: { label: "Pro", variant: "secondary" },
  msp: { label: "MSP", variant: "default" },
  enterprise: { label: "Enterprise", variant: "default" },
};

export function PlanBadge({ canManage }: { canManage: boolean }) {
  const { data } = useQuery<SubscriptionData>({
    queryKey: ["/api/billing/subscription"],
    enabled: canManage,
    staleTime: 60_000,
  });

  if (!canManage) return null;

  const code = data?.subscription?.planCode || "solo";
  const meta = PLAN_VARIANTS[code] || { label: code, variant: "outline" as const };
  const showUpgrade = code === "solo";

  const badge = (
    <Badge variant={meta.variant} className="gap-1 text-xs" data-testid={`plan-badge-${code}`}>
      {showUpgrade && <Sparkles className="w-3 h-3" />}
      {meta.label}
    </Badge>
  );

  return (
    <Link href="/billing" className="hover-elevate rounded-md inline-flex" data-testid="link-plan-badge">
      {badge}
    </Link>
  );
}
