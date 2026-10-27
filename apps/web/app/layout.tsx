import type { Metadata } from "next";
import { Libre_Baskerville, Inter, IBM_Plex_Mono, Newsreader } from "next/font/google";
import { AppProviders } from "./app-providers";
import { THEME_BOOT_SCRIPT } from "./theme";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const serif = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap"
});

// The writing face. Optical sizes keep body text sturdy and headings fine.
const prose = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-prose",
  display: "swap"
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap"
});

const siteUrl = "https://passage.md";
const title = "passage.md";
const description = "A quiet place to write. A Markdown editor with nothing in the way, and search that finds every word.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  icons: {
    icon: "/icon.svg"
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: title,
    title,
    description,
    images: [{ url: "/og.jpg", width: 1920, height: 1080, alt: title }]
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.jpg"]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable} ${prose.variable}`}>
      <head>
        {/* Applies the saved theme before the first paint, so a dark-theme
            reader never sees a light flash while React hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
