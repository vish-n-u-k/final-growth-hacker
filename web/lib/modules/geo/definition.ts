import type { ModuleDefinition } from '../types'

export const GEO_MODULE: ModuleDefinition = {
  type: 'geo',
  name: 'GEO Audit',
  description: 'Generative Engine Optimization — audit how visible and citable your site is to AI engines like ChatGPT, Perplexity, Gemini, and Claude.',
  order: 9,
  unlockThreshold: 80,
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
- For brand sentiment checks (geo-sentiment-*): use your own training knowledge about the brand name provided. Be honest — if you don't recognise the brand, say so clearly (verified: false). Do not invent knowledge you don't have.
- For entity knowledge checks (geo-entity-wikipedia): use your own training knowledge to assess whether this brand has a Wikipedia or Wikidata entry. Be honest — if you don't recognise the brand, verified=false.
- For competitor citation checks (geo-competitor-share): use your own training knowledge to assess whether AI engines tend to cite this brand for its core use-case. Be honest.`,
  categories: [
    // ── 1. AI Discovery & llms.txt ────────────────────────────────────────────
    {
      slug: 'ai-discovery-llms',
      label: 'AI Discovery & llms.txt',
      order: 1,
      subCategories: [
        {
          slug: 'llms-txt-checks',
          label: 'LLMs.txt & AI Endpoints',
          order: 1,
          description: 'The file AI engines read to understand your site — equivalent to leaving a clear signpost for ChatGPT, Claude, and Perplexity at your front door. Also covers emerging AI-specific JSON endpoints that let AI engines understand your product without crawling every page.',
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
            {
              slug: 'geo-discovery-aitxt',
              label: '/.well-known/ai.txt is present',
              prompt: 'Check whether /.well-known/ai.txt exists and returns a 200 response. This emerging standard provides AI systems with a structured declaration of your AI interaction policies, contact details, and preferred citation formats.',
              order: 7,
              weight: 1,
            },
            {
              slug: 'geo-discovery-summary',
              label: '/ai/summary.json is present',
              prompt: 'Check whether /ai/summary.json exists and returns a 200 response. This endpoint provides AI engines with a machine-readable summary of your site — name, description, key features, and primary use cases — without requiring full page crawls.',
              order: 8,
              weight: 1,
            },
            {
              slug: 'geo-discovery-faq',
              label: '/ai/faq.json is present',
              prompt: 'Check whether /ai/faq.json exists and returns a 200 response. This endpoint exposes a structured FAQ dataset to AI engines — enabling direct Q&A extraction without parsing unstructured HTML.',
              order: 9,
              weight: 1,
            },
            {
              slug: 'geo-discovery-service',
              label: '/ai/service.json is present',
              prompt: 'Check whether /ai/service.json exists and returns a 200 response. This endpoint describes your product in a machine-readable format — category, pricing model, target audience, key differentiators — allowing AI engines to accurately describe your offering in generated answers.',
              order: 10,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 2. AI Bot Access ─────────────────────────────────────────────────────
    {
      slug: 'ai-bot-access',
      label: 'AI Bot Access',
      order: 2,
      subCategories: [
        {
          slug: 'robots-ai-bots',
          label: 'robots.txt AI Bot Rules',
          order: 1,
          description: 'Your robots.txt is the bouncer deciding which AI tools are allowed in. Blocking ChatGPT, Claude, or Perplexity bots locks them out of your content entirely — they cannot train on it, index it, or cite it.',
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

    // ── 3. Schema & Structured Data ──────────────────────────────────────────
    {
      slug: 'schema-structured-data',
      label: 'Schema & Structured Data',
      order: 3,
      subCategories: [
        {
          slug: 'schema-types',
          label: 'JSON-LD Schema Types',
          order: 1,
          description: 'Invisible labeling that tells AI "this is a FAQ, this is our company info, this was last updated yesterday." Without it, AI reads everything and usually gets it wrong.',
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

    // ── 4. Entity Clarity ────────────────────────────────────────────────────
    {
      slug: 'entity-clarity',
      label: 'Entity Clarity',
      order: 4,
      subCategories: [
        {
          slug: 'entity-signals',
          label: 'Entity Recognition Signals',
          order: 1,
          description: 'AI engines build a map of real-world entities — companies, products, people. If your brand is not on that map as a distinct entity, AI will confuse you with competitors or simply not know you exist. These checks verify how clearly your brand is established as a unique, recognisable entity.',
          items: [
            {
              slug: 'geo-entity-wikipedia',
              label: 'Brand has a Wikipedia or Wikidata entry',
              prompt: 'Using your own training knowledge, does this brand have a Wikipedia article or Wikidata entry? Wikipedia and Wikidata are the primary sources AI models use for entity grounding — a brand without either is treated as unknown by most AI systems. If you do not recognise this brand in your training data, verified=false and state clearly that the brand lacks an AI-accessible entity record.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-entity-sameas-depth',
              label: 'sameAs links include authoritative directories (Wikipedia, Wikidata, Crunchbase)',
              prompt: 'From the pre-computed findings, check whether the Organization schema\'s sameAs array (if present) includes high-authority entity sources: Wikipedia, Wikidata, Crunchbase, LinkedIn company page, or G2/Capterra. Social profiles (Twitter, Instagram, Facebook) alone are weak signals — authoritative directories are what AI models use for entity disambiguation. verified=true only if at least one high-authority source is present in sameAs.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-entity-nap',
              label: 'Brand name is consistent across page title, H1, and schema',
              prompt: 'From the pre-computed page signals (title, H1) and schema data, check whether the brand name is spelled and capitalised consistently across all three. Inconsistencies (e.g. "Frekto" in H1 but "Frekto AI" in schema) create entity disambiguation failures — AI models may treat these as different entities. verified=true if the brand name is consistent.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'geo-entity-about',
              label: '/about or /company page is referenced with brand story',
              prompt: 'From the page headings, navigation, and body content, check for links or references to an /about, /about-us, or /company page. Dedicated about pages with founding story, team, and mission are strong entity-building signals — AI models use them to build a factual profile of your brand. verified=true if such a page is clearly referenced.',
              order: 4,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 5. Citation Friendliness ─────────────────────────────────────────────
    {
      slug: 'citation-friendliness',
      label: 'Citation Friendliness',
      order: 5,
      subCategories: [
        {
          slug: 'citation-signals',
          label: 'Citation Quality Signals',
          order: 1,
          description: 'AI tools love quoting pages that look like research — ones with real statistics, expert quotes, and links to credible sources. Pages written like sales copy get skipped. These checks verify your content has the signals that make AI want to cite it.',
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
      ],
    },

    // ── 6. Answer Ready Content Structure ────────────────────────────────────
    {
      slug: 'answer-ready-content',
      label: 'Answer Ready Content Structure',
      order: 6,
      subCategories: [
        {
          slug: 'answer-structure',
          label: 'Answer-Ready Structure',
          order: 1,
          description: 'When someone asks ChatGPT a question, it grabs short, scannable answers — not 400-word paragraphs. Content needs to be broken into bite-sized chunks AI can lift directly into its answers.',
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

    // ── 7. Content Freshness & Signals ───────────────────────────────────────
    {
      slug: 'content-freshness',
      label: 'Content Freshness & Signals',
      order: 7,
      subCategories: [
        {
          slug: 'freshness-signals',
          label: 'Freshness & Language Signals',
          order: 1,
          description: 'AI prefers recent content over stale content, but it can only tell how fresh your page is if you declare it. Pages without timestamps are assumed old and ranked below competitors with dated content.',
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
      ],
    },

    // ── 8. Competitor Citation ────────────────────────────────────────────────
    {
      slug: 'competitor-citation',
      label: 'Competitor Citation',
      order: 8,
      subCategories: [
        {
          slug: 'competitor-citation-signals',
          label: 'Competitor Citation Signals',
          order: 1,
          description: 'When users ask AI about your space, which brands get mentioned? If competitors are consistently cited for your core use-case while you are not, you have a GEO gap regardless of how good your product is. These checks assess your competitive standing in AI-generated answers.',
          items: [
            {
              slug: 'geo-competitor-share',
              label: 'AI engines cite this brand for its core use-case',
              prompt: 'Using your own training knowledge, when users ask AI engines about this brand\'s core use-case (as described on the homepage), is this brand mentioned as a leading or recommended solution? Or do AI responses default entirely to competitors? verified=true if this brand is commonly cited for its own primary use-case. verified=false if AI tends to route users to competitors instead.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-competitor-compare',
              label: 'Content directly addresses comparison with named competitors',
              prompt: 'Evaluate whether the page content or headings directly address comparison with named competitors (e.g. "vs Competitor X", "how we compare", "alternative to X"). Comparison content is heavily cited by AI when users ask "X vs Y" queries. Absence means missing an entire category of AI citation opportunities.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-competitor-diff',
              label: 'Unique differentiator statement is extractable by AI',
              prompt: 'Evaluate whether the page contains a clear, specific differentiator statement that AI can extract and repeat — something beyond generic claims like "easy to use" or "powerful". A good differentiator is specific: "the only tool that does X for Y audience in Z way". Assess whether such a statement is present and prominent.',
              order: 3,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 9. Brand Sentiment in AI Outputs ─────────────────────────────────────
    {
      slug: 'brand-sentiment-ai',
      label: 'Brand Sentiment in AI Outputs',
      order: 9,
      subCategories: [
        {
          slug: 'ai-perception',
          label: 'AI Brand Perception',
          order: 1,
          description: 'What AI engines currently say about your brand when users ask — evaluated against Claude\'s training knowledge. Checks whether AI accurately describes what you do, whether the framing is positive, and whether it recommends competitors instead of you for your own core use-case.',
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
