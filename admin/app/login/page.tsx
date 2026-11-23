import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; expired?: string }> }) {
  if (await getSession()) redirect("/");
  const { error, expired } = await searchParams;
  return (
    <main>
      <div className="card" style={{ maxWidth: 420, margin: "10vh auto" }}>
        <h1>ZJ Admin</h1>
        <p className="muted">Staff only. Sign in with your Google account.</p>
        {/* One message for every failure: it doesn't say whether an email is allowed. */}
        {error ? <p className="error">Sign-in failed. If you should have access, ask an admin.</p> : null}
        {expired && !error ? <p className="muted">Your session ended. Please sign in again.</p> : null}
        <a className="button primary" href="/auth/google">
          Sign in with Google
        </a>
      </div>
    </main>
  );
}
