"use client";

import { HeartHandshake } from "lucide-react";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { Card, CardContent } from "@/components/ui/card";
import { FAMILY_COPY } from "@/lib/family/copy";

/**
 * Billing on the account page, for a kid profile: the grown-up looks after the plan, so there is no
 * price, no card, no checkout and no portal here. Kids never see billing (docs/KIDS-COME-BACK.md).
 */
export function KidBillingCard() {
  return (
    <Card id="billing" className="scroll-mt-6" data-plan="kid">
      <SectionHeader title={FAMILY_COPY.kidBillingTitle} />
      <CardContent className={SECTION_BODY}>
        <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <HeartHandshake className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium" data-testid="kid-billing">
              {FAMILY_COPY.kidBilling}
            </p>
            <p className="text-sm text-muted-foreground">{FAMILY_COPY.kidBillingHint}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
