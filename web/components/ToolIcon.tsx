import type { JSX } from 'react'

// Line icons for the sidebar and the Tools page, drawn on a 20×20 grid.
const ICON: Record<string, JSX.Element> = {
  search: <><circle cx="8.8" cy="8.8" r="5.3" /><path d="M12.7 12.7 17 17" /></>,
  path: <path d="M6 16h4a4 4 0 0 0 4-4V8a4 4 0 0 1 4-4M4 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM16 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  sun: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" /></>,
  mail: <><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M3.5 6l6.5 5 6.5-5" /></>,
  image: <><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><circle cx="7" cy="8" r="1.4" /><path d="M4 14l3.5-3.5L10 13l3-3.5 3 3.5" /></>,
  megaphone: <><path d="M3 8v4h2.5L13 16V4L5.5 8H3Z" /><path d="M15.5 8.3a2.6 2.6 0 0 1 0 3.4" /></>,
  target: <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3.4" /></>,
  bell: <><path d="M6 7.5a4 4 0 0 1 8 0c0 3.5 1.2 4.7 1.5 5.3H4.5C4.8 12.2 6 11 6 7.5Z" /><path d="M8.3 15.5a1.8 1.8 0 0 0 3.4 0" /></>,
  chart: <path d="M3 16.5h14M5.8 16.5v-5M10 16.5v-9M14.2 16.5V4.5" />,
  logout: <><path d="M8 17.5H5a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 5 2.5h3" /><path d="M13 14l4-4-4-4M17 10H8" /></>,
  install: <><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5" /><path d="M4 13.5v1.5A1.5 1.5 0 0 0 5.5 16.5h9a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></>,
  bot: <><rect x="4" y="7" width="12" height="9" rx="2.5" /><path d="M10 4.5V7M7.6 11.4v.2M12.4 11.4v.2M2.5 11v2M17.5 11v2" /><circle cx="10" cy="3.5" r="1" /></>,
  // Cog (Lucide 'settings', drawn on a 24 grid and scaled to this 20 grid) so it doesn't look like Today's sun.
  gear: <g transform="scale(0.8333)" strokeWidth="1.9"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></g>,
}

export default function ToolIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
      {ICON[name]}
    </svg>
  )
}
