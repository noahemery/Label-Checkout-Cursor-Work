import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface ReferenceQrImageProps {
  payload: string | null | undefined;
  size?: number;
  className?: string;
}

export function ReferenceQrImage({ payload, size = 180, className }: ReferenceQrImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!payload?.trim()) {
      setSrc(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void QRCode.toDataURL(payload, {
      margin: 1,
      width: size,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(null);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payload, size]);

  if (!payload?.trim()) {
    return (
      <div className={`ref-qr-missing${className ? ` ${className}` : ''}`}>
        No label code — reference QR unavailable
      </div>
    );
  }
  if (failed) {
    return (
      <div className={`ref-qr-missing${className ? ` ${className}` : ''}`}>
        Could not render QR
      </div>
    );
  }
  if (!src) {
    return <div className={`ref-qr-loading${className ? ` ${className}` : ''}`}>Generating…</div>;
  }

  return (
    <img
      src={src}
      alt="On-screen reference QR code"
      className={`ref-qr-img${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
    />
  );
}
