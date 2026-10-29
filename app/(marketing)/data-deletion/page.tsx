import { Shell } from "@/components/marketing/site";
import { createServiceClient } from "@/lib/db/client";
import { getDeletionRequest } from "@/lib/meta/deletion";

export const dynamic = "force-dynamic";

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const request = code
    ? await getDeletionRequest(await createServiceClient(), code)
    : null;
  return (
    <Shell>
      <article className="mx-auto max-w-2xl px-5 py-16 leading-relaxed [&_h1]:mb-4 [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:ml-5 [&_ul]:list-disc [&_a]:underline">
        <h1>Data deletion</h1>
        {!code && (
          <>
            <p>
              To delete your data, remove PostPipe from your app settings in
              Facebook, Instagram or Threads. We then delete the connected
              accounts and tokens we stored for you.
            </p>
            <p>
              You can also email support@postpipe.com and ask us to delete your
              data.
            </p>
          </>
        )}
        {code && request && (
          <p>
            Deletion request {code} is {request.status}. Received{" "}
            {new Date(request.created_at).toUTCString()}.
          </p>
        )}
        {code && !request && <p>Unknown confirmation code.</p>}
      </article>
    </Shell>
  );
}
