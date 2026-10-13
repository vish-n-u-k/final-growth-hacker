import type { MetadataRoute } from 'next'

// Makes the app installable ("Add to Home Screen" / "Install GrowJin"). Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'GrowJin',
    short_name: 'GrowJin',
    description: 'Your road to 500 users',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: '#f7f7f5',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
