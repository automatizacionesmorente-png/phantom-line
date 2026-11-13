import { normalizeText } from "./fields";

/**
 * Words that are not a name on their own: endearments, greetings, answers,
 * filler words and a few insults, in Spanish and English, lower case and
 * without accents (as `normalizeText` writes them). A name is refused only
 * when EVERY word of it is on this list, so "Ana cariño" is still Ana.
 * A real name that happens to be on the list ("Reina") is asked for once
 * more and then accepted, which costs the caller one friendly question.
 */
const NOT_NAME_WORDS: ReadonlySet<string> = new Set([
  // endearments
  "mi", "amor", "amorcito", "carino", "cielo", "vida", "corazon", "tesoro", "guapa", "guapo", "guapi", "bonita",
  "bonito", "reina", "rey", "princesa", "principe", "nena", "nene", "churri", "cari", "bebe", "rico", "rica",
  "my", "love", "honey", "babe", "baby", "darling", "dear", "sweetheart", "sweetie", "sugar", "hun", "buddy",
  "pal", "dude", "mate", "boss",
  // greetings, answers and filler
  "hola", "buenas", "buenos", "dias", "tardes", "noches", "vale", "si", "no", "ok", "okay", "claro", "gracias",
  "nada", "nadie", "yo", "tu", "usted", "que", "quien", "como", "pues", "bueno", "eh", "mm", "vaya", "perfecto",
  "genial", "un", "una", "el", "la", "de", "del", "me", "llamo", "soy", "es", "cita", "pelo", "corte", "tinte",
  "hello", "hi", "hey", "yes", "yeah", "thanks", "thank", "you", "nothing", "nobody", "i", "am", "im", "is",
  "name", "the", "a", "an", "what", "who", "sure", "fine", "good", "hair", "cut",
  // insults and jokes
  "panfilo", "tonto", "tonta", "idiota", "imbecil", "estupido", "estupida", "gilipollas", "capullo", "cabron",
  "cabrona", "puta", "puto", "mierda", "joder", "bobo", "boba", "tarado", "subnormal", "payaso", "payasa",
  "pesado", "pesada", "loco", "loca", "culo", "caca", "idiot", "stupid", "dumb", "fool", "jerk", "moron",
]);

/** The most words a name may have ("María del Carmen Pérez García"). */
const MAX_NAME_WORDS = 5;

/**
 * Whether what the caller gave as a name could be one. False for an empty
 * text, a text with digits, a long text, a single letter, and a text made only
 * of endearments, insults, greetings or other everyday words ("Mi amor",
 * "cariño", "Pánfilo", "vale", "darling"). Pure and total: it never throws.
 */
export function looksLikeName(raw: string): boolean {
  if (/\d/.test(raw)) return false;
  const words = normalizeText(raw).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_NAME_WORDS) return false;
  if (words.join("").length < 2) return false;
  return !words.every((w) => NOT_NAME_WORDS.has(w));
}
