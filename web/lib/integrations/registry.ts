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
}

export interface IntegrationDefinition {
  provider: string      // unique key — 'github' | 'openai' | 'vercel' | ...
  name: string
  description: string
  type: 'oauth' | 'api_key'
  fields: IntegrationField[]
  docsUrl?: string
}

export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description: 'Connect your repository so agents can read your code and apply fixes directly.',
    type: 'api_key',
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
    provider: 'google_analytics',
    name: 'Google Analytics',
    description: 'Connect GA4 so the agent can inject your tracking script directly into your codebase.',
    type: 'api_key',
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
    provider: 'openai',
    name: 'OpenAI',
    description: 'Store your OpenAI API key for use in upcoming AI-powered features.',
    type: 'api_key',
    docsUrl: 'https://platform.openai.com/api-keys',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        placeholder: 'sk-xxxxxxxxxxxxxxxxxxxx',
        inputType: 'password',
        helpText: 'Found in your OpenAI dashboard under API keys.',
      },
    ],
  },
]

export const INTEGRATION_MAP = Object.fromEntries(
  INTEGRATION_REGISTRY.map((i) => [i.provider, i]),
)
