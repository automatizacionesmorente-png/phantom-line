const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The copy-and-paste "call us" button for the owner's own website: one link, inline styles, no
 * script. The URL and the label are escaped, so nothing typed into the wizard can break out of
 * the attribute.
 */
export function websiteSnippet(callUrl: string, label: string): string {
  return (
    `<a href="${escapeAttr(callUrl)}" target="_blank" rel="noopener" ` +
    `style="display:inline-block;padding:12px 24px;border-radius:999px;background:#B3873B;color:#14110C;` +
    `font:700 16px/1.2 system-ui,sans-serif;text-decoration:none">${escapeText(label)}</a>`
  );
}
