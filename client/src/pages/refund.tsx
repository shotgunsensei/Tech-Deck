import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild className="h-8 w-8" data-testid="button-back-home">
              <a href="/">
                <ArrowLeft className="w-4 h-4" />
              </a>
            </Button>
            <span className="font-semibold text-sm tracking-tight">Tech Deck</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight mb-2" data-testid="text-refund-title">Refund Policy</h1>
        <p className="text-sm text-muted-foreground mb-8" data-testid="text-refund-updated">Last updated: May 3, 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-2">Overview</h2>
            <p>
              We want you to be satisfied with Tech Deck. This policy explains when refunds are
              available, how to request one, and what to expect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">14-Day Money-Back Guarantee (New Subscribers)</h2>
            <p>
              If you subscribe to a paid plan for the first time and are not satisfied, you may
              request a full refund within <strong>14 days</strong> of your initial paid charge.
              This applies to your first paid month or first annual period only.
            </p>
            <p>
              The Solo plan is free and is not subject to refund.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Monthly Subscriptions</h2>
            <p>
              After the 14-day window, monthly subscription fees are non-refundable. You can cancel
              at any time to stop future charges. You will retain access through the end of the
              current billing period.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Annual Subscriptions</h2>
            <p>
              If you cancel an annual subscription after the 14-day refund window, we may issue a
              prorated refund for unused months at our discretion. Prorated refunds are calculated
              from the cancellation date and exclude any discount you received for paying annually.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Plan Downgrades and Upgrades</h2>
            <p>
              Upgrading mid-cycle is prorated and billed immediately. Downgrading takes effect at
              the next billing cycle; no refund is issued for the unused portion of the higher tier.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Service Outages</h2>
            <p>
              In the event of a sustained Service outage that materially prevents you from using
              Tech Deck for more than 24 consecutive hours, we may issue a service credit at our
              discretion. Service credits are applied to future billing and are not refundable as
              cash.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Non-Refundable Charges</h2>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Charges older than 14 days for first-time subscribers</li>
              <li>Monthly subscriptions billed beyond the first month</li>
              <li>Add-ons or one-time fees, unless otherwise specified</li>
              <li>Charges incurred while account is in violation of the Terms of Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">How to Request a Refund</h2>
            <p>
              To request a refund, contact our support team through the Service with the following
              information:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Account email address</li>
              <li>Date of charge</li>
              <li>Stripe receipt or charge ID (optional but speeds processing)</li>
              <li>Reason for the refund request</li>
            </ul>
            <p>
              We respond to refund requests within <strong>5 business days</strong>. Approved
              refunds are issued to the original payment method and typically appear within 5-10
              business days depending on your bank.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Chargebacks</h2>
            <p>
              We ask that you contact us before initiating a chargeback. Chargebacks initiated
              without first attempting resolution may result in immediate account suspension.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Changes to This Policy</h2>
            <p>
              We may update this Refund Policy from time to time. The version in effect at the
              time of your most recent charge applies to that charge.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Contact</h2>
            <p>
              For refund-related questions, contact our support team through the Service.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t py-6 px-6">
        <div className="max-w-3xl mx-auto text-xs text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} Tech Deck. Built by Shotgun Ninjas Productions.</span>
        </div>
      </footer>
    </div>
  );
}
