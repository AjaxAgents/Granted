/*
 * QR scanning.
 *   iPhone app: Apple's camera and Vision framework through the official
 *               @capacitor/barcode-scanner plugin (no third-party analytics SDK).
 *   Web:        the live camera (getUserMedia) decoded with jsQR, or a photo.
 * Camera permission is asked only when someone taps Scan (App Store 5.1.1).
 */
import jsQR from 'jsqr';
import { isNative } from './storage';

/** Opens the native scanner. Returns the text, or null if the person cancelled. */
export async function scanNative(): Promise<string | null> {
  const m = await import('@capacitor/barcode-scanner');
  try {
    const r = await m.CapacitorBarcodeScanner.scanBarcode({
      hint: m.CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: 'Point the camera at the gate pass QR code',
      cameraDirection: m.CapacitorBarcodeScannerCameraDirection.BACK,
      cancelButtonAccessibilityLabel: 'Cancel scanning',
      torchButtonOnAccessibilityLabel: 'Turn off the light',
      torchButtonOffAccessibilityLabel: 'Turn on the light',
    });
    return r && r.ScanResult ? r.ScanResult : null;
  } catch {
    return null;
  }
}

export const canUseLiveCamera = () => !isNative() && typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia && window.isSecureContext;

/** Decodes a QR code from one video frame or image. */
export function decodeFrame(source: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement): string | null {
  canvas.width = w; canvas.height = h;
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  if (!cx) return null;
  cx.drawImage(source, 0, 0, w, h);
  const out = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
  return out && out.data ? out.data : null;
}

/** Decodes a QR code from a photo, trying a few sizes. */
export async function decodeImageFile(file: File): Promise<{ data?: string; error?: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const cv = document.createElement('canvas');
    for (const max of [1400, 900, 2000]) {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const data = decodeFrame(img, Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k), cv);
      if (data) return { data };
    }
    return { error: 'No QR code found in that photo. Hold the camera closer and try again, or type the code.' };
  } catch {
    return { error: 'That photo couldn’t be read. Try again or type the code.' };
  } finally { URL.revokeObjectURL(url); }
}
