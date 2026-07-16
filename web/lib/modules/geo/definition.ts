import type { ModuleDefinition } from '../types'

export const GEO_MODULE: ModuleDefinition = {
  type: 'geo',
  name: 'GEO Audit',
  description: 'Generative Engine Optimization — audit how visible and citable your site is to AI engines like ChatGPT, Perplexity, Gemini, and Claude.',
  order: 4,
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
- Be specific about what was found or missing, but explain it in plain English — avoid repeating bot names, schema type names, or file paths in d and n; those belong only in a.
- Actions must be concrete but brief: 1–2 sentences max. Technical file names, bot names, and code snippets go in a only.
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
              label: 'AI guidance file (llms.txt) exists at the domain root',
              prompt: 'Check the pre-computed finding for whether the AI guidance file exists. Explain plainly in d whether it was found or missing. In n explain why having this file helps AI engines understand the site — without using the filename. In a give the exact file path to create.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-llms-h1',
              label: 'Site description heading in AI guidance file',
              prompt: 'Check the pre-computed finding for whether the AI guidance file has a description heading. In d go beyond found/missing — describe what was actually found (quote the heading if present) or explain what the file lacks. In n explain why a missing heading means AI cannot tell what the site is about. In a give the exact syntax to add one.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-llms-blockquote',
              label: 'One-line product summary in AI guidance file',
              prompt: 'Check the pre-computed finding for whether the AI guidance file has a one-line product summary. In d go beyond found/missing — quote the summary if present, or describe what a visitor would need to write as a one-liner for this site. In n explain that without a summary AI engines cannot give brief accurate mentions of the product. In a give the exact format to add one.',
              order: 3,
              weight: 1,
            },
            {
              slug: 'geo-llms-sections',
              label: 'Named content sections in AI guidance file',
              prompt: 'Check the pre-computed finding for whether the AI guidance file has named sections. In d go beyond found/missing — describe what the file actually looks like (e.g. one unsectioned block, or list which sections exist). In n explain that without sections AI cannot match content to specific queries. In a give the exact syntax to add at least two named sections.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'geo-llms-links',
              label: 'Page links in AI guidance file',
              prompt: 'Check the pre-computed finding for whether the AI guidance file contains links to key pages. In d go beyond found/missing — state how many links were found and what pages they point to, or note that the file contains no links at all. In n explain that without links AI cannot navigate to specific content even if it knows the file exists. In a give the exact markdown link format to add.',
              order: 5,
              weight: 2,
            },
            {
              slug: 'geo-llms-depth',
              label: 'AI guidance file depth and coverage',
              prompt: 'Check the pre-computed finding for the link count and section count in the AI guidance file. In d go beyond found/missing — give the exact counts found (e.g. "2 links across 1 section") and what the minimum target is. In n explain that a near-empty file gives AI almost nothing to navigate and hurts citation chances. In a tell them exactly how many links and sections to add to reach a useful threshold.',
              order: 6,
              weight: 1,
            },
            {
              slug: 'geo-discovery-aitxt',
              label: 'AI policy file (ai.txt) is present',
              prompt: 'Check the pre-computed finding for whether the AI policy file exists. In d state plainly whether it was found or missing. In n explain that this file tells AI systems how the site wants to be interacted with and cited. In a give the exact file path to create.',
              order: 7,
              weight: 1,
            },
            {
              slug: 'geo-discovery-summary',
              label: 'AI-readable site summary file exists',
              prompt: 'Check the pre-computed finding for whether an AI-readable site summary file exists. In d state plainly whether it was found. In n explain that this file lets AI understand the product without crawling every page. In a give the exact file path to create.',
              order: 8,
              weight: 1,
            },
            {
              slug: 'geo-discovery-faq',
              label: 'AI-readable FAQ file exists',
              prompt: 'Check the pre-computed finding for whether an AI-readable FAQ file exists. In d state plainly whether it was found. In n explain that a structured FAQ lets AI answer questions about the product directly without guessing from page content. In a give the exact file path to create.',
              order: 9,
              weight: 1,
            },
            {
              slug: 'geo-discovery-service',
              label: 'AI-readable product description file exists',
              prompt: 'Check the pre-computed finding for whether an AI-readable product description file exists. In d state plainly whether it was found. In n explain that this file lets AI accurately describe the product category, pricing, and audience without guessing. In a give the exact file path to create.',
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
              label: 'AI training bots — access status in robots.txt',
              prompt: 'Check the pre-computed robots.txt findings for whether AI training bots are allowed or blocked. In d state plainly how many training bots are blocked vs allowed. In n explain that blocking these bots means the site\'s content is excluded from AI knowledge — without listing bot names. In a name the specific bots to unblock and the exact robots.txt change needed.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-robots-tier2',
              label: 'AI search bots — access status in robots.txt',
              prompt: 'Check the pre-computed robots.txt findings for whether AI search bots are allowed or blocked. In d state plainly how many are blocked vs allowed. In n explain that blocking these bots means the site cannot show up in AI-powered search results like Perplexity or ChatGPT — without listing bot names. In a name the specific bots to unblock and the exact robots.txt change.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'geo-robots-tier3',
              label: 'AI assistant bots — access status in robots.txt',
              prompt: 'Check the pre-computed robots.txt findings for whether AI user bots are allowed or blocked. In d state plainly how many are blocked vs allowed. In n explain that blocking these bots means AI assistants cannot fetch the site when answering a user\'s question in real time — without listing bot names. In a name the specific bots to unblock and the exact robots.txt change.',
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
              label: 'FAQ structured data is added to the page',
              prompt: 'Check the pre-computed schema findings for whether FAQ structured data is present. In d state plainly whether it was found and whether it has actual question and answer content. In n explain that FAQ structured data is the most valuable markup for getting cited in AI answers — without using schema type names. In a give the exact code to add it.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-schema-org',
              label: 'External profile links in company structured data',
              prompt: 'Check the pre-computed schema findings for whether company structured data is present and whether it links to external profiles. In d state plainly whether it was found and whether external profile links are included. In n explain that without these links AI may confuse the brand with similar names — without using schema type names. In a specify which external profiles to link to and give the exact code.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'geo-schema-website',
              label: 'Website structured data is present',
              prompt: 'Check the pre-computed schema findings for whether website structured data is present. In d state plainly whether it was found. In n explain that this markup tells AI the official site name and URL — the foundation for AI knowing the brand exists — without using schema type names. In a give the exact code to add it.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'geo-schema-article',
              label: 'Content structured data on blog posts and articles',
              prompt: 'Check the pre-computed schema findings for whether article structured data is present. In d state plainly whether it was found. In n explain that without it blog posts are treated as generic pages rather than citable sources by AI — without using schema type names. In a give the exact code to add it to a blog post.',
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
              prompt: 'Using your own training knowledge, does this brand have a Wikipedia or similar knowledge base entry? In d state plainly whether you recognise the brand and whether it has a public knowledge entry. In n explain that brands without public knowledge entries are treated as unknown by AI — without mentioning Wikipedia or Wikidata by name. In a tell them to create a Wikipedia article or Wikidata entry.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'geo-entity-sameas-depth',
              label: 'Company profile links to authoritative directories (Wikipedia, Crunchbase)',
              prompt: 'From the pre-computed findings, check whether the company structured data links to authoritative directories. In d state plainly whether high-authority directory links were found or only social profiles. In n explain that social profiles alone are weak — AI uses authoritative directories to confirm a brand is a real established entity. In a list the specific directories to add links to (Wikipedia, Crunchbase, LinkedIn company page).',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-entity-nap',
              label: 'Brand name is spelled consistently across title, headings, and markup',
              prompt: 'From the pre-computed page signals, check whether the brand name is spelled and capitalised consistently across the page title, main heading, and structured data. In d state plainly whether it matches everywhere or where a mismatch was found. In n explain that inconsistent spelling makes AI treat them as different brands. verified=true if consistent everywhere.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'geo-entity-about',
              label: 'About page with brand story linked from site',
              prompt: 'From the page headings, navigation, and body content, check for a link to an About or Company page. In d state plainly whether one was found and referenced. In n explain that an About page with the brand story helps AI build an accurate profile of the business. verified=true if clearly linked.',
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
              label: 'Page language is declared in HTML',
              prompt: 'Check the pre-computed signal for whether a page language declaration was found. In d state plainly whether the language is declared or missing. In n explain that AI uses this to decide whether to cite the page for queries in that language. In a give the exact code to add it.',
              order: 1,
              weight: 1,
            },
            {
              slug: 'geo-signals-modified',
              label: 'Content freshness date is declared',
              prompt: 'Check the pre-computed freshness signals for whether a last-updated date is declared on the page. In d state plainly whether a date was found or the page is undated. In n explain that undated content is assumed stale by AI and ranked below dated competitors. In a give the exact code to declare the date.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'geo-signals-rss',
              label: 'News feed (RSS) is present for content updates',
              prompt: 'Check the pre-computed signal for whether a news feed link was found on the page. In d state plainly whether a feed was found or missing. In n explain that a news feed lets AI crawlers automatically discover new content, keeping the site\'s citations more current. In a give the exact code to add a feed link.',
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
