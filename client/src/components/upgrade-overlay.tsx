import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";

interface UpgradeOverlayProps {
  feature: string;
  requiredPlan?: "Pro" | "MSP" | "Enterprise";
  description?: string;
}

/**
 * Shown in place of a feature when the current plan doesn't include it.
 * Replaces silent feature hiding with a clear upgrade path.
 */
export function UpgradeOverlay({ feature, requiredPlan = "Pro", description }: UpgradeOverlayProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6" data-testid="upgrade-overlay">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight" data-testid="upgrade-overlay-title">
              {feature}
            </h2>
            <p className="text-sm text-muted-foreground mt-2" data-testid="upgrade-overlay-description">
              {description ?? `${feature} is available on the ${requiredPlan} plan and above.`}
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button asChild data-testid="button-upgrade">
              <Link href="/billing">
                <Sparkles className="w-4 h-4 mr-2" />
                Upgrade to {requiredPlan}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" data-testid="button-view-pricing">
              <Link href="/pricing">Compare plans</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
