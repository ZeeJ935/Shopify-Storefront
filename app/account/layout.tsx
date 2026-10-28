export default function AccountRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-[50vh]">{children}</div>;
}
