import type { ReactNode } from 'react';

const shapes = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1l-2 11H3L1 8a1 1 0 0 1 1-1Z" />,
  save: (
    <>
      <path d="M5 3h12l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  map: (
    <>
      <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  file: (
    <>
      <path d="M14 2H4v20h16V8ZM14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  recover: (
    <>
      <path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 8h4m-4 8h4M17 8h4m-4 8h4M7 12h10" />
    </>
  ),
  route: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M7 5h8a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h8" />
    </>
  ),
  undo: <path d="m9 4-6 6 6 6M3 10h11a7 7 0 0 1 7 7v3" />,
  redo: <path d="m15 4 6 6-6 6m6-6H10a7 7 0 0 0-7 7v3" />,
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
    </>
  ),
  export: (
    <>
      <path d="M5 14v7h14v-7M12 16V3m-5 5 5-5 5 5" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <circle cx="12" cy="12" r="4" />
      <path d="m8 5 1-3h6l1 3" />
    </>
  ),
  layout: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </>
  ),
  fly: <path d="m21 3-6 18-4-8-8-4ZM11 13l5-5" />,
  cursor: <path d="m5 3 14 10-7 1-3 7Z" />,
} satisfies Record<string, ReactNode>;

export function Icon({ name, size = 18 }: { name: keyof typeof shapes; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}
