import { Shell } from "@/components/marketing/site";
export default function PrivacyPage() {
  return (
    <Shell>
      <article className="mx-auto max-w-2xl px-5 py-16 leading-relaxed [&_h1]:mb-4 [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:ml-5 [&_ul]:list-disc [&_a]:underline">
        {/* draft, needs legal review */}
        <h1>Privacy Policy</h1>
        <p>
          PostPipe, operated by its owner, provides an API for publishing posts
          to social platforms. This policy explains what data we store and why.
        </p>

        <h2>What we store</h2>
        <p>
          We store your account email. When you connect a social account, we
          store its access tokens, encrypted at rest. We store the post content
          and media you send us until the post is published, and for 30 days
          after that.
        </p>

        <h2>Third parties</h2>
        <p>
          We use Supabase for our database and sign-in, AWS for hosting and
          storage, Polar for billing, and Sentry for error reports. These
          providers process data on our behalf.
        </p>

        <h2>Social platforms</h2>
        <p>
          When you publish through PostPipe, the platform you chose (for example
          Facebook, Instagram or Threads) receives your content. Its own terms
          and privacy policy apply to that data.
        </p>

        <h2>Data deletion</h2>
        <p>
          You can remove PostPipe in your Facebook, Instagram or Threads
          settings. Meta then tells us to delete the data linked to that
          account. You can check a request on our{" "}
          <a href="/data-deletion">data deletion page</a>. You can also email us
          to ask for deletion.
        </p>

        <h2>Retention</h2>
        <p>
          We keep account data while your account is active. We delete post
          content and media 30 days after publishing. When you disconnect an
          account or ask for deletion, we delete its tokens.
        </p>

        <h2>Contact</h2>
        <p>Email support@postpipe.com with any privacy question.</p>
      </article>
    </Shell>
  );
}
