import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Advent Challenge",
  description: "Five-day LLM API practice workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
