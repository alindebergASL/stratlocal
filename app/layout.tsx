import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/kit/Toaster";
import { Hotkeys } from "@/components/kit/Hotkeys";

// System fonts keep builds and runtime independent of font services.

// The team's own name for the app, when it has set one. A build with no
// database yet falls back to the default rather than failing.
export async function generateMetadata(): Promise<Metadata> {
  let title = "Strategy";
  try {
    const { branding } = await import("@/lib/team/branding");
    title = branding().appName;
  } catch {
    // keep the default
  }
  return { title, description: "Key account workspace", robots: { index: false, follow: false } };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" >
      <body className="min-h-screen antialiased">
        <ToastProvider>
          {children}
          <Hotkeys />
        </ToastProvider>
      </body>
    </html>
  );
}
