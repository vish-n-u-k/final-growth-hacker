import type { ModuleDefinition } from '../types'

export const AUDIENCE_DISCOVERY_MODULE: ModuleDefinition = {
  relevantFor: ['saas', 'ecommerce', 'agency', 'blog', 'local'],
  type: 'audience-discovery',
  name: 'Audience Discovery',
  tagline: 'find where your customers live',
  description: 'Surfaces the specific communities, directories, creators, and platforms where your ideal customers already spend time.',
  order: 16,
  unlockThreshold: 60,
  dynamic: true,
  requirements: [],
  systemPrompt: `You are a distribution strategist specialising in early-stage growth. Your job is to identify the exact places where a brand's ideal customers already spend time online — specific named directories, communities, creators, and publications.

Rules:
1. Every recommendation must be a real, named platform or community. Never suggest a category — name the specific thing.
2. Every action field must include a specific URL for the exact next step (submission page, group URL, channel page, contact form).
3. Weight calibration: 3 = high-traffic, high-fit channel with strong buyer intent | 2 = medium traffic, good fit | 1 = niche but genuinely relevant.
4. verified: always false. fixable: always false. All items are opportunities to pursue, not completed tasks.
5. Slug format: {category-slug}-{short-platform-name} in kebab-case. Example: online-communities-r-saas, product-directories-product-hunt.
6. The narrative field explains WHO is in that community and WHY they would care about this product specifically.
7. Generate 4–6 items per category. Quality over quantity — 16 great items beats 24 mediocre ones.
8. Tailor everything to the actual product. A B2B SaaS tool and a local bakery need completely different channels.`,
  categories: [
    {
      slug: 'product-directories',
      label: 'Product Directories',
      order: 1,
      prompt: `Identify the specific listing and submission sites where buyers in this product's category actively search for tools or services.

Include:
- The dominant directory for this product type (e.g. Product Hunt, G2, Capterra for SaaS; Clutch for agencies; Google Business/Yelp for local; Etsy for handmade)
- Niche directories relevant to the vertical
- Sites where the brand is likely missing but competitors are listed

For each item, generate:
- label: "Get listed on [directory name]" or "Submit to [directory name]"
- detail: 1 sentence — what this directory is and why buyers in this category use it
- narrative: who searches there and why they would find this product relevant
- action: the exact submission or listing URL plus the key step to take`,
    },
    {
      slug: 'online-communities',
      label: 'Online Communities',
      order: 2,
      prompt: `Identify specific online communities — named subreddits, Discord servers, Slack groups, Facebook Groups, LinkedIn Groups — where the target audience discusses the problems this product solves.

Include only communities that:
- Are publicly accessible (or have a clear join process)
- Have active ongoing discussion (not dead or low-activity)
- Contain the actual buyer persona for this product

For each item, generate:
- label: "Show up in [community name]" or "Engage in [community name]"
- detail: 1 sentence — what community it is, platform, and rough size/activity level
- narrative: exactly who participates there and what they discuss that makes this product relevant
- action: the direct URL to the community plus the recommended way to add value (e.g. answer questions, share case studies, post Show HN)`,
    },
    {
      slug: 'content-creators',
      label: 'Content Creators',
      order: 3,
      prompt: `Identify specific YouTube channels, podcasts, or bloggers whose audience overlaps directly with this product's buyers.

Include:
- YouTubers who make reviews, tutorials, or "best tools" content in this niche
- Podcasters who interview founders or discuss tools used by this audience
- Bloggers or newsletter writers who cover this product's category

For each item, generate:
- label: "Pitch to [creator name / channel name]"
- detail: 1 sentence — what content they make and why their audience matches this product's buyers
- narrative: who watches/listens/reads and why they would respond to this product
- action: the creator's channel/podcast URL plus the specific outreach approach (sponsorship, review request, affiliate pitch, guest post)`,
    },
    {
      slug: 'publications-newsletters',
      label: 'Publications & Newsletters',
      order: 4,
      prompt: `Identify specific industry newsletters, trade publications, and media outlets read by this product's target audience.

Include:
- Named newsletters with relevant readership (e.g. TLDR for developers, Morning Brew for business, The Hustle for entrepreneurs)
- Trade blogs or media publications that cover tools in this vertical
- Newsletters known to feature product launches or tool recommendations

For each item, generate:
- label: "Get featured in [publication name]"
- detail: 1 sentence — what it covers and the size/reach of its readership
- narrative: why this audience would care about this product and what type of feature would resonate
- action: the exact contact or submission URL plus the recommended pitch angle`,
    },
    {
      slug: 'lead-databases',
      label: 'Lead Databases & Prospecting Tools',
      order: 5,
      prompt: `Identify specific lead databases and prospecting tools that contain the ideal customers for this product. These are tools that let the brand pull a targeted list of prospects and reach out directly — bypassing inbound entirely.

Include tools relevant to the buyer type:
- For products targeting ecommerce store owners: Store Leads (storeleads.app), Koala Inspector, Commerce Inspector
- For B2B products targeting businesses broadly: Apollo.io, Hunter.io, Clearbit, ZoomInfo
- For products targeting funded startups or investors: Crunchbase, PitchBook, Dealroom
- For products targeting agencies or service providers: Clutch (clutch.co/directory), DesignRush, Agency Spotter
- For products targeting professionals by title/company: LinkedIn Sales Navigator
- For products targeting Shopify/WooCommerce app users: Shopify App Store reviews (find users of competitor apps), BuiltWith

Only include databases where this product's exact buyer persona actually exists in large numbers. Skip generic databases with poor fit.

For each item, generate:
- label: "Find prospects on [tool name]"
- detail: 1 sentence — what type of leads this database contains and the scale (e.g. "13M+ active ecommerce stores with technographic filters")
- narrative: exactly which segment of that database maps to this product's buyer and why direct outreach here would convert
- action: the direct URL to start a search or trial plus the exact filter combination to use (e.g. "filter by Shopify + US + 10+ products + apparel category")`,
    },
  ],
}
