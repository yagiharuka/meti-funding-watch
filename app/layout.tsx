import type { Metadata } from "next";
import "./globals.css";

import SiteNotice from "@/app/SiteNotice";

export const metadata: Metadata = {
  title: "経産省関係の調達（委託を含む）・補助金情報",
  description: "GビズINFO掲載行と、経済産業省本省・外局・地方経済産業局等13機関の公開済み契約結果・補助金等交付決定の一部を、系列を分けて検索する非公式サイトです。全年度・全公表区分・実支払を網羅しません。",
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
