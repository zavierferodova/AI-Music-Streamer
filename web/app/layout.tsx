import type { Metadata, Viewport } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/hooks/useToast";
import { ToastNotification } from "@/components/ToastNotification";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Music Streamer — Realtime Control Panel",
  description: "Continuous 24/7 Live Broadcast & Synchronized Audio Control Panel",
};

export const viewport: Viewport = {
  themeColor: "#070b12",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} antialiased bg-[#070b12] text-slate-100 min-h-screen relative selection:bg-sky-500 selection:text-white`}
      >
        {/* Background glow meshes */}
        <div className="fixed top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-sky-500/10 blur-[120px] pointer-events-none -z-10" />
        <div className="fixed bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none -z-10" />
        <div className="fixed top-[40%] right-[20%] w-[400px] h-[400px] rounded-full bg-purple-500/5 blur-[100px] pointer-events-none -z-10" />

        <ToastProvider>
          {children}
          <ToastNotification />
        </ToastProvider>
      </body>
    </html>
  );
}
