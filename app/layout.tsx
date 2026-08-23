import type { Metadata } from "next";
import "./globals.css";
import "./mobile-search-summary.css";

import SiteNotice from "@/app/SiteNotice";

export const metadata: Metadata = {
  title: "経産省関連の事業費額（非公式）",
  description: "GビズINFOと行政事業レビューを主系列に、確認できた公式資料による補足・照合も確認できる非公式サイトです。",
  robots: { index: false, follow: false, nocache: true },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body><SiteNotice />{children}</body>
    </html>
  );
}
