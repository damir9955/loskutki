'use client';

/**
 * Общие SVG-определения: «тканевые» фактуры, блик, тень.
 * Единственный экземпляр монтируется в корне приложения.
 */
export function FabricDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {/* точки */}
        <pattern id="fab-dots" patternUnits="userSpaceOnUse" width="0.18" height="0.18">
          <circle cx="0.05" cy="0.05" r="0.028" fill="#ffffff" opacity="0.28" />
          <circle cx="0.14" cy="0.14" r="0.028" fill="#000000" opacity="0.10" />
        </pattern>
        {/* диагональные полоски */}
        <pattern id="fab-diag" patternUnits="userSpaceOnUse" width="0.16" height="0.16" patternTransform="rotate(45)">
          <rect width="0.07" height="0.16" fill="#ffffff" opacity="0.20" />
          <rect x="0.08" width="0.025" height="0.16" fill="#000000" opacity="0.07" />
        </pattern>
        {/* штриховка (крестики) */}
        <pattern id="fab-hatch" patternUnits="userSpaceOnUse" width="0.22" height="0.22">
          <path d="M 0 0.11 L 0.22 0.11" stroke="#ffffff" strokeWidth="0.03" opacity="0.20" />
          <path d="M 0.11 0 L 0.11 0.22" stroke="#ffffff" strokeWidth="0.03" opacity="0.20" />
        </pattern>
        {/* клетка */}
        <pattern id="fab-check" patternUnits="userSpaceOnUse" width="0.36" height="0.36">
          <rect width="0.18" height="0.18" fill="#ffffff" opacity="0.16" />
          <rect x="0.18" y="0.18" width="0.18" height="0.18" fill="#ffffff" opacity="0.16" />
        </pattern>
        {/* плетение */}
        <pattern id="fab-weave" patternUnits="userSpaceOnUse" width="0.14" height="0.14">
          <rect width="0.14" height="0.07" fill="#ffffff" opacity="0.13" />
          <rect y="0.07" width="0.07" height="0.07" fill="#000000" opacity="0.09" />
          <rect x="0.07" y="0.07" width="0.07" height="0.07" fill="#ffffff" opacity="0.22" />
        </pattern>
        {/* вертикальные полосы */}
        <pattern id="fab-stripe" patternUnits="userSpaceOnUse" width="0.2" height="0.2">
          <rect width="0.09" height="0.2" fill="#ffffff" opacity="0.18" />
        </pattern>
        {/* мелкие крестики-стежки */}
        <pattern id="fab-cross" patternUnits="userSpaceOnUse" width="0.3" height="0.3">
          <path d="M 0.08 0.08 L 0.16 0.16 M 0.16 0.08 L 0.08 0.16" stroke="#ffffff" strokeWidth="0.035" opacity="0.3" strokeLinecap="round" />
        </pattern>
        {/* без фактуры */}
        <pattern id="fab-plain" patternUnits="userSpaceOnUse" width="1" height="1">
          <rect width="1" height="1" fill="none" />
        </pattern>
        {/* мягкий блик для объёма ткани */}
        <linearGradient id="fab-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.17" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.10" />
        </linearGradient>
        {/* вертикальная тень для доски */}
        <linearGradient id="quilt-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.012" />
        </linearGradient>
      </defs>
    </svg>
  );
}
