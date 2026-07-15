"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

// Renders `value` as a scannable SVG QR code, generated entirely in the
// browser — no third-party QR API, so the encoded link/number never leaves
// the device. Always drawn black-on-white regardless of theme: QR scanners
// need real contrast and a light quiet zone, not to match a dark sidebar.
export function QrCode({
  value,
  size = 160,
  className = "",
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M"); // 0 = auto-pick the smallest version that fits
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const modules: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      modules.push(row);
    }
    return modules;
  }, [value]);

  const n = cells.length;
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="QR code"
    >
      <rect width={n} height={n} fill="#fff" />
      {cells.map((row, r) =>
        row.map((dark, c) =>
          dark ? (
            <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" />
          ) : null,
        ),
      )}
    </svg>
  );
}
