import type { Metadata } from "next";
import { PlanGrid } from "@/components/marketing/plan-grid";
import { Shell } from "@/components/marketing/site";

const title = "PostPipe pricing";
const description =
  "Free, Builder at $12 a month, Scale at $59 a month. Pay per post only above your plan limit.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
};

export default function PricingPage() {
  return (
    <Shell>
      <section className="mx-auto max-w-5xl px-5 py-16">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Pricing
        </h1>
        <p className="mt-4 mb-10 max-w-2xl text-lg text-muted-foreground">
          Paid plans bill overage per post above the monthly limit.
        </p>
        <PlanGrid Heading="h2" />
        <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
          Platforms switch on as each platform's app review is approved. The
          dashboard shows each platform's approval status.
        </p>
      </section>
    </Shell>
  );
}
