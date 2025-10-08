import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/query-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Latchflow Portal",
  description: "Secure file recipient portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
