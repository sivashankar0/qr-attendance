import QRCode from 'qrcode';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** Renders a QR code with react-native-svg (no native QR dependency). */
export function QrMatrix({ value, size }: { value: string; size: number }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);
  const quiet = 4;
  const box = count + quiet * 2;
  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} accessibilityLabel="Attendance QR code">
      <Rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <Path d={path} fill="#000" />
    </Svg>
  );
}
