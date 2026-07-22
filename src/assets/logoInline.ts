/**
 * Brand mark hosted on GitHub so the all-in-one management.html stays single-file
 * (icons load from raw.githubusercontent.com at runtime).
 *
 * Paths live under src/assets/brand/ on the main branch of this fork.
 */
const BRAND_RAW_BASE =
  'https://raw.githubusercontent.com/josephcy95/Cli-Proxy-API-Management-Center/main/src/assets/brand';

/** Primary app mark (nav, login). 512×512 PNG with transparent corners. */
export const BRAND_ICON_URL = `${BRAND_RAW_BASE}/app-icon.png`;

/** Favicon (32×32 PNG). */
export const BRAND_FAVICON_URL = `${BRAND_RAW_BASE}/favicon-32.png`;

/** Apple touch / high-res shortcut icon. */
export const BRAND_APPLE_TOUCH_ICON_URL = `${BRAND_RAW_BASE}/apple-touch-icon.png`;

/** @deprecated Prefer BRAND_ICON_URL — kept for existing imports. */
export const INLINE_LOGO_JPEG = BRAND_ICON_URL;
