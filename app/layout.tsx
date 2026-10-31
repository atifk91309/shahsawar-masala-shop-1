import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SWRegister from "./sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Shahsawar Masala Shop - Kajoor, Kishmish, Pansar, Masala",
    template: "%s | Shahsawar Masala",
  },
  description:
    "Shahsawar Masala Shop Ismaila Swabi - Kajoor, Kishmish, Mong Pali, Pansar, Haldi, Mirch, Masala. Fast billing by grams, stock, profit, Udhar Khata, Wusool. Offline-ready PWA grams system.",
  applicationName: "Shahsawar Masala Shop",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Masala Shop",
  },
  icons: {
    icon: [
      { url: "/logo.png", sizes: "32x32", type: "image/png" },
      { url: "/logo.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-circle-180.png", sizes: "180x180", type: "image/png" },
      { url: "/icon-circle-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-circle-180.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon-circle-180.png"],
  },
  openGraph: {
    title: "Shahsawar Masala Shop - شہسوار مصالحہ شاپ - Ismaila",
    description: "Kajoor • Kishmish • Pansar • Mong Pali • Haldi • Mirch • Grams billing • Offline Ready",
    type: "website",
    images: ["/icon-circle-512.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#b45309",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#fff7ed]">
        <SWRegister />
        {children}
      </body>
    </html>
  );
}