import type { Metadata } from "next";
import { StartupPage } from "@/components/startup/StartupPage";

export const metadata: Metadata = {
  title: "Phantom Line for salons",
  description: "An AI receptionist for hair salons: answers calls, books with real rules, leaves a message on the owner's answering machine.",
};

/** The startup page (BACKLOG 12): static shell, the client component picks the language. */
export default function Page() {
  return <StartupPage />;
}
