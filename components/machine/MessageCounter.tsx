import { formatMessageCount } from "@/lib/messages";
import type { Lang } from "@/lib/sectors";
import type { MachineCopy } from "./machineCopy";

/**
 * The Counter (owner-machine 6.3): "Tienes *3 mensajes nuevos*" in Newsreader, the number
 * big inside the one gold phrase, singular for one. It is the page's heading.
 */
export function MessageCounter({ count, lang, copy }: { count: number; lang: Lang; copy: MachineCopy }) {
  if (count <= 0) {
    return (
      <h1 className="font-newsreader text-3xl font-medium tracking-tight text-ink sm:text-4xl">
        {copy.counter.noneBefore} <span className="text-gold">{copy.counter.noneGold}</span>
      </h1>
    );
  }
  const phrase = formatMessageCount(count, lang);
  const rest = phrase.slice(String(count).length);
  return (
    <h1 className="font-newsreader text-3xl font-medium tracking-tight text-ink sm:text-4xl">
      {copy.counter.youHave}{" "}
      <span className="text-gold">
        <span data-counter="" className="align-[-0.08em] text-6xl leading-none sm:text-7xl">
          {count}
        </span>
        {rest}
      </span>
    </h1>
  );
}
