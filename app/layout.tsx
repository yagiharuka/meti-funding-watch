import type { Metadata } from "next";
import "./globals.css";

import SiteNotice from "@/app/SiteNotice";

export const metadata: Metadata = {
  title: "経産省関係の調達（委託を含む）・補助金情報",
  description: "経産省関係の公表資料について、公式入口・取得状態・検索収録範囲を確認し、3系列の検証済み掲載行を分けて検索する非公式サイトです。",
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
