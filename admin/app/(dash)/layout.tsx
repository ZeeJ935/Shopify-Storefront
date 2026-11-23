import Link from "next/link";
import { requireSession } from "@/lib/session-server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await requireSession();
  return (
    <>
      <header className="bar">
        <nav>
          <strong>ZJ Admin</strong>
          <Link href="/">Home</Link>
        </nav>
        <form method="post" action="/logout" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="muted">
            {staff.email} · {staff.role}
          </span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
