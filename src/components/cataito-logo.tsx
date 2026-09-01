/**
 * CATAITO word-mark logo — adapted from E:\aiapp\AI LOGO\cataito-1.svg
 *
 * Theme adaptive via CSS custom properties:
 *   --dot-primary   /  --dot-secondary
 *   These are defined per-theme in globals.css under :root and [data-theme=dark].
 *
 * Pure SVG + CSS, no JS state needed — the two decorative dots under the A
 * letters automatically follow the current theme.
 */

interface CATAITOLogoProps {
  width?: number;
  className?: string;
}

export function CATAITOLogo({ width = 104, className = "" }: CATAITOLogoProps) {
  return (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ color: "var(--text-primary)" }}
      aria-label="CATAITO"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 560 100"
        width={width}
        height={(100 / 560) * width}
        role="img"
        aria-label="CATAITO"
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: "visible", display: "block" }}
      >
        <g
          stroke="currentColor"
          fill="none"
          stroke-width="18"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M 71.8 27.5 A 35 35 0 1 0 71.8 72.5" />
          <path d="M 96 85 L 131 15 L 166 85" />
          <path d="M 190 15 L 252 15" />
          <path d="M 221 15 L 221 85" />
          <path d="M 276 85 L 311 15 L 346 85" />
          <path d="M 370 15 L 370 85" />
          <path d="M 394 15 L 456 15" />
          <path d="M 425 15 L 425 85" />
          <circle cx="515" cy="50" r="35" />
        </g>
        <circle
          cx="131"
          cy="77"
          r="9"
          style={{ fill: "var(--dot-primary, #2563EB)" }}
        />
        <circle
          cx="311"
          cy="77"
          r="9"
          style={{ fill: "var(--dot-secondary, #7C3AED)" }}
        />
      </svg>
    </span>
  );
}