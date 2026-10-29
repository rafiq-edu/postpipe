import type { Metadata } from "next";
import Link from "next/link";
import { PlanGrid } from "@/components/marketing/plan-grid";
import { PostsPreview } from "@/components/marketing/posts-preview";
import { Shell } from "@/components/marketing/site";

const title = "PostPipe: one API to publish to nine social platforms";
const description =
  "Publish text, images and video to your users' social accounts with one REST API. Hosted connect page, scheduling with retries, signed webhooks.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
};

const PLATFORMS = [
  "Bluesky",
  "X",
  "LinkedIn",
  "Threads",
  "Instagram",
  "Facebook Pages",
  "Pinterest",
  "YouTube",
  "TikTok",
];

const FEATURES = [
  {
    h: "Hosted connect page",
    p: "Your users link their accounts on a page we host. You write no OAuth code.",
  },
  {
    h: "Exact-time scheduling",
    p: "Set the minute a post goes out. Failed attempts retry on their own.",
  },
  {
    h: "Signed webhooks",
    p: "Every result reaches your server as a signed event, so you can check it came from us.",
  },
  {
    h: "Errors by platform",
    p: "The dashboard lists errors for each platform, next to its approval status.",
  },
  {
    h: "SDK and docs from one file",
    p: "The TypeScript SDK and the API docs are built from the same OpenAPI file, so they match.",
  },
];

const REQUEST = `curl https://<your-postpipe-host>/api/v1/social-posts \\
  -H "Authorization: Bearer pp_live_..." \\
  -d '{
    "caption": "We shipped dark mode.",
    "social_accounts": ["<account id>", "<account id>"],
    "scheduled_at": "2026-11-03T09:00:00Z"
  }'`;

export default function Home() {
  return (
    <Shell>
      <section className="mx-auto max-w-5xl px-5 pt-16 pb-14 md:pt-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
          Add social posting to your product with one API call
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          PostPipe publishes text, images and video to your users' accounts on
          nine platforms. It is built for developers and SaaS teams.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:opacity-90"
          >
            Start free
          </Link>
          <Link
            href="/docs"
            className="rounded-md border bg-panel px-5 py-2.5 font-medium hover:bg-accent"
          >
            Read the docs
          </Link>
        </div>
        <div className="mt-12">
          <PostsPreview />
        </div>
        <pre className="mt-6 whitespace-pre-wrap break-words rounded-lg border bg-panel p-5 font-mono text-sm leading-relaxed">
          <code>{REQUEST}</code>
        </pre>
      </section>

      <section className="border-t bg-panel">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">
            What you get
          </h2>
          <dl className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.h}>
                <dt className="font-semibold">{f.h}</dt>
                <dd className="mt-1 text-muted-foreground">{f.p}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-14">
        <h2 className="text-2xl font-semibold tracking-tight">
          Nine platforms
        </h2>
        <ul className="mt-6 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <li
              key={p}
              className="rounded-md border bg-panel px-3 py-1.5 text-sm"
            >
              {p}
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          Each platform switches on once its app review is approved. The
          dashboard shows the approval status of each one.
        </p>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">Pricing</h2>
          <p className="mt-2 mb-8 text-muted-foreground">
            Start free. Pay when you need more posts.
          </p>
          <PlanGrid />
          <p className="mt-6 text-sm">
            <Link href="/pricing" className="underline underline-offset-4">
              See full pricing
            </Link>
          </p>
        </div>
      </section>
    </Shell>
  );
}
