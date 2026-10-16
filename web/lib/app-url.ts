// The app's public origin (https://app.growjin.com). Use it for every link that leaves the app (emails,
// notifications), so links land on the domain the installed app is registered for and open in it.
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.growjin.com').replace(/\/$/, '')

export const appUrl = (path = '') => `${APP_URL}${path}`
