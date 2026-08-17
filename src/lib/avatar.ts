/**
 * Sanitizes profile image URLs across API responses and frontend components.
 * Only valid HTTPS URLs (e.g. Cloudinary) are allowed.
 * Invalid, non-HTTPS, or localhost URLs are returned as undefined so the browser never attempts network requests to dead local ports.
 */
export function sanitizeProfileImageUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return undefined;
  }

  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return undefined;
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname.endsWith('.local')) {
      return undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}
