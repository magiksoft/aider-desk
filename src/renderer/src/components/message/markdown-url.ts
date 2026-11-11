import { defaultUrlTransform, type UrlTransform } from 'react-markdown';

export const getFileLinkPath = (href: string): string | null => {
  try {
    const url = new URL(href);
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
  if (key === 'href' && node.tagName === 'a' && getFileLinkPath(url)) {
    return url;
  }
  return defaultUrlTransform(url);
};
