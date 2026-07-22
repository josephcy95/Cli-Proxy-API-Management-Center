import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.scss';
import App from './App.tsx';
import { BRAND_APPLE_TOUCH_ICON_URL, BRAND_FAVICON_URL } from '@/assets/logoInline';

document.title = 'CPAMC++';
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

const ensureLink = (rel: string, href: string, type?: string, sizes?: string) => {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
  if (type) el.type = type;
  if (sizes) el.sizes = sizes;
};

ensureLink('icon', BRAND_FAVICON_URL, 'image/png', '32x32');
ensureLink('apple-touch-icon', BRAND_APPLE_TOUCH_ICON_URL, undefined, '180x180');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
