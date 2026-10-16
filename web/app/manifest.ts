import type { MetadataRoute } from 'next'

// Makes the app installable ("Add to Home Screen" / "Install GrowJin"). Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'GrowJin',
    short_name: 'GrowJin',
    description: 'Your road to 500 users',
    start_url: '/start',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: '#f7f7f5',
    // Open links to app.growjin.com (e.g. from emails) in the installed app instead of the browser,
    // reusing the open app window rather than starting a new one.
    handle_links: 'preferred',
    launch_handler: { client_mode: ['navigate-existing', 'auto'] },
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  } as MetadataRoute.Manifest // cast: Next's type lacks handle_links
}
