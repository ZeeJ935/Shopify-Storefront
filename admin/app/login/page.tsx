import { redirect } from "next/navigation";
import { Banner } from "@/components/ui/Banner";
import { getSession } from "@/lib/session-server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; expired?: string }> }) {
  if (await getSession()) redirect("/");
  const { error, expired } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-card">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-[#1a1a1a] text-sm font-black text-white">ZJ</span>
          <div>
            <h1 className="text-base font-bold">ZJ Admin</h1>
            <p className="text-subdued">Staff sign-in</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {/* One message for every failure: it doesn't reveal whether an email is allowed. */}
          {error ? <Banner tone="critical" title="Sign-in failed">If you should have access, ask an admin.</Banner> : null}
          {expired && !error ? <Banner tone="info" title="Your session ended">Please sign in again.</Banner> : null}
          <a
            href="/auth/google"
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-surface font-semibold text-fg no-underline shadow-button hover:bg-surface-hover"
          >
            <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5Z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44Z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5Z" />
            </svg>
            Sign in with Google
          </a>
          <p className="text-center text-xs text-subdued">Staff only. Access is limited to approved accounts.</p>
        </div>
      </div>
    </main>
  );
}
