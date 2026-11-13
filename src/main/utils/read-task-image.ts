import { open, realpath } from 'fs/promises';
import path from 'path';

import { fileTypeFromBuffer } from 'file-type';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon']);

export const readTaskImage = async (taskDir: string, filePath: string): Promise<string> => {
  if (!filePath || filePath.includes('\0')) {
    throw new Error('Invalid image path');
  }
  const root = await realpath(taskDir);
  const absolutePath = await realpath(path.resolve(root, filePath));
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error('Image must be inside the task directory');
  }
  const file = await open(absolutePath, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_IMAGE_SIZE) {
      throw new Error('Image must be a regular file no larger than 20 MB');
    }
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) {
        throw new Error('Image changed while reading');
      }
      offset += bytesRead;
    }
    const type = await fileTypeFromBuffer(buffer);
    if (!type || !IMAGE_TYPES.has(type.mime)) {
      throw new Error('Unsupported image format');
    }
    return `data:${type.mime};base64,${buffer.toString('base64')}`;
  } finally {
    await file.close();
  }
};
