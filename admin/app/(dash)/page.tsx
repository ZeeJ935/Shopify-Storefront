import Link from "next/link";
import { navFor } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";

type Me = { staff: { id: number; email: string; role: "viewer" | "operator" | "admin"; sessionExpiresAt: number } };

export default async function Home({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const { forbidden } = await searchParams;
  const { staff } = await staffFetch<Me>("/admin/me");
  return (
    <>
      {forbidden ? <p className="error">Your role can&apos;t open that page.</p> : null}
      <h1>Signed in</h1>
      <div className="card">
        <p>
          <strong>{staff.email}</strong> — role <code>{staff.role}</code>
        </p>
        <p className="muted">Session ends {new Date(staff.sessionExpiresAt * 1000).toLocaleString()} (8 hours after sign-in).</p>
        <p className="muted">
          Customer names, emails and addresses are not shown here (we don&apos;t store them). Look an order up in Shopify admin by its
          order number when you need them.
        </p>
        <p style={{ display: "flex", gap: 12 }}>
          {navFor(staff.role).map((item) => (
            <Link key={item.href} className="button" href={item.href}>
              {item.label}
            </Link>
          ))}
        </p>
      </div>
    </>
  );
}
