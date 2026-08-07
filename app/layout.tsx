import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "숏폼스토리 by Assetplaza",
  description: "아이디어를 콘텐츠로, 콘텐츠를 브랜드 가치로 연결하는 AI 프론티어",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
