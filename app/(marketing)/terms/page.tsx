import { Shell } from "@/components/marketing/site";
export default function TermsPage() {
  return (
    <Shell>
      <article className="mx-auto max-w-2xl px-5 py-16 leading-relaxed [&_h1]:mb-4 [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:ml-5 [&_ul]:list-disc [&_a]:underline">
        {/* draft, needs legal review */}
        <h1>Terms of Service</h1>
        <p>
          These terms cover your use of PostPipe, operated by its owner. By
          using the service you agree to them.
        </p>

        <h2>The service</h2>
        <p>
          PostPipe lets you publish posts to social platforms through an API and
          a dashboard. You need an account and an API key to use it.
        </p>

        <h2>Your account</h2>
        <p>
          Keep your API keys secret. You are responsible for all actions taken
          with your keys and for the content you publish.
        </p>

        <h2>Social platforms</h2>
        <p>
          You must follow the terms of each platform you connect, including Meta
          for Facebook, Instagram and Threads. A platform can limit or remove
          access at any time, and we are not responsible for that.
        </p>

        <h2>Your data</h2>
        <p>
          We store your data as described in our{" "}
          <a href="/privacy">privacy policy</a>. To delete it, see the{" "}
          <a href="/data-deletion">data deletion page</a>.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Do not use PostPipe to send spam, break the law, or break a platform's
          rules. We may suspend accounts that do.
        </p>

        <h2>Liability</h2>
        <p>
          The service is provided as is, without warranty. To the extent the law
          allows, we are not liable for indirect or lost-profit damages.
        </p>

        <h2>Contact</h2>
        <p>Email support@postpipe.com with any question about these terms.</p>
      </article>
    </Shell>
  );
}
