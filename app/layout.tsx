import type { Metadata } from "next";
import { Archivo, Figtree } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import SiteShell from "./components/site-shell";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  display: "swap",
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "ZJ Store",
    template: "%s · ZJ Store",
  },
  description: "Performance gear from Nike and Adidas at ZJ Store.",
  openGraph: {
    title: "ZJ Store",
    description: "Performance gear from Nike and Adidas at ZJ Store.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-snow text-ink">
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
