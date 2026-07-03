import type { ModuleDefinition } from '../types'

export const SEO_MODULE: ModuleDefinition = {
  type: 'seo',
  name: 'SEO Audit',
  description: 'Rule-based SEO audit across meta tags, headings, images, internal links, structured data, and technical performance. Deterministic checks with AI-generated impact narratives.',
  order: 3,
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
  systemPrompt: `You are a senior SEO specialist reviewing rule-engine findings for a website. For each failing check, write 1–2 sentences of specific business impact — why this issue hurts search rankings, click-through rates, or organic traffic for this site. Be concrete and direct.`,
  categories: [
    // ── 1. Meta Tags ──────────────────────────────────────────────────────────
    {
      slug: 'meta-tags',
      label: 'Meta Tags',
      order: 1,
      subCategories: [
        {
          slug: 'title-tag',
          label: 'Title Tag',
          order: 1,
          items: [
            { slug: 'title.present',  label: 'Title tag presence',                    prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'value' },
            { slug: 'title.length',   label: 'Title length (50–60 chars)',             prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'title.keyword',  label: 'Primary keyword in title',              prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'title.unique',   label: 'Title tag uniqueness',                  prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'title.brand',    label: 'Brand name in title',                   prompt: 'Rule engine check.', order: 5, weight: 1, fixable: true, fixType: 'value' },
          ],
        },
        {
          slug: 'meta-description',
          label: 'Meta Description',
          order: 2,
          items: [
            { slug: 'description.present',  label: 'Meta description presence',                        prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'value' },
            { slug: 'description.length',   label: 'Description length (140–155 chars)',              prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'description.keyword',  label: 'Primary keyword in meta description',             prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'description.cta',      label: 'Call-to-action language in description',          prompt: 'Rule engine check.', order: 4, weight: 1, fixable: true, fixType: 'value' },
            { slug: 'description.unique',   label: 'Description uniqueness',                          prompt: 'Rule engine check.', order: 5, weight: 1 },
          ],
        },
        {
          slug: 'canonical-tag',
          label: 'Canonical Tag',
          order: 3,
          items: [
            { slug: 'canonical.present',      label: 'Canonical URL',                                  prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
            { slug: 'canonical.same_domain',  label: 'Canonical same-domain check',                  prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'canonical.self',         label: 'Self-referencing canonical',                    prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'canonical.resolves',     label: 'Canonical URL resolves (HTTP 200)',             prompt: 'Rule engine check.', order: 4, weight: 2 },
          ],
        },
        {
          slug: 'indexability',
          label: 'Indexability',
          order: 4,
          items: [
            { slug: 'robots.noindex', label: 'Indexing not blocked',              prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
          ],
        },
        {
          slug: 'open-graph',
          label: 'Open Graph',
          order: 5,
          items: [
            { slug: 'og.title',       label: 'Social sharing title (og:title)',               prompt: 'Rule engine check.', order: 1, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'og.description', label: 'Social sharing description (og:description)',  prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'og.image',       label: 'Social sharing image (og:image)',              prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true },
            { slug: 'og.url',         label: 'Social sharing URL (og:url)',                  prompt: 'Rule engine check.', order: 4, weight: 1, fixable: true, fixType: 'template' },
            { slug: 'og.type',        label: 'Social sharing type (og:type)',                prompt: 'Rule engine check.', order: 5, weight: 1, fixable: true, fixType: 'template' },
          ],
        },
      ],
    },

    // ── 2. Headings ───────────────────────────────────────────────────────────
    {
      slug: 'headings',
      label: 'Headings',
      order: 2,
      subCategories: [
        {
          slug: 'h1-tag',
          label: 'H1 Tag',
          order: 1,
          items: [
            { slug: 'h1.exists',       label: 'H1 heading presence',                         prompt: 'Rule engine check.', order: 1, weight: 3 },
            { slug: 'h1.single',       label: 'Single H1 on page',                          prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'h1.keyword',      label: 'H1 and title topic alignment',                prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'h1.length',       label: 'H1 length (20–70 chars)',                     prompt: 'Rule engine check.', order: 4, weight: 1 },
            { slug: 'h1.title_match',  label: 'H1 and title wording',                        prompt: 'Rule engine check.', order: 5, weight: 1 },
          ],
        },
        {
          slug: 'heading-hierarchy',
          label: 'Heading Hierarchy',
          order: 2,
          items: [
            { slug: 'hierarchy.skipped',     label: 'Heading level order (no skips)',          prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'hierarchy.h2_exists',   label: 'H2 heading structure',                   prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'hierarchy.descriptive', label: 'Descriptive heading text',               prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'hierarchy.nesting',     label: 'Heading nesting logic',                  prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'content-outline',
          label: 'Content Outline',
          order: 3,
          items: [
            { slug: 'outline.coverage',       label: 'Subtopic coverage in headings',                    prompt: 'Rule engine check.', order: 1, weight: 1 },
            { slug: 'outline.questions',      label: 'Question-based headings',                          prompt: 'Rule engine check.', order: 2, weight: 1 },
            { slug: 'outline.lsi',            label: 'Related topic words in headings',                  prompt: 'Rule engine check.', order: 3, weight: 1 },
            { slug: 'outline.length_balance', label: 'Heading length (under 120 chars)',                 prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
      ],
    },

    // ── 3. Images ─────────────────────────────────────────────────────────────
    {
      slug: 'images',
      label: 'Images',
      order: 3,
      subCategories: [
        {
          slug: 'alt-text',
          label: 'Alt Text',
          order: 1,
          items: [
            { slug: 'alt.present',          label: 'Alt attributes on images',                         prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
            { slug: 'alt.not_empty',        label: 'Descriptive alt text on content images',           prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'patch' },
            { slug: 'alt.decorative',       label: 'Empty alt on decorative images',                   prompt: 'Rule engine check.', order: 3, weight: 1 },
            { slug: 'alt.filename',         label: 'Alt text format (no filenames)',                    prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'alt.descriptive',      label: 'Alt text accuracy',                                prompt: 'Rule engine check.', order: 5, weight: 1 },
            { slug: 'alt.length',           label: 'Alt text length (5–125 chars)',                    prompt: 'Rule engine check.', order: 6, weight: 1 },
            { slug: 'alt.keyword_stuffing', label: 'Alt text keyword stuffing',                        prompt: 'Rule engine check.', order: 7, weight: 2 },
            { slug: 'alt.context',          label: 'Alt text context',                                 prompt: 'Rule engine check.', order: 8, weight: 1 },
          ],
        },
        {
          slug: 'image-assets',
          label: 'Image Assets',
          order: 2,
          items: [
            { slug: 'image.filesize',   label: 'Image file size (under 500KB)',                prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'image.dimensions', label: 'Image dimension attributes',                  prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true },
            { slug: 'image.lazyload',   label: 'Lazy loading on below-fold images',           prompt: 'Rule engine check.', order: 3, weight: 1, fixable: true, fixType: 'template' },
            { slug: 'image.format',     label: 'Image format (WebP/AVIF)',                    prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
      ],
    },

    // ── 4. Internal Links ─────────────────────────────────────────────────────
    {
      slug: 'internal-links',
      label: 'Internal Links',
      order: 4,
      subCategories: [
        {
          slug: 'link-structure',
          label: 'Link Structure',
          order: 1,
          items: [
            { slug: 'links.orphan',         label: 'Orphan pages check',                       prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'links.depth',          label: 'Page depth (within 3 clicks)',             prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'links.homepage_links', label: 'Internal links on homepage',               prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'links.broken',         label: 'Broken internal links',                    prompt: 'Rule engine check.', order: 4, weight: 3 },
          ],
        },
        {
          slug: 'anchor-text',
          label: 'Anchor Text',
          order: 2,
          items: [
            { slug: 'anchor.diversity',    label: 'Anchor text diversity',                     prompt: 'Rule engine check.', order: 1, weight: 1 },
            { slug: 'anchor.descriptive',  label: 'Descriptive anchor text',                  prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'anchor.exact_match',  label: 'Exact-match anchor usage',                 prompt: 'Rule engine check.', order: 3, weight: 1 },
            { slug: 'anchor.branded',      label: 'Brand name in anchor text',                prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'page-authority',
          label: 'Page Authority Flow',
          order: 3,
          items: [
            { slug: 'pagerank.deep',        label: 'Internal links to deep pages',              prompt: 'Rule engine check.', order: 1, weight: 1 },
            { slug: 'pagerank.nav',         label: 'Navigation page coverage',                  prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'pagerank.contextual',  label: 'Contextual internal links',                 prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'pagerank.injection',   label: 'Internal link injection plan',              prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
      ],
    },

    // ── 5. Schema ─────────────────────────────────────────────────────────────
    {
      slug: 'schema',
      label: 'Schema & Rich Results',
      order: 5,
      subCategories: [
        {
          slug: 'structured-data',
          label: 'Structured Data',
          order: 1,
          items: [
            { slug: 'schema.present',          label: 'Structured data presence',                          prompt: 'Rule engine check.', order: 1, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'schema.valid',            label: 'Structured data validity',                          prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'schema.type',             label: 'Structured data type match',                        prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'schema.required-fields',  label: 'Required structured data fields',                   prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'schema.twitter-card',     label: 'Twitter/X Card tags',                               prompt: 'Rule engine check.', order: 5, weight: 1, fixable: true, fixType: 'template' },
          ],
        },
      ],
    },

    // ── 7. Link Building ──────────────────────────────────────────────────────
    {
      slug: 'link-building',
      label: 'Link Building',
      order: 7,
      subCategories: [
        {
          slug: 'lb-directories',
          label: 'Directories & Aggregators',
          order: 1,
          items: [
            { slug: 'lb-product-hunt',   label: 'Submit to Product Hunt',                  prompt: 'Generate specific submission advice for Product Hunt. Include what to prepare (tagline under 60 chars, a short description, screenshots/GIF, first comment strategy) and when to launch (Tuesday–Thursday). Submission URL: https://www.producthunt.com/posts/new', order: 1, weight: 2 },
            { slug: 'lb-futurepedia',    label: 'List on Futurepedia',                     prompt: 'Generate specific advice for getting listed on Futurepedia, one of the largest AI tool directories. Include what category this product fits, what description to write, and the submission URL: https://www.futurepedia.io/submit-tool', order: 2, weight: 2 },
            { slug: 'lb-theresanai',     label: "Submit to There's An AI For That",        prompt: "Generate specific advice for submitting to There's An AI For That (theresanaiforthat.com). Include what use-case tags to select, how to write the description, and the submission URL: https://theresanaiforthat.com/submit/", order: 3, weight: 2 },
            { slug: 'lb-alternativeto',  label: 'Create AlternativeTo listing',            prompt: 'Generate specific advice for creating a listing on AlternativeTo. Include which competitors to list this product as an alternative to, how to write the description, and the URL: https://alternativeto.net/software/add/', order: 4, weight: 1 },
            { slug: 'lb-saashub',        label: 'List on SaaSHub',                         prompt: 'Generate specific advice for getting listed on SaaSHub. Include how to position the product, what category fits, and the submission URL: https://www.saashub.com/add-service', order: 5, weight: 1 },
            { slug: 'lb-toolify',        label: 'Submit to Toolify.ai',                   prompt: 'Generate specific advice for submitting to Toolify.ai. Include what description and tags to use, and the submission URL: https://www.toolify.ai/submit', order: 6, weight: 1 },
          ],
        },
        {
          slug: 'lb-review-platforms',
          label: 'Review Platforms',
          order: 2,
          items: [
            { slug: 'lb-g2',          label: 'Create a G2 listing',          prompt: 'Generate specific advice for creating a product listing on G2. Include what category to list under, what profile information is required, how to get the first 5 reviews quickly (e.g. ask beta users or team), and the URL to get started: https://sell.g2.com/free-listing', order: 1, weight: 2 },
            { slug: 'lb-capterra',    label: 'Create a Capterra listing',    prompt: 'Generate specific advice for submitting to Capterra. Include what software category fits, what information Capterra requires for approval, and the submission URL: https://www.capterra.com/vendors/sign-up', order: 2, weight: 2 },
            { slug: 'lb-trustpilot',  label: 'Set up a Trustpilot profile',  prompt: 'Generate specific advice for setting up a Trustpilot business profile. Include how to claim the profile, how to get the first reviews, and the URL: https://business.trustpilot.com/', order: 3, weight: 1 },
          ],
        },
        {
          slug: 'lb-communities',
          label: 'Communities',
          order: 3,
          items: [
            { slug: 'lb-hacker-news',    label: 'Submit a Show HN post',          prompt: 'Generate a specific Show HN post strategy for this product. Include the ideal title format, what to write in the first comment, best time to post (weekday mornings US Eastern), and the submission URL: https://news.ycombinator.com/submit', order: 1, weight: 2 },
            { slug: 'lb-indie-hackers',  label: 'Share on Indie Hackers',         prompt: 'Generate specific advice for sharing this product on Indie Hackers. Include whether to post in the product showcase, what angle resonates with the IH community (building in public, metrics, story), and the URL: https://www.indiehackers.com/products/new', order: 2, weight: 1 },
            { slug: 'lb-reddit',         label: 'Post in relevant subreddits',    prompt: 'Generate 3 specific subreddits that are a good fit for this product. For each, name the subreddit, its rules around self-promotion, and the right post format (e.g. "I built X" vs "tool recommendation thread"). Be specific to this product category.', order: 3, weight: 1 },
          ],
        },
        {
          slug: 'lb-press',
          label: 'Press & Media',
          order: 4,
          items: [
            { slug: 'lb-bens-bites',    label: "Pitch to Ben's Bites newsletter",   prompt: "Generate a specific pitch strategy for Ben's Bites, a high-traffic AI newsletter. Include the pitch angle, ideal length (under 100 words), what they look for in new tools, and the submission URL: https://www.bensbites.com/submit", order: 1, weight: 2 },
            { slug: 'lb-tldr-ai',       label: 'Pitch to TLDR AI newsletter',       prompt: 'Generate a specific pitch strategy for TLDR AI newsletter. Include what story angle works, pitch format, and the submission URL: https://tldr.tech/ai/sponsor', order: 2, weight: 1 },
            { slug: 'lb-youtube',       label: 'Reach out to YouTube tool reviewers', prompt: 'Generate a specific outreach strategy for YouTube channels that review AI/SaaS tools. Name 2-3 specific channels relevant to this product category, what to offer (free access, affiliate), and a short email pitch template.', order: 3, weight: 1 },
          ],
        },
      ],
    },

    // ── 8. Keyword Research ───────────────────────────────────────────────────
    {
      slug: 'keyword-research',
      label: 'Keyword Research',
      order: 8,
      subCategories: [
        {
          slug: 'kw-discovery',
          label: 'Keyword Discovery',
          order: 1,
          description: 'Data needed: your page title, H1, meta description, URL slug, H2/H3 headings, and body text — all fetched automatically from your website. No setup required.',
          items: [
            { slug: 'kw-primary', label: 'Primary target keyword', prompt: 'Analyse the page title, H1, and meta description. Is there a clear primary keyword this page is optimised for? State what it appears to be and whether it is specific enough to rank for (not overly generic). If missing or unclear, explain why that hurts rankings.', order: 1, weight: 2 },
            { slug: 'kw-secondary', label: 'Secondary and long-tail keywords', prompt: 'Scan the H2s, H3s, and body text. Are there secondary and long-tail keyword variations that support the primary keyword? List the top 3–5 you can identify. If absent or thin, name the long-tail variations that would be most valuable to add.', order: 2, weight: 1 },
            { slug: 'kw-lsi', label: 'Related topic words in content', prompt: 'Review the body content. Are there semantically related terms (LSI keywords) that signal topic depth to search engines? For example, if the primary keyword is "project management tool", related terms like "task tracking", "team collaboration", "deadlines" should appear. Give 2–3 examples found or missing.', order: 3, weight: 1 },
            { slug: 'kw-url-slug', label: 'Primary keyword in URL slug', prompt: 'Check the URL path provided. Does the slug contain the primary keyword or a close variant? If it is the homepage (no slug), check whether the domain name itself contains a keyword signal. If the slug is generic, a brand name only, or missing entirely, explain the missed SEO opportunity.', order: 4, weight: 1 },
            { slug: 'kw-heading-longtail', label: 'Long-tail keywords in H2/H3 headings', prompt: 'Review the H2 and H3 headings. Are they used to target long-tail variants of the primary keyword — phrased as specific questions, use cases, or qualifier combinations — rather than just generic section titles? List 2–3 headings found and state whether they carry keyword value or are wasted as keyword opportunities.', order: 5, weight: 1 },
          ],
        },
        {
          slug: 'kw-intent',
          label: 'Intent & Targeting',
          order: 2,
          description: 'Data needed: your page copy, headings, and body text — fetched automatically. No setup required.',
          items: [
            { slug: 'kw-intent-match', label: 'Keyword intent match', prompt: 'Assess the search intent (informational / navigational / commercial / transactional) implied by the primary keyword versus the actual content of the page. Is there a mismatch? E.g. the keyword implies an informational query but the page is a hard sales pitch, or vice versa. State the intent type detected and your verdict.', order: 1, weight: 2 },
            { slug: 'kw-commercial', label: 'Commercial intent terms', prompt: 'Check whether conversion-oriented terms like "pricing", "free trial", "sign up", "get started", "compare", "vs", "review", "best", or similar commercial-intent language appears naturally in the page copy. For SaaS and AI tools these terms help capture bottom-of-funnel search traffic. State what is present and what key terms are missing.', order: 2, weight: 1 },
            { slug: 'kw-tofu-bofu', label: 'Awareness vs decision-stage content balance', prompt: 'Check whether the page content serves both top-of-funnel visitors (those learning about the problem — "what is", "how does", educational language) and bottom-of-funnel visitors (those ready to act — pricing, comparison, free trial, signup). A homepage or landing page that only does one risks missing half the funnel. State what stage the page primarily serves and what is missing for the other stage.', order: 3, weight: 1 },
            { slug: 'kw-questions', label: 'Question-based keywords in content', prompt: 'Scan the headings and body text for content that answers specific user questions — phrased as "how to", "what is", "why does", "can I", "when should" etc. These formats capture featured snippet positions and People Also Ask boxes on Google. List any question-format content found. If absent, suggest 2–3 specific questions this product should be answering based on the page topic.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'kw-gaps',
          label: 'Topic Gaps',
          order: 3,
          requires: ['gsc_api'],
          description: 'Data needed: Google Autocomplete suggestions run automatically (no setup). For real ranking gap data, connect Google Search Console API in Settings → Integrations — without it, gaps are inferred from page content only.',
          items: [
            { slug: 'kw-topic-gaps', label: 'Keyword topic gaps', prompt: 'Using the Autocomplete suggestions and GSC top queries provided (if any), identify 3–5 high-value keyword topics this site should be targeting but shows little or no evidence of on the page. Prioritise gaps that appear in Autocomplete suggestions or have GSC impressions but zero clicks. Name the actual keyword phrases — not generic categories.', order: 1, weight: 2 },
          ],
        },
        {
          slug: 'kw-longtail',
          label: 'Long-tail Opportunities',
          order: 4,
          description: 'Data needed: Google Autocomplete — fetches use-case, comparison, question, and modifier keyword variants automatically on every analysis. No setup required.',
          items: [
            { slug: 'kw-longtail-usecase', label: '"X for Y" use-case keywords', prompt: 'Using the use-case autocomplete suggestions provided, assess whether the page targets "X for Y" style keywords (e.g. "project management tool for startups", "AI writer for bloggers"). These long-tail variants convert better because they match specific buyer intent. List any found on the page and name the top 3 use-case variants missing that this product should target.', order: 1, weight: 1 },
            { slug: 'kw-longtail-comparison', label: 'Comparison and alternative keywords', prompt: 'Using the comparison autocomplete suggestions provided, assess whether the page addresses comparison and alternative searches (e.g. "vs competitor", "alternative to X", "X or Y"). These capture high-intent bottom-of-funnel traffic from buyers evaluating options. State which comparison keywords are addressed on the page and name the top 3 missing — use the actual competitor or alternative names from the suggestions.', order: 2, weight: 2 },
            { slug: 'kw-longtail-questions', label: 'Question-based long-tail keywords', prompt: 'Using the question autocomplete suggestions provided and the page content, assess whether the site targets question-based keywords ("how to", "what is", "why use", "when should"). These capture informational traffic and featured snippet positions. List any question-format content found on the page and name the top 3 specific questions this product should create content around — use the actual suggestions provided.', order: 3, weight: 2 },
            { slug: 'kw-longtail-modifiers', label: 'Modifier keywords (best, free, top)', prompt: 'Using the modifier autocomplete suggestions provided, assess whether the page uses high-value modifier keywords ("best", "free", "top", "2025", "cheap", "easy"). These modifiers match specific high-intent searches. State which modifiers appear in the content and name the 3 highest-value modifier combinations missing from the suggestions.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'kw-ranking',
          label: 'Ranking Performance',
          order: 5,
          requires: ['gsc_api'],
          description: 'Data needed: Google Search Console API — requires setup. Go to Settings → Integrations → Google Search Console API, add your Service Account email and private key from your Google Cloud JSON key file, then add that service account email as a User in your GSC property. Without this, all three items will prompt you to connect.',
          items: [
            { slug: 'gsc-top-queries', label: 'Top organic queries (GSC)', prompt: 'Using the GSC top queries data provided, summarise the top keyword themes driving impressions. State whether branded or non-branded terms dominate, what this reveals about current search visibility, and what the top opportunity is. If GSC data is not available, explain that connecting the GSC API in Settings → Integrations will unlock this insight.', order: 1, weight: 2 },
            { slug: 'gsc-quick-wins', label: 'Quick win keywords (positions 4–20)', prompt: 'Using the GSC quick win keywords provided (positions 4–20), identify the top 3 best opportunities where a focused on-page optimisation could push the ranking onto page 1. For each, state the query, current position, and what specific change would likely move it up. If no quick win data is available, explain that connecting the GSC API in Settings → Integrations will unlock this.', order: 2, weight: 3 },
            { slug: 'gsc-low-ctr', label: 'High impression, low CTR keywords', prompt: 'Using the GSC low CTR keywords provided (high impressions but low click-through rate), identify the top opportunities where improving the title tag or meta description would increase clicks without needing to rank higher. For each, suggest a specific improvement. If no CTR data is available, explain that connecting the GSC API in Settings → Integrations will unlock this.', order: 3, weight: 2 },
          ],
        },
        {
          slug: 'kw-coverage',
          label: 'Topic Coverage',
          order: 6,
          requires: ['serpapi'],
          description: 'Data needed: page headings and internal links (automatic). For People Also Ask questions, connect SerpAPI in Settings → Integrations (free tier: 100 searches/month). Google Trends runs automatically. Without SerpAPI, the common user questions item uses AI reasoning only.',
          items: [
            { slug: 'kw-core-topics', label: 'Core topic sub-sections', prompt: 'Using the page headings, body content, and Autocomplete suggestions provided, assess whether this page covers the core sub-topics a visitor would expect for this keyword. List which sub-topics are covered and identify 2–3 important ones missing. Be specific to the product category — not generic.', order: 1, weight: 2 },
            { slug: 'kw-user-questions', label: 'Common user questions in content', prompt: 'Using the People Also Ask questions provided (if any) and the page headings and body, assess whether the page directly answers the questions users most commonly search about this product or topic. List which questions are addressed and name the top 3 missing questions the page should answer to capture featured snippet positions.', order: 2, weight: 2 },
            { slug: 'kw-related-links', label: 'Internal links to related topics', prompt: 'Review the internal link anchor texts provided. Are related topics and sub-pages adequately linked from this page? Good internal linking to related content signals topic authority to search engines. State whether the internal linking is adequate or sparse, and suggest 2–3 specific pages or topics that should be created and linked.', order: 3, weight: 1 },
            { slug: 'kw-topic-trends', label: 'Topic trend direction', prompt: 'Using the Google Trends interest score provided (if any) and the Autocomplete suggestions, assess whether this topic is growing, stable, or declining in search interest. Are there adjacent or emerging keyword areas visible in the suggestions that are worth targeting? Give a specific recommendation on whether to double down on this topic or diversify.', order: 4, weight: 1 },
          ],
        },
      ],
    },

    // ── 6. Technical ──────────────────────────────────────────────────────────
    {
      slug: 'technical',
      label: 'Technical SEO',
      order: 6,
      subCategories: [
        {
          slug: 'core-web-vitals',
          label: 'Core Web Vitals',
          order: 1,
          items: [
            { slug: 'cwv.lcp',         label: 'LCP (Largest Contentful Paint)',               prompt: 'Rule engine check.', order: 1, weight: 3 },
            { slug: 'cwv.cls',         label: 'CLS (layout stability)',                        prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'cwv.fid',         label: 'TBT (interaction speed)',                       prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'lighthouse.score', label: 'Lighthouse performance score',                 prompt: 'Rule engine check.', order: 4, weight: 2 },
          ],
        },
        {
          slug: 'security',
          label: 'Security',
          order: 2,
          items: [
            { slug: 'https.enforced',  label: 'HTTP to HTTPS redirect',           prompt: 'Rule engine check.', order: 1, weight: 3 },
            { slug: 'https.ssl_valid', label: 'SSL certificate validity',         prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'https.hsts',      label: 'HSTS header',                      prompt: 'Rule engine check.', order: 3, weight: 2 },
          ],
        },
        {
          slug: 'mobile-readiness',
          label: 'Mobile Readiness',
          order: 3,
          items: [
            { slug: 'mobile.viewport', label: 'Mobile viewport tag',                   prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
          ],
        },
        {
          slug: 'crawlability',
          label: 'Crawlability',
          order: 4,
          items: [
            { slug: 'robots.exists',   label: 'robots.txt accessibility',              prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'robots.no_block', label: 'robots.txt CSS/JS rules',               prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'sitemap.exists',  label: 'sitemap.xml accessibility',             prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'sitemap.valid',   label: 'Sitemap URL validity',                  prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'http-errors',
          label: 'HTTP Errors',
          order: 5,
          items: [
            { slug: 'http.4xx', label: '4xx errors in links',               prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'http.5xx', label: 'Server errors (5xx)',               prompt: 'Rule engine check.', order: 2, weight: 3 },
          ],
        },
        {
          slug: 'performance',
          label: 'Performance',
          order: 6,
          items: [
            { slug: 'perf.render_blocking', label: 'Render-blocking scripts',                       prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'perf.images',          label: 'Responsive images (srcset)',                    prompt: 'Rule engine check.', order: 2, weight: 1 },
            { slug: 'perf.js_size',         label: 'JavaScript bundle size',                        prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'perf.ttfb',            label: 'Server TTFB (under 200ms)',                     prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'perf.root_cause',      label: 'Performance bottlenecks',                       prompt: 'Rule engine check.', order: 5, weight: 1 },
          ],
        },
      ],
    },
  ],
}
