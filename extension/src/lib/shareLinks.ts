// Web share-intent URL builders. Opening one of these in a new tab lands the
// volunteer on the platform's OWN composer, prefilled where the platform allows
// it. No OAuth, no API, no secrets — the app never posts on anyone's behalf.
//
// Caveats baked into the UI copy: Facebook's sharer only reliably prefills the
// URL (not the text), and Instagram/Threads composers ignore prefilled text
// entirely — so for those the reliable path is "Copy" to the clipboard.

import type { SharePlatform, SocialVariant } from "./types.js";

export interface ShareContent {
  text: string;
  url: string | null;
  hashtags: string[];
  /** "Paid for by …" attribution — appended to the shared text so the post a
   * volunteer actually publishes carries it (compliance approved it for a
   * reason). Omitted when the body already inlines its own attribution. */
  disclaimer?: string | null;
}

function disclaimerLine(content: ShareContent): string {
  if (!content.disclaimer || /paid for by/i.test(content.text)) return "";
  return content.disclaimer;
}

/** The full text a "Copy" action puts on the clipboard: body + hashtags + link + disclaimer. */
export function composeShareText(content: ShareContent): string {
  const tags = content.hashtags.join(" ");
  return [content.text, tags, content.url ?? "", disclaimerLine(content)]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Build the share-intent URL for a platform, or null when there's no useful
 * web-intent (Instagram, or the generic "copy" affordance) — the caller falls
 * back to clipboard copy in that case.
 */
export function buildShareUrl(
  platform: SharePlatform,
  content: ShareContent
): string | null {
  const url = content.url ?? "";
  const textWithTags = [content.text, content.hashtags.join(" "), disclaimerLine(content)]
    .filter(Boolean)
    .join(" ");
  switch (platform) {
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        textWithTags
      )}${url ? `&url=${encodeURIComponent(url)}` : ""}`;
    case "facebook":
      // Facebook's sharer is URL-based — without a link there is nothing to
      // share, so fall back to clipboard copy. It prefills the URL reliably;
      // quote is best-effort.
      if (!url) return null;
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        url
      )}&quote=${encodeURIComponent(textWithTags)}`;
    case "linkedin":
      // Same: share-offsite requires a URL.
      if (!url) return null;
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
        url
      )}`;
    case "threads":
      return `https://www.threads.net/intent/post?text=${encodeURIComponent(
        [textWithTags, url].filter(Boolean).join(" ")
      )}`;
    case "copy":
    default:
      return null;
  }
}

/** Pick the copy tailored to a platform, falling back to the first variant. */
export function variantFor(
  variants: SocialVariant[],
  platform: SharePlatform
): string {
  return (
    variants.find((v) => v.platform === platform)?.text ??
    variants[0]?.text ??
    ""
  );
}
