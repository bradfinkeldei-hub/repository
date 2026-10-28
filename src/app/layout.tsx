import type { Metadata } from "next";
import "./globals.css";
import { ViewAsBanner } from "@/components/view-as";

export const metadata: Metadata = {
  title: "The Coaching Circle",
  description: "Group life coaching: life wheels, accountability and missions for each team.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Figtree:wght@400..800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}<ViewAsBanner /></body>
    </html>
  );
}
