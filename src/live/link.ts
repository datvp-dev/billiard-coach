export type LiveLink = { site: 'youtube' | 'tiktok' | 'other'; url: string };

/** A link to open, or null when the text is not a web address. A missing https:// is filled in. */
export function parseLiveLink(text: string): LiveLink | null {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname.includes('.') || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const on = (d: string) => host === d || host.endsWith(`.${d}`);
  const site = on('youtube.com') || on('youtu.be') ? 'youtube' : on('tiktok.com') ? 'tiktok' : 'other';
  return { site, url: u.href };
}
