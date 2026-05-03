import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowLeft, Check, X } from "lucide-react";

interface PlanFeature {
  label: string;
  solo: boolean | string;
  pro: boolean | string;
  msp: boolean | string;
  enterprise: boolean | string;
}

const FEATURES: PlanFeature[] = [
  { label: "Users", solo: "1", pro: "5", msp: "25", enterprise: "Unlimited" },
  { label: "Storage", solo: "1 GB", pro: "25 GB", msp: "100 GB", enterprise: "500 GB+" },
  { label: "Tickets, calendar, time tracking", solo: true, pro: true, msp: true, enterprise: true },
  { label: "Clients, sites, assets", solo: true, pro: true, msp: true, enterprise: true },
  { label: "Evidence locker (dedup, tags)", solo: true, pro: true, msp: true, enterprise: true },
  { label: "Knowledge base", solo: true, pro: true, msp: true, enterprise: true },
  { label: "Recurring ticket templates", solo: true, pro: true, msp: true, enterprise: true },
  { label: "Audit log", solo: true, pro: true, msp: true, enterprise: true },
  { label: "IT Ops Console (AI)", solo: true, pro: true, msp: true, enterprise: true },
  { label: "Secure intake spaces", solo: "1", pro: "5", msp: "25", enterprise: "Unlimited" },
  { label: "Public status pages", solo: false, pro: true, msp: true, enterprise: true },
  { label: "Client portal (read-only)", solo: false, pro: true, msp: true, enterprise: true },
  { label: "REST API + tokens", solo: false, pro: true, msp: true, enterprise: true },
  { label: "Outbound webhooks", solo: "2", pro: "10", msp: "50", enterprise: "Unlimited" },
  { label: "Compliance report packets", solo: "5/mo", pro: "50/mo", msp: "500/mo", enterprise: "Unlimited" },
  { label: "License server (issue keys)", solo: false, pro: true, msp: true, enterprise: true },
  { label: "Invoicing & billing settings", solo: true, pro: true, msp: true, enterprise: true },
  { label: "Priority support", solo: false, pro: false, msp: true, enterprise: true },
  { label: "Dedicated onboarding", solo: false, pro: false, msp: false, enterprise: true },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check className="w-4 h-4 text-primary mx-auto" data-testid="cell-yes" />;
  if (value === false) return <X className="w-4 h-4 text-muted-foreground/40 mx-auto" data-testid="cell-no" />;
  return <span className="text-sm" data-testid="cell-text">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild className="h-8 w-8" data-testid="button-back-home">
              <a href="/">
                <ArrowLeft className="w-4 h-4" />
              </a>
            </Button>
            <span className="font-semibold text-sm tracking-tight">Tech Deck</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm" data-testid="button-pricing-login">
              <a href="/login">Sign in</a>
            </Button>
            <Button asChild size="sm" data-testid="button-pricing-register">
              <a href="/register">Get started</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-3">Pricing</Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4" data-testid="text-pricing-title">
            Simple plans. No surprises.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Start free. Upgrade when your team grows. Cancel anytime — no contracts, no setup fees.
          </p>
        </div>

        {/* Tier cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {[
            { code: "solo", name: "Solo", price: "$0", per: "forever", desc: "Solo techs and side projects", cta: "Start free" },
            { code: "pro", name: "Pro", price: "$29", per: "per month", desc: "Small IT teams getting serious", cta: "Start Pro", featured: true },
            { code: "msp", name: "MSP", price: "$79", per: "per month", desc: "Multi-client managed service providers", cta: "Start MSP" },
            { code: "enterprise", name: "Enterprise", price: "$299", per: "per month", desc: "Large fleets, custom needs", cta: "Contact us" },
          ].map(plan => (
            <Card
              key={plan.code}
              className={plan.featured ? "border-primary shadow-md" : ""}
              data-testid={`card-pricing-${plan.code}`}
            >
              <CardContent className="p-6">
                {plan.featured && <Badge className="mb-3 text-xs">Most popular</Badge>}
                <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mb-4 min-h-[2.5rem]">{plan.desc}</p>
                <div className="mb-4">
                  <span className="text-3xl font-bold tracking-tight">{plan.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">/ {plan.per}</span>
                </div>
                <Button
                  asChild
                  className="w-full"
                  variant={plan.featured ? "default" : "outline"}
                  data-testid={`button-pricing-cta-${plan.code}`}
                >
                  <a href="/register">{plan.cta}</a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Feature matrix */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold tracking-tight mb-6">Compare features</h2>
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Feature</th>
                    <th className="text-center p-3 font-medium w-24">Solo</th>
                    <th className="text-center p-3 font-medium w-24">Pro</th>
                    <th className="text-center p-3 font-medium w-24">MSP</th>
                    <th className="text-center p-3 font-medium w-24">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map((row, i) => (
                    <tr key={row.label} className={i % 2 ? "bg-muted/20" : ""} data-testid={`row-feature-${i}`}>
                      <td className="p-3">{row.label}</td>
                      <td className="text-center p-3"><Cell value={row.solo} /></td>
                      <td className="text-center p-3"><Cell value={row.pro} /></td>
                      <td className="text-center p-3"><Cell value={row.msp} /></td>
                      <td className="text-center p-3"><Cell value={row.enterprise} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto mb-16">
          <h2 className="text-2xl font-bold tracking-tight mb-6 text-center">Pricing questions</h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="trial">
              <AccordionTrigger data-testid="faq-trigger-trial">Is there a free trial?</AccordionTrigger>
              <AccordionContent>
                The Solo plan is free forever. Paid plans (Pro, MSP) include a 14-day money-back guarantee on your first paid month — see our <a href="/refund" className="text-primary underline">Refund Policy</a>.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="cancel">
              <AccordionTrigger data-testid="faq-trigger-cancel">Can I cancel anytime?</AccordionTrigger>
              <AccordionContent>
                Yes. Cancel from your billing settings. You keep access until the end of the current billing period and your data is preserved during a 90-day grace period.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="upgrade">
              <AccordionTrigger data-testid="faq-trigger-upgrade">What happens when I upgrade or downgrade?</AccordionTrigger>
              <AccordionContent>
                Upgrades take effect immediately and are prorated. Downgrades take effect at the next billing cycle, so you don't lose paid time you've already used.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="overage">
              <AccordionTrigger data-testid="faq-trigger-overage">What if I hit a plan limit?</AccordionTrigger>
              <AccordionContent>
                You'll see a clear message explaining which limit was reached and a one-click upgrade path. Existing data is never deleted because of a plan limit.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="payment">
              <AccordionTrigger data-testid="faq-trigger-payment">How is billing handled?</AccordionTrigger>
              <AccordionContent>
                All payments are processed by Stripe. We never see or store your card details. Receipts and invoices are emailed automatically.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="enterprise">
              <AccordionTrigger data-testid="faq-trigger-enterprise">Need something bigger than Enterprise?</AccordionTrigger>
              <AccordionContent>
                Contact us through the support channel. We do custom volume pricing, on-prem deployments, and dedicated infrastructure for the largest MSPs.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* CTA */}
        <div className="text-center border rounded-2xl p-12 bg-card/30">
          <h2 className="text-2xl font-bold tracking-tight mb-3">Ready to consolidate your stack?</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Start free. No credit card required. Upgrade only when your team grows past Solo.
          </p>
          <Button asChild size="lg" data-testid="button-pricing-cta-final">
            <a href="/register">Create your workspace</a>
          </Button>
        </div>
      </main>

      <footer className="border-t py-6 px-6">
        <div className="max-w-6xl mx-auto text-xs text-muted-foreground flex items-center justify-between">
          <span>&copy; {new Date().getFullYear()} Tech Deck.</span>
          <span>Built by <a href="https://shotgunninjas.com" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">Shotgun Ninjas Productions</a>.</span>
        </div>
      </footer>
    </div>
  );
}
