import type { Metadata } from "next";
import "./globals.css";
import { Outfit, Oxanium } from "next/font/google";
import { cn } from "@/lib/utils";

const oxaniumHeading = Oxanium({subsets:['latin'],variable:'--font-heading'});

const outfit = Outfit({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "rice-mice",
  description: "Customer sign-up & re-engagement CRM for rice-mice",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", outfit.variable, oxaniumHeading.variable)}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
