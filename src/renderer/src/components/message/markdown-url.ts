import { defaultUrlTransform, type UrlTransform } from 'react-markdown';

export const getFileLinkPath = (href: string): string | null => {
  try {
    if (href.startsWith('//') || (href.startsWith('/') && (href.includes('\\') || Array.from(href).some((char) => char.charCodeAt(0) < 32)))) {
      return null;
    }
    const url = href.startsWith('/') ? new URL(href, 'file:///') : new URL(href);
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) {
      return null;
    }
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith('/') || path.includes('\0') || path.includes('\\') || path.startsWith('//')) {
      return null;
    }
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
};

export const messageUrlTransform: UrlTransform = (url, key, node) => {
  if (((key === 'href' && node.tagName === 'a') || (key === 'src' && node.tagName === 'img')) && getFileLinkPath(url)) {
    return url;
  }
  return defaultUrlTransform(url);
};
