import type { JSX } from "react";

export type IconName =
  | "mail" | "lock" | "user" | "gift" | "eye" | "eyeOff"
  | "zap" | "infinity" | "grid" | "book" | "chart" | "users"
  | "shield" | "shieldCheck" | "check" | "checkCircle" | "clock"
  | "sprout" | "crown" | "gem" | "sparkles" | "bell"
  | "menu" | "close" | "arrowRight" | "globe";

const PATHS: Record<IconName, JSX.Element> = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7.5 8.5 6 8.5-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="9.5" rx="2.5" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /><circle cx="12" cy="15.7" r="1.3" fill="currentColor" stroke="none" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.6-3.6 4.2-5.2 7.5-5.2s5.9 1.6 7.5 5.2" /></>,
  gift: <><rect x="4" y="10" width="16" height="4" rx="1.2" /><path d="M6 14v5.2A1.8 1.8 0 0 0 7.8 21h8.4a1.8 1.8 0 0 0 1.8-1.8V14" /><path d="M12 10v11" /><path d="M12 10c-2 0-4-.9-4-2.4C8 6 9.6 5 10.7 5.8 11.8 6.6 12 8.6 12 10zm0 0c2 0 4-.9 4-2.4 0-1.6-1.6-2.6-2.7-1.8C12.2 6.6 12 8.6 12 10z" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M2.5 12S6 5.5 12 5.5c1.8 0 3.4.6 4.8 1.4M21.5 12S18 18.5 12 18.5c-1.8 0-3.4-.6-4.8-1.4" /><path d="m4 4 16 16" /></>,
  zap: <path d="M13 2.5 4 14h6.5L10 21.5 20 9.5h-6.5L13 2.5z" />,
  infinity: <path d="M18.2 8.2a3.8 3.8 0 0 1 0 7.6c-2.4 0-3.4-2-6.2-3.8s-3.8-3.8-6.2-3.8a3.8 3.8 0 0 0 0 7.6c2.4 0 3.4-2 6.2-3.8s3.8-3.8 6.2-3.8z" />,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2.5H6.5A2.5 2.5 0 0 0 4 5v14.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>,
  chart: <><path d="M3.5 20.5h17" /><path d="M7 20.5v-6" /><path d="M12 20.5v-10" /><path d="M17 20.5V4.5" /></>,
  users: <><circle cx="9" cy="7.5" r="3.6" /><path d="M2.5 20.5v-1.6a5.2 5.2 0 0 1 5.2-5.2h2.6a5.2 5.2 0 0 1 5.2 5.2v1.6" /><path d="M16 4.2a3.6 3.6 0 0 1 0 6.7" /><path d="M18.3 14.1a5.2 5.2 0 0 1 3.2 4.8v1.6" /></>,
  shield: <path d="M12 22s8-3.8 8-10V5.2L12 2 4 5.2V12c0 6.2 8 10 8 10z" />,
  shieldCheck: <><path d="M12 22s8-3.8 8-10V5.2L12 2 4 5.2V12c0 6.2 8 10 8 10z" /><path d="m8.8 11.8 2.2 2.2 4.2-4.5" /></>,
  check: <path d="M20 6.5 9.5 17l-5-5" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.4 12.4 2.4 2.4 4.8-5.3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.4 2" /></>,
  sprout: <><path d="M12 21.5v-8" /><path d="M12 13.5c0-4.2-3.2-6.3-8.5-6.3 0 4.2 3.2 6.3 8.5 6.3z" /><path d="M12 11.5c0-4.2 3.2-6.3 8.5-6.3 0 4.2-3.2 6.3-8.5 6.3z" /></>,
  crown: <><path d="m4 8 4.2 3.6L12 5l3.8 6.6L20 8l-1.6 10H5.6L4 8z" /><path d="M6 21h12" /></>,
  gem: <><path d="M6.5 3.5h11L21.5 9 12 21 2.5 9l4-5.5z" /><path d="M2.5 9h19" /><path d="m9.5 3.5 2.5 5.5 2.5-5.5" /><path d="M12 21 9.5 9m2.5 12L14.5 9" /></>,
  sparkles: <><path d="M12 3.5 13.8 8 18.5 9.8 13.8 11.6 12 16 10.2 11.6 5.5 9.8 10.2 8 12 3.5z" /><path d="m18.5 15.5.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" /><path d="m5 16.5.7 1.6 1.6.7-1.6.7L5 21l-.7-1.6-1.6-.7 1.6-.7.7-1.6z" /></>,
  bell: <><path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" /><path d="M13.8 20.5a2 2 0 0 1-3.6 0" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  arrowRight: <path d="M4.5 12h15m-6-6 6 6-6 6" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.7 2.6 4 5.6 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.6-4-9s1.3-6.4 4-9z" /></>
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
