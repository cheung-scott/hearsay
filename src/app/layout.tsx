import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hearsay",
  description: "A voice-bluffing card game where the AI's voice betrays its lies — and yours might too.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* `suppressHydrationWarning` on <body> — browser extensions (Grammarly,
          LastPass, ColorZilla, dark-mode scripts, etc.) inject attributes
          like `data-gr-ext-installed` on <body> AFTER React hydrates,
          which triggers a spurious hydration-mismatch warning. This flag
          tells React "I know this element may differ from SSR; don't warn."
          Only suppresses warnings for the single element, not its children. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
