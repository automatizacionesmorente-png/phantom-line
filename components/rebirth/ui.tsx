import type { ReactNode } from "react";
import { ERROR_TEXT } from "@/lib/rebirth/copy";
import type { Lang } from "@/lib/sectors";

export const INPUT =
  "focus-ring min-h-11 w-full rounded-xl border border-border bg-card px-3 font-inter text-base text-ink placeholder:text-muted aria-[invalid=true]:border-light-text";
export const LABEL = "font-inter text-sm font-semibold text-ink";
export const HINT = "font-inter text-sm text-muted";
export const SECONDARY =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-ink bg-card px-5 font-inter text-base font-semibold text-ink hover:bg-section disabled:border-border disabled:text-muted";

/** The sentence for an error code, or nothing. */
export const errorText = (lang: Lang, code: string | undefined): string | undefined =>
  code === undefined ? undefined : (ERROR_TEXT[lang][code] ?? ERROR_TEXT[lang].invalid);

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="font-inter text-sm font-semibold text-light-text">
      {message}
    </p>
  );
}

export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal" | "url";
  maxLength?: number;
  autoComplete?: string;
  placeholder?: string;
  describedBy?: string;
}

export function TextField({ id, label, value, onChange, error, hint, type = "text", inputMode, maxLength, autoComplete, placeholder }: TextFieldProps) {
  const errId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errId : "", hint ? hintId : ""].filter(Boolean).join(" ") || undefined}
        className={INPUT}
      />
      {hint && (
        <p id={hintId} className={HINT}>
          {hint}
        </p>
      )}
      <FieldError id={errId} message={error} />
    </div>
  );
}

export function Section({ heading, hint, children }: { heading: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-newsreader text-3xl font-medium tracking-tight text-ink">{heading}</h2>
      {hint && <p className="font-inter text-base text-text">{hint}</p>}
      {children}
    </section>
  );
}
