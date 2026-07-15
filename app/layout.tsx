import type { Metadata } from "next";
import "./globals.css";
import { Roboto_Slab, Public_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const publicSansHeading = Public_Sans({subsets:['latin'],variable:'--font-heading'});

const robotoSlab = Roboto_Slab({subsets:['latin'],variable:'--font-serif'});

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
    <html lang="en" className={cn("font-serif", robotoSlab.variable, publicSansHeading.variable)}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
