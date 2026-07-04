import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEA Directory — AI business search for Southeast Asia",
  description: "Find businesses across Southeast Asia by simply asking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
