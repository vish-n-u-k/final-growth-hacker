import type { ModuleDefinition } from '../types'

export const GEO_MODULE: ModuleDefinition = {
  type: 'geo',
  name: 'GEO Audit',
  description: 'Generative Engine Optimization — audit how visible and citable your site is to AI engines like ChatGPT, Perplexity, Gemini, and Claude.',
  order: 9,
  unlockThreshold: 0,
  dynamic: false,
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'yourdomain.com',
    },
  ],
  systemPrompt: `You are a GEO (Generative Engine Optimization) specialist. Your job is to audit how well a website is optimized to be cited and referenced by AI-powered search engines such as ChatGPT, Perplexity, Google AI Overviews, and Claude.

You receive pre-computed rule findings (robots.txt parse results, schema types detected, llms.txt content, technical signals) alongside page content. Use the rule findings as ground truth for structural checks. Use the page content to evaluate content-quality checks.

Rules:
- For structural checks (robots, llms.txt, schema, signals): the pre-computed finding is the fact — your job is to explain why it matters and what to do.
- For content checks: evaluate directly from the page data provided.
- Always be specific: name exact bot names, exact schema types, exact missing elements.
- Actions must be concrete: include exact code snippets, file paths, or commands where relevant.
- Never invent data not present in the pre-computed findings or page content.`,
  categories: [
    // ── 1. AI Crawler Access ─────────────────────────────────────────────────
    {
      slug: 'ai-crawler-access',
      label: 'AI Crawler Access',
      order: 1,
      subCategories: [
        {
          slug: 'robots-ai-bots',
          label: 'robots.txt AI Bot Rules',
          order: 1,
          description: 'Fetched automatically from /robots.txt — no setup required. If any AI bot is blocked, your content cannot be indexed or cited by that AI engine.',
          items: [
            {
              slug: 'geo-robots-tier1',
              label: 'AI training bots not blocked (GPTBot, ClaudeBot, Google-Extended)',
              prompt: 'Check whether major AI training bots are blocked: GPTBot (OpenAI), ClaudeBot (Anthropic), Google-Extended (Gemini), Amazonbot, CCBot, Meta-ExternalAgent. These bots train the AI models — blocking them means your content is excluded from the model\'s knowledge base. Report which bots are blocked, allowed, or not mentioned.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-robots-tier2',
              label: 'AI search bots not blocked (OAI-SearchBot, PerplexityBot)',
              prompt: 'Check whether AI search retrieval bots are blocked: OAI-SearchBot (OpenAI search), PerplexityBot, YouBot, anthropic-ai. These bots index your content for real-time AI-generated answers — blocking them means your site cannot appear in ChatGPT Browse, Perplexity, or similar AI search results. Report which are blocked, allowed, or not mentioned.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'geo-robots-tier3',
              label: 'Real-time user bots not blocked (ChatGPT-User, Claude-User)',
              prompt: 'Check whether real-time user-agent bots are blocked: ChatGPT-User, Claude-User, Perplexity-User. These bots fetch pages on behalf of users asking AI questions in real time — blocking them means AI cannot access your content when answering a specific user query. Report which are blocked, allowed, or not mentioned.',
              order: 3,
              weight: 2,
            },
          ],
        },
      ],
    },

    // ── 2. LLMs.txt ──────────────────────────────────────────────────────────
    {
      slug: 'llms-txt',
      label: 'LLMs.txt',
      order: 2,
      subCategories: [
        {
          slug: 'llms-txt-checks',
          label: 'LLMs.txt File',
          order: 1,
          description: 'Fetched automatically from /llms.txt — no setup required. This is the emerging standard for telling AI models what your site is about and what content to prioritise.',
          items: [
            {
              slug: 'geo-llms-present',
              label: '/llms.txt file exists at the domain root',
              prompt: 'Check whether /llms.txt exists. This file is the AI equivalent of robots.txt — it tells LLMs what your site is, what it does, and which pages matter most. Without it, AI models must guess your site\'s purpose from unstructured content.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-llms-h1',
              label: 'llms.txt has an H1 site description',
              prompt: 'Check whether llms.txt has an H1 line (starting with #) that clearly describes the site. The H1 is the primary signal AI models use to understand what your site is about.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-llms-blockquote',
              label: 'llms.txt has a blockquote elevator pitch',
              prompt: 'Check whether llms.txt has a blockquote (line starting with >) that provides a concise elevator pitch. This is the summary AI models use when generating brief mentions of your product.',
              order: 3,
              weight: 1,
            },
            {
              slug: 'geo-llms-sections',
              label: 'llms.txt has named content sections',
              prompt: 'Check whether llms.txt has ## section headings that group different types of content (e.g. Features, Documentation, Blog). Sections help AI models navigate your content and cite the right page for the right query.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'geo-llms-links',
              label: 'llms.txt links to key pages',
              prompt: 'Check whether llms.txt contains markdown links to important pages. Without links, AI models cannot navigate to specific content even if they know it exists.',
              order: 5,
              weight: 2,
            },
          ],
        },
      ],
    },

    // ── 3. Structured Data ───────────────────────────────────────────────────
    {
      slug: 'structured-data',
      label: 'Structured Data for AI',
      order: 3,
      subCategories: [
        {
          slug: 'schema-types',
          label: 'JSON-LD Schema Types',
          order: 1,
          description: 'Fetched automatically from your page HTML — no setup required. JSON-LD schema lets AI engines extract structured facts about your business rather than guessing from unstructured text.',
          items: [
            {
              slug: 'geo-schema-faq',
              label: 'FAQPage schema present',
              prompt: 'Check whether FAQPage JSON-LD schema is present. FAQPage is the single highest-value schema for GEO — AI engines pull Q&A pairs directly from FAQPage schema to answer user questions, and frequently cite the source. If present, confirm it has actual question/answer content.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-schema-org',
              label: 'Organization schema present with sameAs',
              prompt: 'Check whether Organization JSON-LD schema is present and whether it includes a sameAs array linking to external entity sources (Wikipedia, Wikidata, LinkedIn, social profiles). sameAs is critical for entity disambiguation — it tells AI models that your brand name maps to a specific real-world entity, preventing confusion with similar names.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'geo-schema-website',
              label: 'WebSite schema present',
              prompt: 'Check whether WebSite JSON-LD schema is present. WebSite schema tells AI models the official name, URL, and search action for your site — it is the foundation for brand entity recognition in AI-generated answers.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'geo-schema-article',
              label: 'Article or BlogPosting schema on content pages',
              prompt: 'Check whether Article or BlogPosting JSON-LD schema is present. For content-heavy sites, Article schema is required for blog posts and guides to be cited as sources in AI-generated answers. Without it, AI models treat the page as generic content rather than a citable resource.',
              order: 4,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 4. Content Citability ─────────────────────────────────────────────────
    {
      slug: 'content-citability',
      label: 'Content Citability',
      order: 4,
      subCategories: [
        {
          slug: 'citation-signals',
          label: 'Citation Quality Signals',
          order: 1,
          description: 'Evaluated from your page content automatically. These signals determine whether AI models consider your content worth citing in generated answers.',
          items: [
            {
              slug: 'geo-content-stats',
              label: 'Statistics and data points present in content',
              prompt: 'Evaluate whether the page body contains specific statistics, numbers, percentages, or quantified claims (e.g. "reduces churn by 23%", "used by 10,000 teams", "saves 5 hours per week"). Research shows statistics increase AI citation rate by ~33%. Assess the quality and specificity of any data points found.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'geo-content-citations',
              label: 'External authoritative citations present',
              prompt: 'Evaluate whether the page content links to or references external authoritative sources (studies, reports, well-known publications, industry data). AI models trust and cite content that itself cites reputable sources — it signals factual grounding. Check for any outbound links or source references.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-content-lists',
              label: 'Bullet points and tables present for easy extraction',
              prompt: 'Evaluate whether the page uses structured content formats: bullet lists (ul/ol), numbered lists, or tables. AI models extract and cite structured information far more readily than dense paragraphs. Assess whether key information is presented in a scannable, list-based format.',
              order: 3,
              weight: 1,
            },
          ],
        },
        {
          slug: 'answer-structure',
          label: 'Answer-Ready Structure',
          order: 2,
          description: 'Evaluated from your page content. Answer-ready structure makes it easy for AI to extract and cite a specific, well-scoped answer.',
          items: [
            {
              slug: 'geo-structure-h1',
              label: 'H1 is specific and matches page intent',
              prompt: 'Evaluate whether the H1 is specific, descriptive, and clearly states what this page is about. Generic H1s like "Home", "Welcome", or just the brand name confuse AI models about the page\'s purpose. A good H1 reads like a title an AI would use when citing this page.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'geo-structure-faq-content',
              label: 'FAQ-style Q&A content present on the page',
              prompt: 'Evaluate whether the page contains explicit question-and-answer style content — either a formal FAQ section or content structured around answering specific questions (headings phrased as questions followed by clear answers). This dramatically increases the chance of being cited in AI-generated answers to those exact questions.',
              order: 2,
              weight: 2,
            },
          ],
        },
      ],
    },

    // ── 5. Technical Signals ─────────────────────────────────────────────────
    {
      slug: 'technical-signals',
      label: 'Technical Signals',
      order: 5,
      subCategories: [
        {
          slug: 'freshness-signals',
          label: 'Freshness & Language Signals',
          order: 1,
          description: 'Fetched automatically from your page HTML — no setup required. These signals tell AI models whether your content is fresh, authoritative, and internationally accessible.',
          items: [
            {
              slug: 'geo-signals-lang',
              label: 'html lang attribute is set',
              prompt: 'Check whether the <html> tag has a lang attribute (e.g. lang="en"). AI models use this to understand the primary language of the content and to decide whether to cite it for queries in that language.',
              order: 1,
              weight: 1,
            },
            {
              slug: 'geo-signals-modified',
              label: 'Content freshness date is declared',
              prompt: 'Check whether the page declares a content freshness date via article:modified_time meta tag, dateModified in JSON-LD, or lastmod signals. AI models prefer citing recent, maintained content — undated content is treated as potentially stale.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-signals-rss',
              label: 'RSS or Atom feed is present',
              prompt: 'Check whether the page has a <link rel="alternate" type="application/rss+xml"> or Atom feed link. RSS feeds allow AI crawlers to discover and track new content automatically, increasing indexing frequency and citation recency.',
              order: 3,
              weight: 1,
            },
          ],
        },
        {
          slug: 'ai-discovery',
          label: 'AI Discovery Endpoints',
          order: 2,
          description: 'Fetched automatically from well-known paths — no setup required. These emerging endpoints let AI engines discover structured summaries of your content without crawling every page.',
          items: [
            {
              slug: 'geo-discovery-aitxt',
              label: '/.well-known/ai.txt is present',
              prompt: 'Check whether /.well-known/ai.txt exists and returns a 200 response. This emerging standard (similar to security.txt) provides AI systems with a structured declaration of your AI interaction policies, contact details, and preferred citation formats.',
              order: 1,
              weight: 1,
            },
            {
              slug: 'geo-discovery-summary',
              label: '/ai/summary.json is present',
              prompt: 'Check whether /ai/summary.json exists and returns a 200 response. This endpoint provides AI engines with a machine-readable summary of your site — name, description, key features, and primary use cases — without requiring full page crawls.',
              order: 2,
              weight: 1,
            },
          ],
        },
      ],
    },
  ],
}
