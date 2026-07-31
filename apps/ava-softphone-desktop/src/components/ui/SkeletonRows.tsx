import React from 'react';

/**
 * Shimmering skeleton placeholder rows used in place of textual "Loading…"
 * states. Purely presentational — it never changes fetching logic.
 */
export default function SkeletonRows({
  rows = 5,
  height = 14,
  gap = 12,
  padding = 16,
  avatar = false,
  label = 'Loading',
}: {
  rows?: number;
  height?: number;
  gap?: number;
  padding?: number;
  avatar?: boolean;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} style={{ padding, display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {avatar && (
            <div
              className="ava-skeleton-row"
              style={{ width: height * 2.4, height: height * 2.4, borderRadius: '50%', flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="ava-skeleton-row" style={{ height, width: `${88 - (i % 3) * 14}%` }} />
            <div className="ava-skeleton-row" style={{ height: Math.max(8, height - 5), width: `${52 - (i % 4) * 8}%`, opacity: 0.75 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
