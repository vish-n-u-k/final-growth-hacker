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
- Actions must be concrete but brief: 1–2 sentences max. Include a short inline code snippet only when strictly necessary.
- Never invent data not present in the pre-computed findings or page content.
- For brand sentiment checks (geo-sentiment-*): use your own training knowledge about the brand name provided. Be honest — if you don't recognise the brand, say so clearly (verified: false). Do not invent knowledge you don't have.`,
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
          description: 'Your website has a bouncer (called robots.txt) that decides which AI tools are allowed in. Right now the bouncer is turning away ChatGPT, Claude, and Perplexity at the door. We just need to update the guest list so they\'re allowed in to read your content.',
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
          description: 'Think of this as putting up clear signs for AI robots arriving at your website. Right now there are no signs, so ChatGPT and Claude have to guess where the important stuff is. We fix this by leaving a small file at your front door that says "here\'s what we do, here are our best pages."',
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
            {
              slug: 'geo-llms-depth',
              label: 'llms.txt has sufficient depth (5+ links across multiple sections)',
              prompt: 'Check whether llms.txt has meaningful depth: at least 5 markdown links spread across 2 or more ## sections. A minimal llms.txt with only 1–2 links gives AI models almost nothing to navigate. Rich depth significantly increases the chance of being cited for specific queries.',
              order: 6,
              weight: 1,
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
          description: 'This is the difference between handing someone a messy stack of papers versus a neatly labeled folder. Schema is invisible labeling that tells AI "this is a FAQ, this is our company info, this was last updated yesterday." Without it, AI has to read everything and figure it out — and usually gets it wrong.',
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
          description: 'AI tools love quoting pages that look like research — ones with real statistics, expert quotes, and links to credible sources. Your page reads more like a sales pitch, so AI skips over it when looking for something to cite. We fix this by adding real numbers and authoritative references.',
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
          description: 'When someone asks ChatGPT a question, it grabs short, scannable answers — not 400-word paragraphs. Your content is written in long blocks of prose. We need to break it into the kind of bite-sized chunks AI can lift directly into its answers.',
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
          description: 'AI prefers recent content over stale content, but it can only tell how fresh your page is if you tell it. Right now your pages have no "last updated" timestamp, so AI assumes they\'re old and ignores them in favor of competitors with dated content.',
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
          description: 'Emerging machine-readable endpoints that give AI engines a structured picture of your site without crawling every page. Not yet industry-standard, but early adopters get a structural advantage as AI engines begin relying on them.',
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
            {
              slug: 'geo-discovery-faq',
              label: '/ai/faq.json is present',
              prompt: 'Check whether /ai/faq.json exists and returns a 200 response. This endpoint exposes a structured FAQ dataset to AI engines — enabling direct Q&A extraction without parsing unstructured HTML. It is especially valuable for voice assistants and AI answer engines.',
              order: 3,
              weight: 1,
            },
            {
              slug: 'geo-discovery-service',
              label: '/ai/service.json is present',
              prompt: 'Check whether /ai/service.json exists and returns a 200 response. This endpoint describes your product or service in a machine-readable format — category, pricing model, target audience, key differentiators — allowing AI engines to accurately describe your offering in generated answers.',
              order: 4,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 6. Brand Sentiment ────────────────────────────────────────────────────
    {
      slug: 'brand-sentiment',
      label: 'Brand Sentiment in AI',
      order: 6,
      subCategories: [
        {
          slug: 'ai-perception',
          label: 'AI Brand Perception',
          order: 1,
          description: 'What AI engines currently say about your brand when users ask — evaluated against Claude\'s training knowledge. This checks whether AI accurately describes what you do, whether the framing is positive, and whether it recommends competitors instead of you for your own core use-case.',
          items: [
            {
              slug: 'geo-sentiment-known',
              label: 'Brand is recognised and accurately described by AI engines',
              prompt: 'Using your own training knowledge, do you recognise this brand by name? Can you describe what it does, who it serves, and its primary value proposition? If you have little or no knowledge of this brand, verified=false — that itself is the key finding: the brand is not visible in AI training data and is unlikely to be cited in AI-generated answers.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-sentiment-framing',
              label: 'AI description is accurate and positively framed',
              prompt: 'Based on your training knowledge of this brand and the homepage content provided, how do AI engines currently frame this brand? Is there any negative framing (e.g. "expensive", "limited", "only for X niche", "outdated")? Compare the AI framing against what the homepage actually says. verified=true only if the AI description is accurate and not negatively framed.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-sentiment-use-cases',
              label: 'AI correctly identifies the primary use-cases',
              prompt: 'Based on your training knowledge and the homepage content provided, does what AI engines know about this brand\'s use-cases match what the brand actually offers? Identify any use-cases prominent on the homepage that are absent from AI knowledge. verified=false if major use-cases are missing from AI understanding.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'geo-sentiment-competitors',
              label: 'AI does not default to competitors for this brand\'s core use-case',
              prompt: 'Based on your training knowledge, when users ask AI engines about this brand\'s core use-case (as described on the homepage), does AI tend to prominently recommend competitors as alternatives instead? verified=false if competitors are consistently cited ahead of this brand for its own stated core use-case.',
              order: 4,
              weight: 1,
            },
          ],
        },
      ],
    },
  ],
}
