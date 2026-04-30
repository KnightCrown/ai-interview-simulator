import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/session-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";

export const metadata: Metadata = {
  title: "AI Interview Simulator",
  description: "Practice role-specific AI interviews with live feedback on content, speaking, and engagement."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5
};

// Runs before React hydration so the dark class is applied immediately and we
// avoid a light-mode flash for users who previously chose dark.
const themeInitScript = `
(function() {
  try {
    var stored = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    if (stored === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
