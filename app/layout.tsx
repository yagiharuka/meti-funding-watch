import type { Metadata } from "next";
import "./globals.css";

import SiteNotice from "@/app/SiteNotice";

export const metadata: Metadata = {
  title: "経産省関係の調達（委託を含む）・補助金情報",
  description: "GビズINFOと行政事業レビューを主系列として検索し、機関公表資料との照合結果を別に確認できる非公式サイトです。",
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
