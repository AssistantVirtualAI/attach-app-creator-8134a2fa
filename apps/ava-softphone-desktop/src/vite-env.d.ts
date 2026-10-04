/// <reference types="vite/client" />

// Electron's draggable window region is not part of standard CSSProperties.
import 'react';
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
