import React from 'react';
import { colors, radius } from '../lib/theme';

export type SegmentedOption<T extends string> = { value: T; label: string };

/** Sélecteur tactile explicite pour les préférences à deux choix. */
export default function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        gap: 3,
        padding: 3,
        maxWidth: '100%',
        border: `1px solid ${colors.border}`,
        borderRadius: radius.pill,
        background: colors.graphite,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={(event) => {
              event.stopPropagation();
              if (!selected) onChange(option.value);
            }}
            style={{
              minHeight: 32,
              padding: '0 11px',
              border: 0,
              borderRadius: radius.pill,
              background: selected ? colors.lemtelBlue : 'transparent',
              color: selected ? '#fff' : colors.textIce,
              cursor: selected ? 'default' : 'pointer',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.15,
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
