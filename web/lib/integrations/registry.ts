// ── Integration Registry ──────────────────────────────────────────────────────
// To add a new integration: add one entry to INTEGRATION_REGISTRY below.
// The settings page renders cards dynamically from this list.

export interface IntegrationField {
  key: string           // matches column name: 'api_key' | 'access_token' | or a metadata key
  label: string
  placeholder: string
  inputType: 'text' | 'password' | 'url'
  helpText?: string
  isMetadata?: boolean  // true = stored in metadata jsonb, false = top-level column
  optional?: boolean    // true = field is optional, not required
}

export interface IntegrationDefinition {
  provider: string      // unique key — 'github' | 'youtube' | ...
  name: string
  description: string
  type: 'oauth' | 'api_key'
  group: 'developer' | 'analytics' | 'social'
  fields: IntegrationField[]
  docsUrl?: string
}

export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [

  // ── Developer Tools ─────────────────────────────────────────────────────────
  {
    provider: 'github',
    name: 'GitHub',
    description: 'Connect your repository so agents can read your code and apply fixes directly.',
    type: 'api_key',
    group: 'developer',
    docsUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    fields: [
      {
        key: 'api_key',
        label: 'Personal Access Token',
        placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'Requires repo scope (read + write). Classic tokens recommended.',
      },
      {
        key: 'repo_url',
        label: 'Repository URL',
        placeholder: 'https://github.com/yourname/yourrepo',
        inputType: 'url',
        helpText: 'The GitHub repository that hosts your website.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'brand_assets',
    name: 'Brand Assets',
    description: 'Provide asset URLs (OG image, logo) so auto-fix can produce complete results instead of partial ones.',
    type: 'api_key',
    group: 'developer',
    fields: [
      {
        key: 'og_image_url',
        label: 'OG Image URL',
        placeholder: 'https://yourdomain.com/og-image.jpg',
        inputType: 'url',
        helpText: 'A 1200×630px image used when your pages are shared on social media. Required for a complete og:image fix.',
        isMetadata: true,
        optional: true,
      },
      {
        key: 'logo_url',
        label: 'Logo URL',
        placeholder: 'https://yourdomain.com/logo.png',
        inputType: 'url',
        helpText: 'Your brand logo URL, included in JSON-LD structured data for search engines.',
        isMetadata: true,
        optional: true,
      },
    ],
  },

  // ── Analytics & Performance ─────────────────────────────────────────────────
  {
    provider: 'google_analytics',
    name: 'Google Analytics',
    description: 'Connect GA4 so the agent can inject your tracking script directly into your codebase.',
    type: 'api_key',
    group: 'analytics',
    docsUrl: 'https://support.google.com/analytics/answer/9304153',
    fields: [
      {
        key: 'ga4_measurement_id',
        label: 'GA4 Measurement ID',
        placeholder: 'G-XXXXXXXXXX',
        inputType: 'text',
        helpText: 'Found in GA4 → Admin → Data Streams → your stream → Measurement ID.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'google_search_console',
    name: 'Google Search Console',
    description: 'Connect GSC so the agent can add the verification meta tag to your site automatically.',
    type: 'api_key',
    group: 'analytics',
    docsUrl: 'https://support.google.com/webmasters/answer/9008080',
    fields: [
      {
        key: 'gsc_verification_code',
        label: 'Verification Code',
        placeholder: 'Paste the content value from the HTML meta tag',
        inputType: 'text',
        helpText: 'In GSC → Add Property → HTML tag method → copy only the content="..." value.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'google_psi',
    name: 'Google PageSpeed Insights',
    description: 'Enables Core Web Vitals checks (FCP, LCP, CLS) and performance scoring in the Foundation module.',
    type: 'api_key',
    group: 'analytics',
    docsUrl: 'https://developers.google.com/speed/docs/insights/v5/get-started',
    fields: [
      {
        key: 'api_key',
        label: 'PageSpeed Insights API Key',
        placeholder: 'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX',
        inputType: 'password',
        helpText: 'Free from Google Cloud Console → APIs & Services → Credentials. Enable the PageSpeed Insights API first.',
      },
    ],
  },

  // ── Social Media ────────────────────────────────────────────────────────────
  {
    provider: 'youtube',
    name: 'YouTube',
    description: 'Fetch subscriber count, video stats, and posting frequency for the Social Media Audit module.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    fields: [
      {
        key: 'api_key',
        label: 'YouTube Data API Key',
        placeholder: 'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX',
        inputType: 'password',
        helpText: 'Free from Google Cloud Console → APIs & Services → Credentials. Enable the YouTube Data API v3 first.',
      },
      {
        key: 'channel_id',
        label: 'Channel ID',
        placeholder: 'UCxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'text',
        helpText: 'Go to your YouTube channel → click your profile picture → Settings → Advanced settings → Channel ID.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'twitter',
    name: 'Twitter / X',
    description: 'Fetch follower count and recent tweet stats for the Social Media Audit module.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://developer.twitter.com/en/portal/dashboard',
    fields: [
      {
        key: 'api_key',
        label: 'Bearer Token',
        placeholder: 'AAAAAAAAAAAAAAAAAAAAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'From developer.twitter.com → Your App → Keys and Tokens → Bearer Token. Note: engagement metrics (impressions, reach) require a paid Basic plan.',
      },
      {
        key: 'twitter_username',
        label: 'Username',
        placeholder: 'yourbrand',
        inputType: 'text',
        helpText: 'Your Twitter/X username without the @ symbol.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'instagram',
    name: 'Instagram',
    description: 'Fetch follower count, post engagement, and reach via the Instagram Graph API.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://developers.facebook.com/docs/instagram-api/getting-started',
    fields: [
      {
        key: 'access_token',
        label: 'Long-Lived Access Token',
        placeholder: 'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'From Facebook Developer → Graph API Explorer → select your app → get token with instagram_basic and instagram_manage_insights scopes → extend to long-lived token. Requires a Business or Creator account.',
      },
      {
        key: 'instagram_account_id',
        label: 'Instagram Account ID',
        placeholder: '17841400000000000',
        inputType: 'text',
        helpText: 'Numeric ID. From Graph API Explorer: GET /me/accounts → find your page → GET /{page-id}?fields=instagram_business_account → copy the id value.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'facebook',
    name: 'Facebook',
    description: 'Fetch page likes, reach, and post engagement via the Facebook Graph API.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://developers.facebook.com/docs/pages/access-tokens',
    fields: [
      {
        key: 'access_token',
        label: 'Page Access Token',
        placeholder: 'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'From Facebook Developer → Graph API Explorer → select your app → select your page → get token with pages_read_engagement and pages_read_user_content scopes.',
      },
      {
        key: 'page_id',
        label: 'Page ID',
        placeholder: '123456789012345',
        inputType: 'text',
        helpText: 'Numeric ID. Found in your Facebook Page → About → scroll to "Page Transparency" → Page ID.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'linkedin',
    name: 'LinkedIn',
    description: 'Fetch company page follower count and basic stats via the LinkedIn API.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://developer.linkedin.com/',
    fields: [
      {
        key: 'access_token',
        label: 'OAuth Access Token',
        placeholder: 'AQXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'From LinkedIn Developer → create an app → OAuth 2.0 Tools → request token with r_organization_social and r_organization_followers scopes.',
      },
      {
        key: 'organization_id',
        label: 'Organization ID',
        placeholder: '12345678',
        inputType: 'text',
        helpText: 'Numeric ID from your LinkedIn Company page URL: linkedin.com/company/[name] → Admin tools → your organization URN will show the numeric ID.',
        isMetadata: true,
      },
    ],
  },
  {
    provider: 'meta_ads',
    name: 'Meta Ads',
    description: 'Connect your Meta Ads account to enable campaign performance analysis, ad creative review, and content strategy generation.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://developers.facebook.com/docs/marketing-api/get-started',
    fields: [
      {
        key: 'access_token',
        label: 'Meta Access Token',
        placeholder: 'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'From developers.facebook.com → Graph API Explorer → select your app → generate token with ads_management, pages_read_engagement, and instagram_basic scopes.',
      },
      {
        key: 'ad_account_id',
        label: 'Ad Account ID',
        placeholder: '1234567890',
        inputType: 'text',
        helpText: 'Numeric ID only, without the "act_" prefix. Found in Meta Ads Manager → top-left account selector.',
        isMetadata: true,
      },
      {
        key: 'page_id',
        label: 'Facebook Page ID',
        placeholder: '123456789012345',
        inputType: 'text',
        helpText: 'Numeric ID. Found in your Facebook Page → About → Page Transparency section.',
        isMetadata: true,
        optional: true,
      },
      {
        key: 'instagram_account_id',
        label: 'Instagram Account ID',
        placeholder: '17841400000000000',
        inputType: 'text',
        helpText: 'Numeric ID. From Graph API Explorer: GET /me/accounts → find your page → GET /{page-id}?fields=instagram_business_account → copy the id.',
        isMetadata: true,
        optional: true,
      },
    ],
  },
  {
    provider: 'tiktok',
    name: 'TikTok',
    description: 'Fetch follower count and video performance stats via the TikTok for Developers API.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://developers.tiktok.com/',
    fields: [
      {
        key: 'access_token',
        label: 'Access Token',
        placeholder: 'act.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'From developers.tiktok.com → Manage Apps → your app → generate access token. Note: TikTok Developer app approval may take a few days.',
      },
      {
        key: 'tiktok_username',
        label: 'TikTok Username',
        placeholder: 'yourbrand',
        inputType: 'text',
        helpText: 'Your TikTok username without the @ symbol.',
        isMetadata: true,
        optional: true,
      },
    ],
  },
]

export const INTEGRATION_MAP = Object.fromEntries(
  INTEGRATION_REGISTRY.map((i) => [i.provider, i]),
)

export const INTEGRATION_GROUPS: Record<string, { label: string; description: string }> = {
  developer: {
    label: 'Developer Tools',
    description: 'Code repositories and asset management for automated fixes.',
  },
  analytics: {
    label: 'Analytics & Performance',
    description: 'Track website traffic, search presence, and page speed.',
  },
  social: {
    label: 'Social Media',
    description: 'Connect your social accounts to enable the Social Media Audit module.',
  },
}
