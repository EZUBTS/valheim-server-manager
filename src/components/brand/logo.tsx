import { useId } from 'react';

import { cn } from '@/lib/cn';

export interface LogoProps {
  className?: string;
}

/**
 * Valheim Server Manager brand mark: a dark forest tile with a gold *algiz*
 * rune (protection) — the same rune family Valheim uses for its UI glyphs.
 */
export function Logo({ className }: LogoProps) {
  const gradientId = `valheim-logo-${useId().replaceAll(':', '')}`;

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-6 shrink-0', className)}>
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#2c4430" />
          <stop offset="0.55" stopColor="#17241a" />
          <stop offset="1" stopColor="#0c130e" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="8.25"
        fill="none"
        stroke="#d8b25f"
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />
      {/* Algiz rune: stem with two raised branches. */}
      <path
        d="M16 8.6v14.8M9.8 9.4l6.2 6.1 6.2-6.1"
        fill="none"
        stroke="#e8c878"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="1.15" fill="#e8c878" />
    </svg>
  );
}
