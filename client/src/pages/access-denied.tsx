import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldOff, ExternalLink } from "lucide-react";

/**
 * Public landing page shown when OperatorOS reports that the signed-in
 * user does not have access to the Tech Deck module. Rendered for the
 * 401 `module_access_denied` SSO reject code (browser clients).
 */
export default function AccessDeniedPage() {
  const operatorosUrl =
    (import.meta.env.VITE_OPERATOROS_URL as string | undefined)
    || (import.meta.env.VITE_OPERATOROS_BASE_URL as string | undefined)
    || "https://operatoros.net";

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 bg-background"
      data-testid="page-access-denied"
    >
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 text-destructive">
            <ShieldOff className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-access-denied-title">
              Access to Tech Deck is managed by OperatorOS
            </h1>
            <p className="text-sm text-muted-foreground mt-2" data-testid="text-access-denied-body">
              Your OperatorOS account doesn&apos;t currently have access to the Tech Deck module.
              Open OperatorOS to enable it, change your plan, or contact your organization
              administrator.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button asChild data-testid="button-open-operatoros">
              <a href={operatorosUrl} rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open OperatorOS
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
