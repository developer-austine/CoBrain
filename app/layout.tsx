import type { Metadata } from "next";
import { Geist, Geist_Mono, Syne, DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Forecasts design system (docs/refactor/design_tft_ui.txt §0).
// Syne for display numbers, DM Sans for UI, DM Mono for every numeric value —
// tabular figures are what stop a ticking number from shifting its neighbours.
const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/**
 * Absolute-URL base for anything that must resolve off-site — icons in a search
 * result, link previews. Derived from APP_URL so it follows the environment
 * rather than hard-coding the production host into every build.
 */
const siteUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // `template` gives every page "<Page> · CoBrain" without each one repeating
  // the brand; `default` is what a search result for the bare domain shows.
  title: {
    default: "CoBrain — your company's brain",
    template: "%s · CoBrain",
  },
  description:
    "CoBrain connects your team's tools — Slack, Gmail, Notion, Drive, GitHub — " +
    "into one searchable brain that answers questions with citations.",
  applicationName: "CoBrain",
  // No `icons` block on purpose. Next emits the link tags from app/icon.svg,
  // app/favicon.ico and app/apple-icon.png by convention, and declaring them
  // here as well produced three competing rel="icon" tags for the same two
  // files. The files are the declaration.
  openGraph: {
    type: "website",
    siteName: "CoBrain",
    title: "CoBrain — your company's brain",
    description:
      "One searchable brain across every tool your team already uses.",
    url: siteUrl,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${syne.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
