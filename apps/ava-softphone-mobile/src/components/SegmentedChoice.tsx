import React from 'react';
import { colors, radius } from '../lib/theme';

export type SegOption<T extends string> = { value: T; label: string };

/** Visible two-way selector (Dark / Daylight, English / Français). */
export default function SegmentedChoice<T extends string>({
  value, options, onChange, ariaLabel,
}: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{
      display: 'inline-flex', padding: 3, gap: 3, borderRadius: radius.pill,
      background: colors.graphite, border: `1px solid ${colors.border}`,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={(e) => { e.stopPropagation(); if (!on) onChange(o.value); }}
            style={{
              minHeight: 32, padding: '0 12px', borderRadius: radius.pill, border: 'none',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: on ? colors.lemtelBlue : 'transparent',
              color: on ? '#FFFFFF' : colors.textIce,
              transition: 'background .15s ease',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
