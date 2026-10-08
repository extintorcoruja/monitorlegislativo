import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monitor Legislativo",
  description: "Acompanhe proposições, tramitações e mudanças legislativas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
