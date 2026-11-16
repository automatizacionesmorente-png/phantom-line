/**
 * Opens a native `<dialog>` as a modal: `showModal()` traps focus, closes on Escape and
 * returns focus to the opener (owner-machine 13.6). A browser without it (very old ones,
 * and jsdom 29) gets a plain open dialog instead of nothing; tests do not polyfill it.
 */
export function openDialog(d: HTMLDialogElement): void {
  if (d.open) return;
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute("open", "");
}

export function closeDialog(d: HTMLDialogElement | null): void {
  if (!d) return;
  if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}
