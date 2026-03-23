import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Telerithm — AI-powered log analytics",
    template: "%s · Telerithm",
  },
  description:
    "Operational clarity for noisy systems. Search logs with natural language, track issues, and get alerted before users notice.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="light")return;if(t==="dark"||!t){document.documentElement.classList.add("dark")}}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
