import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./focused-changes.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "JSOS · Japanese Speaking OS",
  description: "以真实对话为中心的日语训练操作系统",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "JSOS · Japanese Speaking OS",
    description: "每天开口，直到日语成为本能。",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "JSOS Japanese Speaking OS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "JSOS · Japanese Speaking OS",
    description: "每天开口，直到日语成为本能。",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f2ea" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
