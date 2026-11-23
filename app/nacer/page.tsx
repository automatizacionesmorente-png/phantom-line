import type { Metadata } from "next";
import { RebirthWizard } from "@/components/rebirth/RebirthWizard";
import { REBIRTH_COPY } from "@/lib/rebirth/copy";

export const metadata: Metadata = {
  title: REBIRTH_COPY.es.pageTitle,
  description: REBIRTH_COPY.es.pageDescription,
};

/** /nacer (and /reborn, which redirects here): the commercial onboarding wizard. Static shell; the client picks the language. */
export default function Page() {
  return <RebirthWizard />;
}
