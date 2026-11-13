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

export const getRelativeFileLinkPath = (href: string, baseDir: string): string | null => {
  if (!baseDir || !href || /^[a-z][a-z\d+.-]*:/i.test(href) || /^[/#?]/.test(href)) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(href);
    if (decoded.includes('\\') || Array.from(decoded).some((char) => char.charCodeAt(0) < 32)) {
      return null;
    }
    const directory = baseDir.replace(/\\/g, '/').replace(/\/$/, '');
    const encodedDirectory = directory.split('/').map(encodeURIComponent).join('/');
    const base = /^[a-z]:\//i.test(directory) ? `file:///${encodedDirectory}/` : `file://${encodedDirectory}/`;
    return getFileLinkPath(new URL(href, base).href);
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
