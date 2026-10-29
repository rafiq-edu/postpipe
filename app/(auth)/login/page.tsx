import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendMagicLink, signInWithGoogle } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const google = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "true";
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm space-y-5 rounded-lg border bg-panel p-6">
        <Logo className="text-xl" />
        <h1 className="text-2xl font-semibold">Sign in</h1>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-danger-soft p-3 text-sm text-destructive"
          >
            Sign-in link is invalid or expired
          </p>
        )}
        {google && (
          <form action={signInWithGoogle}>
            <Button type="submit" variant="outline" className="w-full">
              Continue with Google
            </Button>
          </form>
        )}
        {sent ? (
          <p role="status" className="rounded-md bg-muted p-3 text-sm">
            Check your email
          </p>
        ) : (
          <form action={sendMagicLink} className="space-y-3">
            <Input
              name="email"
              type="email"
              aria-label="Email"
              placeholder="you@company.com"
              required
            />
            <Button type="submit" className="w-full">
              Send magic link
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
