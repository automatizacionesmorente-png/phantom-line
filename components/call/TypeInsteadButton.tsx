"use client";

export interface TypeInsteadButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** Always visible, also where voice works: switches to Typed_Mode without ending the Call (2.11). */
export function TypeInsteadButton({ label, onClick, disabled }: TypeInsteadButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 rounded-full px-4 font-inter text-base font-medium text-gold-text underline decoration-gold-dot underline-offset-4 hover:decoration-gold-text disabled:cursor-not-allowed disabled:opacity-60"
    >
      {label}
    </button>
  );
}
