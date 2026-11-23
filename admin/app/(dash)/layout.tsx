import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { navFor } from "@/lib/fulfill";
import { requireSession } from "@/lib/session-server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await requireSession();
  return (
    <>
      <TopBar staff={staff} />
      <Sidebar items={navFor(staff.role)} />
      <main className="min-h-screen pt-14 lg:pl-60">{children}</main>
    </>
  );
}
