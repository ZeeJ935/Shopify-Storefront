import type { Metadata } from "next";

// Login and account pages are private; keep them out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-[50vh]">{children}</div>;
}
