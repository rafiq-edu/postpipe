import Link from "next/link";
import { PLAN_IDS, planCard } from "@/lib/marketing/plan-card";

export function PlanGrid({ Heading = "h3" }: { Heading?: "h2" | "h3" }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {PLAN_IDS.map((id) => {
        const c = planCard(id);
        return (
          <li
            key={id}
            data-testid={`plan-${id}`}
            className="flex flex-col rounded-lg border bg-panel p-6"
          >
            <Heading className="text-lg font-semibold">{c.name}</Heading>
            <p className="mt-3">
              <span className="text-4xl font-semibold tracking-tight">
                {c.price}
              </span>
              <span className="text-muted-foreground"> / month</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              <li>{c.posts}</li>
              <li>{c.accounts}</li>
              <li>{c.rate}</li>
              {c.overage && <li>{c.overage}</li>}
              {id === "free" ? (
                <li>X is not included</li>
              ) : (
                <li>X posts billed at X's API cost plus 30%</li>
              )}
            </ul>
            <Link
              href="/login"
              className="mt-6 rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {id === "free" ? "Start free" : `Choose ${c.name}`}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
