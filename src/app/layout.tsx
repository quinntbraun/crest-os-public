import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { requireDocumentNonce } from "../security/document-policy.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crest OS",
  description: "Crest Detailing internal workspace",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  requireDocumentNonce(await headers());
  return <html lang="en"><body>{children}</body></html>;
}
