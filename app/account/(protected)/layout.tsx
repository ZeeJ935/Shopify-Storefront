import { requireCustomerSession } from "@/lib/customer-account/require-session";

export const instant = false;

export default async function ProtectedAccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireCustomerSession();
  return <>{children}</>;
}
