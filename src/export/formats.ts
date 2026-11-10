/**
 * The export file formats: which of them this engine can encode, how the interface names them, their
 * file extensions and the filters of the save dialog.
 */
import type { AnimationFormat, ExportFormat } from '../core/types';

/** A file type of the save dialog. */
interface FileFilter {
  name: string;
  extensions: string[];
}

/** How the interface names each image format. */
export const IMAGE_FORMAT_LABEL: Record<ExportFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };

/** The file extension of an image format, without the dot. */
export function extensionFor(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

/** Save-dialog filter for an image format. */
export function imageFileFilter(format: ExportFormat): FileFilter {
  return { name: IMAGE_FORMAT_LABEL[format], extensions: [extensionFor(format)] };
}

/** Save-dialog filter for an animation format. */
export function animationFileFilter(format: AnimationFormat): FileFilter {
  const names: Record<AnimationFormat, string> = { gif: 'GIF', webp: 'WebP', mp4: 'MP4' };
  return { name: names[format], extensions: [format] };
}

let webpSupport: boolean | null = null;

/**
 * Can this engine ENCODE WebP from a canvas? (Chrome/Edge/Firefox: yes; Safari / WKWebView: no –
 * toBlob silently returns PNG.) The UI should hide or disable the WebP option when false. Cached.
 */
export function supportsWebpEncoding(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** Is WebCodecs video encoding present at all? (Config support is checked per MP4 export.) */
export function mp4EncodingAvailable(): boolean {
  return (
    typeof VideoEncoder === 'function' && typeof VideoFrame === 'function' && typeof EncodedVideoChunk === 'function'
  );
}

/** Which animation formats this engine can produce (GIF always; WebP and MP4 depend on the engine). */
export function animationFormatSupport(): Record<AnimationFormat, boolean> {
  return { gif: true, webp: supportsWebpEncoding(), mp4: mp4EncodingAvailable() };
}
