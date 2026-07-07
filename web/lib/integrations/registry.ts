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
  customUI?: boolean    // true = skip standard IntegrationCard rendering
  setupSteps?: string[] // step-by-step guide shown in the card
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
    setupSteps: [
      'Go to github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)',
      'Click "Generate new token (classic)" → give it a name → tick the "repo" scope (read + write)',
      'Click Generate token → copy it immediately (it is only shown once)',
      'Enter your repository URL (e.g. https://github.com/yourname/yourrepo)',
      'Paste both above and click Connect',
    ],
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
    setupSteps: [
      'Host your OG image (1200×630px) somewhere publicly accessible — your repo\'s /public folder or a CDN works fine',
      'Host your logo image (PNG or SVG) at a public URL as well',
      'Copy the direct URLs to each file (they must be reachable without a login)',
      'Paste them above and click Save',
    ],
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
    setupSteps: [
      'Go to analytics.google.com → Admin → Create property → choose "Web"',
      'Follow the setup wizard to create a data stream for your website',
      'Copy your Measurement ID — it starts with G- (found under Admin → Data Streams → your stream)',
      'Add the GA4 snippet to your website\'s <head> tag (or install via Google Tag Manager)',
      'Paste the Measurement ID above and click Connect',
    ],
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
    setupSteps: [
      'Go to search.google.com/search-console → Add property → enter your domain',
      'Choose the "HTML tag" verification method',
      'Copy only the content="..." value from the meta tag shown — not the whole tag, just the value inside the quotes',
      'Add the meta tag to your website\'s <head> (or let our agent do it after you save)',
      'Paste the content value above and click Connect',
    ],
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
    setupSteps: [
      'Go to console.cloud.google.com → select or create a project',
      'APIs & Services → Library → search "PageSpeed Insights API" → Enable it',
      'APIs & Services → Credentials → Create Credentials → API Key',
      'Copy the generated API key',
      'Paste it above and click Connect',
    ],
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

  {
    provider: 'posthog',
    name: 'PostHog',
    description: 'Connect PostHog to unlock the User Analytics module — MAU, DAU, event tracking, conversion funnels, and growth health.',
    type: 'api_key',
    group: 'analytics',
    docsUrl: 'https://posthog.com/docs/api',
    setupSteps: [
      'Go to posthog.com → sign up → create a new project for your product',
      'Copy the JS snippet from PostHog\'s setup wizard and paste it into your website\'s <head> tag — this is what tracks users going forward',
      'For the Personal API Key: PostHog → Settings → Personal API keys → Create personal API key → give it "Read" access',
      'For the Project ID: PostHog → Project Settings → look for the numeric ID (also visible in your PostHog URL: app.posthog.com/project/12345)',
      'Paste both above and click Connect — your live user count will appear on the dashboard',
    ],
    fields: [
      {
        key: 'api_key',
        label: 'Personal API Key',
        placeholder: 'phx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'PostHog → Settings → Personal API keys → Create personal API key. Give it "Read" access to the project.',
      },
      {
        key: 'project_id',
        label: 'Project ID',
        placeholder: '12345',
        inputType: 'text',
        helpText: 'Found in PostHog → Project settings → Project ID (numeric). Also visible in your PostHog URL: app.posthog.com/project/12345',
        isMetadata: true,
      },
      {
        key: 'posthog_host',
        label: 'PostHog Host (optional)',
        placeholder: 'https://us.posthog.com',
        inputType: 'url',
        helpText: 'Leave blank for US cloud (default). Set to https://eu.posthog.com for EU cloud, or your self-hosted URL.',
        isMetadata: true,
        optional: true,
      },
    ],
  },
  {
    provider: 'serpapi',
    name: 'SerpAPI',
    description: 'Enables People Also Ask question data in the Keyword Research module. Free tier includes 100 searches/month.',
    type: 'api_key',
    group: 'analytics',
    docsUrl: 'https://serpapi.com/manage-api-key',
    setupSteps: [
      'Go to serpapi.com → sign up for a free account (100 searches/month at no cost)',
      'From your dashboard, copy your API key',
      'Paste it above and click Connect',
    ],
    fields: [
      {
        key: 'api_key',
        label: 'SerpAPI Key',
        placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'Get your free API key at serpapi.com → Dashboard. Free plan: 100 searches/month.',
      },
    ],
  },
  {
    provider: 'serper',
    name: 'Serper',
    description: 'Enables competitor mention discovery in the Outreach Targets module — finds review sites, comparison posts, and press articles covering your competitors. Free tier includes 2,500 searches.',
    type: 'api_key',
    group: 'analytics',
    docsUrl: 'https://serper.dev',
    setupSteps: [
      'Go to serper.dev → sign up for a free account (2,500 free searches, no credit card)',
      'From your dashboard, copy your API key',
      'Paste it above and click Connect',
    ],
    fields: [
      {
        key: 'api_key',
        label: 'Serper API Key',
        placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'Get your free API key at serper.dev → Dashboard. Free plan includes 2,500 searches.',
      },
    ],
  },
  {
    provider: 'apify',
    name: 'Apify',
    description: 'Optional. Adds Facebook & LinkedIn groups to the Social Media Community Finder (Reddit works without it). Apify\'s free tier ($5/month, no card) covers ~50-100 runs.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://console.apify.com/settings/integrations',
    setupSteps: [
      'Go to console.apify.com → sign up free (Google sign-in works, no credit card)',
      'Open Settings → API & Integrations → copy your personal API token',
      'Paste it above and click Connect',
    ],
    fields: [
      {
        key: 'api_key',
        label: 'Apify API Token',
        placeholder: 'apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'console.apify.com → Settings → API & Integrations. Free tier ~$5/month covers this module.',
      },
    ],
  },
  {
    provider: 'gsc_api',
    name: 'Google Search Console API',
    description: 'Unlocks real ranking data — top queries, click-through rates, and keyword positions — in the Keyword Research module. Uses a Service Account key, no OAuth flow needed.',
    type: 'api_key',
    group: 'analytics',
    docsUrl: 'https://developers.google.com/webmaster-tools/v1/api_reference_index',
    setupSteps: [
      'Go to console.cloud.google.com → IAM & Admin → Service Accounts → Create service account',
      'Once created, click the account → Keys tab → Add Key → Create new key → JSON → download the file',
      'Open the downloaded JSON file — copy the client_email and private_key values',
      'In Google Search Console → Settings → Users and permissions → Add user → paste the service account email → set permission to "Full"',
      'Paste the client_email and private_key above and click Connect',
    ],
    fields: [
      {
        key: 'client_email',
        label: 'Service Account Email',
        placeholder: 'myapp@myproject.iam.gserviceaccount.com',
        inputType: 'text',
        helpText: 'Google Cloud Console → IAM & Admin → Service Accounts → create account → create JSON key → copy client_email value. Then add this email as a user in your GSC property settings.',
        isMetadata: true,
      },
      {
        key: 'private_key',
        label: 'Private Key',
        placeholder: '-----BEGIN RSA PRIVATE KEY-----\n...',
        inputType: 'password',
        helpText: 'The private_key field from the downloaded JSON key file. Paste the full key including the BEGIN and END lines.',
        isMetadata: true,
      },
    ],
  },

  // ── Social Media ────────────────────────────────────────────────────────────
  {
    provider: 'social_profiles',
    name: 'Social Media Profiles',
    description: 'Add your social media profile URLs for richer analysis without API tokens.',
    type: 'api_key',
    group: 'social',
    customUI: true,
    fields: [
      { key: 'instagram_url',  label: 'Instagram',  placeholder: 'https://instagram.com/yourbrand',         inputType: 'url',  isMetadata: true, optional: true },
      { key: 'facebook_url',   label: 'Facebook',   placeholder: 'https://facebook.com/yourbrand',          inputType: 'url',  isMetadata: true, optional: true },
      { key: 'linkedin_url',   label: 'LinkedIn',   placeholder: 'https://linkedin.com/company/yourbrand',  inputType: 'url',  isMetadata: true, optional: true },
      { key: 'youtube_url',    label: 'YouTube',    placeholder: 'https://youtube.com/@yourbrand',          inputType: 'url',  isMetadata: true, optional: true },
      { key: 'twitter_url',    label: 'X (Twitter)',placeholder: 'https://x.com/yourbrand',                 inputType: 'url',  isMetadata: true, optional: true },
      { key: 'tiktok_url',     label: 'TikTok',     placeholder: 'https://tiktok.com/@yourbrand',           inputType: 'url',  isMetadata: true, optional: true },
      { key: 'custom_links',   label: 'Custom Links',placeholder: '',                                       inputType: 'text', isMetadata: true, optional: true },
    ],
  },
  {
    provider: 'youtube',
    name: 'YouTube',
    description: 'Fetch subscriber count, video stats, and posting frequency for the Social Media Audit module.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    setupSteps: [
      'Go to console.cloud.google.com → APIs & Services → Library → search "YouTube Data API v3" → Enable it',
      'APIs & Services → Credentials → Create Credentials → API Key → copy it',
      'Find your Channel ID: YouTube → click your profile picture → Settings → Advanced settings → copy the Channel ID (starts with UC)',
      'Paste both above and click Connect',
    ],
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
    setupSteps: [
      'Go to developer.twitter.com → sign up for a developer account (free tier available)',
      'Create a project and an app inside it',
      'Keys and Tokens → Bearer Token → copy it',
      'Note: impressions and reach data require a paid Basic plan ($100/month) — follower count works on free',
      'Enter your Twitter username (without the @) and paste the Bearer Token above, then click Connect',
    ],
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
    setupSteps: [
      'You need a Business or Creator Instagram account linked to a Facebook Page — personal accounts do not work',
      'Go to developers.facebook.com → My Apps → create an app → add "Instagram Graph API" product',
      'Graph API Explorer → select your app → generate a token with instagram_basic and instagram_manage_insights scopes → extend it to a long-lived token (valid 60 days)',
      'Find your Instagram Account ID: Graph API Explorer → GET /me/accounts → find your page → GET /{page-id}?fields=instagram_business_account → copy the id value',
      'Paste the token and account ID above and click Connect',
    ],
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
    setupSteps: [
      'Go to developers.facebook.com → My Apps → create an app → add "Pages API" product',
      'Graph API Explorer → select your app → generate a token with pages_read_engagement and pages_read_user_content scopes → select your page',
      'Find your Page ID: go to your Facebook Page → About → scroll to "Page Transparency" → Page ID (numeric)',
      'Paste the token and Page ID above and click Connect',
    ],
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
    setupSteps: [
      'Go to developer.linkedin.com → My Apps → Create app → link it to your LinkedIn Company Page',
      'Request the r_organization_social and r_organization_followers product permissions (requires LinkedIn review — can take a few days)',
      'Once approved: OAuth 2.0 Tools → generate an access token with those scopes',
      'Find your Organization ID: it\'s the numeric part in your Company page URL or Admin Tools → look for your organization URN',
      'Paste the token and Organization ID above and click Connect',
    ],
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
    setupSteps: [
      'Go to developers.facebook.com → My Apps → Create App → choose "Business" type',
      'Add the "Marketing API" product to your app',
      'Graph API Explorer → select your app → generate a token with ads_management, pages_read_engagement, and instagram_basic scopes',
      'Find your Ad Account ID: Meta Ads Manager → top-left account selector → copy the numeric ID (without the "act_" prefix)',
      'Paste the token and Ad Account ID above and click Connect',
    ],
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
    provider: 'frekto',
    name: 'Frekto',
    description: 'Generate social media images and short videos from text prompts. Powers the Content Studio in the Social Media Audit module.',
    type: 'api_key',
    group: 'social',
    docsUrl: 'https://app.frekto.ai/docs',
    setupSteps: [
      'Go to app.frekto.ai and sign up for an account',
      'In your dashboard, go to API Keys → Create new key',
      'Copy your API key (it starts with frekto_live_)',
      'Paste it above and click Connect',
      'Free tier: 10 renders/day · Paid tier: 30 renders/day',
    ],
    fields: [
      {
        key: 'api_key',
        label: 'Frekto API Key',
        placeholder: 'frekto_live_xxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'From app.frekto.ai → API Keys → Create new key. Free tier includes 10 image/video renders per day.',
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
    setupSteps: [
      'Go to developers.tiktok.com → Register for a developer account',
      'Create an app → submit it for review (TikTok app approval can take several days)',
      'Once approved, generate an access token from your app dashboard',
      'Enter your TikTok username (without the @)',
      'Paste the token above and click Connect',
    ],
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
