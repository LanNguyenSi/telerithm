import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Telerithm",
  description: "AI-powered log analytics MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="font-sans">{children}</body>
    </html>
  );
}
