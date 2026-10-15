// Link to one integration in Settings: opens the Integrations tab with that card expanded and highlighted.
export const connectUrl = (provider: string) => `/settings?tab=integrations&connect=${encodeURIComponent(provider)}`
