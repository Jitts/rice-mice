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
    // suppressHydrationWarning: the inline script below may add the `dark`
    // class before React hydrates, which is intentional.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", outfit.variable, oxaniumHeading.variable)}
    >
      <body className="antialiased">
        {/* Apply the saved theme before first paint so dark users get no
            white flash. Runs inline, ahead of the rest of the body. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("rm-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}',
          }}
        />
        {children}
      </body>
    </html>
  );
}
