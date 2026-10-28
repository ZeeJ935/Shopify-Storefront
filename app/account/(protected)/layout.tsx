import AccountShell from "@/app/account/components/account-shell";
import { getCustomerProfile } from "@/lib/customer-account/api";
import { requireCustomerSession } from "@/lib/customer-account/require-session";


export default async function ProtectedAccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireCustomerSession();

  let firstName: string | null = null;
  let displayName = "Account";
  let email: string | null = null;

  try {
    const profile = await getCustomerProfile();
    firstName = profile.firstName;
    displayName = profile.displayName || "Account";
    email = profile.email;
  } catch {
    // Shell still renders; pages show their own errors.
  }

  return (
    <AccountShell
      firstName={firstName}
      displayName={displayName}
      email={email}
    >
      {children}
    </AccountShell>
  );
}
