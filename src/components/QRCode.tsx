import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

interface Props {
  value: string;
  size?: number;
  /** Higher levels tolerate more damage but produce denser codes. */
  ecl?: ErrorCorrectionLevel;
  color?: string;
  backgroundColor?: string;
  /** Quiet-zone margin, in modules (the QR spec recommends 4). */
  quietZone?: number;
}

/**
 * Pure-JS QR renderer. `qrcode-generator` computes the module matrix (no native
 * code); we emit a single SVG <Path> of all dark modules, which react-native-svg
 * draws crisply at any size and stays cheap even for long bolt11 invoices.
 */
export default function QRCode({
  value,
  size = 240,
  ecl = 'M',
  color = '#000000',
  backgroundColor = '#ffffff',
  quietZone = 4,
}: Props) {
  const { path, dim } = useMemo(() => {
    if (!value) {
      return { path: '', dim: quietZone * 2 || 1 };
    }
    // typeNumber 0 = auto-pick the smallest version that fits the data.
    const qr = qrcode(0, ecl);
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          // One unit square per dark module, offset by the quiet zone.
          d += `M${col + quietZone} ${row + quietZone}h1v1h-1z`;
        }
      }
    }
    return { path: d, dim: count + quietZone * 2 };
  }, [value, ecl, quietZone]);

  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`}>
        <Rect x={0} y={0} width={dim} height={dim} fill={backgroundColor} />
        {path ? <Path d={path} fill={color} /> : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    overflow: 'hidden',
  },
});
