import { Info } from "lucide-react";
import { demoNotice } from "@/lib/owner/demo";
import type { Lang } from "@/lib/sectors";

/**
 * The Demo_Notice (owner-machine 3.2, 3.3): one plain line on a card strip, never a dialog,
 * so it never blocks a control. Shown only for the Demo_Shop, by the page that knows it.
 */
export function DemoNotice({ lang }: { lang: Lang }) {
  return (
    <p
      lang={lang}
      data-demo-notice=""
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-4 py-2 font-inter text-sm text-text"
    >
      <Info aria-hidden="true" size={16} className="shrink-0 text-gold-text" />
      <span>{demoNotice(lang)}</span>
    </p>
  );
}
