"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { useFamily } from "@/components/family/useFamily";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FAMILY_PATH } from "@/lib/family/client";
import { isKidEmail } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";

/**
 * Family on the account page: one line about kid profiles (or how many kids share the plan) and a
 * link to /family, where the grown-up sets the PIN and adds, edits and removes kids. Nothing for a
 * kid profile: managing the family is the grown-up's.
 */
export function FamilySection({ email }: { email: string }) {
  const { user } = useAuth();
  const kid = isKidEmail(email);
  const { state } = useFamily(kid ? null : user?.id);
  if (kid) return null;
  const kids = state?.members.filter((m) => !m.isParent).length ?? 0;

  return (
    <Card data-testid="family-section">
      <SectionHeader title={FAMILY_COPY.accountCardTitle} description={kids > 0 ? FAMILY_COPY.accountCardBodyKids(kids) : FAMILY_COPY.accountCardBody} />
      <CardContent className={SECTION_BODY}>
        <Button asChild size="sm" variant="outline" className="pointer-coarse:h-11">
          <Link href={FAMILY_PATH}>
            <Users className="size-4" aria-hidden />
            {FAMILY_COPY.accountCardLink}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
