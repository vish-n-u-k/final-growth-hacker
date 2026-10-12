# AI costs per module

Estimated October 2026 from the code (prompt sizes at ~4 chars per token, outputs ~60–70% of each call's `maxTokens`). Not measured — check `ai_usage_logs` for real numbers (see caveats below).

Prices used: Haiku 4.5 $1 in / $5 out per million tokens; Sonnet 4.6 $3 in / $15 out.

## Cost per module run

| Module | Model | ~Cost per run |
|---|---|---|
| Business Stage | Sonnet | $0.15 |
| Brand Audit | Sonnet (default, 3 calls) | $0.11 |
| Foundation (incl. playbook) | Haiku + Sonnet | $0.10 |
| Meta Ads | Sonnet | $0.10 |
| Competitor Audit | Sonnet (default) | $0.09 |
| Outreach Targets | Sonnet (default) | $0.08 |
| GEO Competitor Gap | Sonnet | $0.08 |
| Audience Discovery | Sonnet (default) | $0.075 |
| Content Audit | Sonnet (default, 3 calls) | $0.075 |
| SEO | Haiku (~7 calls) | $0.055 |
| Social Media | Haiku | $0.04 |
| User Analytics | Haiku | $0.027 |
| Competitor Analysis | Haiku | $0.024 |
| Website | Haiku | $0.02 |
| GEO | Haiku | $0.02 |
| Email Marketing | Haiku | $0.02 |
| Gmail Outreach | Haiku | $0.011 |
| Community Finder, Backlinks | none | $0 |
| Brand-memory calls (`lib/brain`), every run except Foundation | Haiku | ~$0.012 each, ~$0.20 per full suite |

**Full run of every module for one brand: ~$1.28** (likely range $0.80–$2.10).

"Sonnet (default)" means no model is passed, so `callAI` falls back to `claude-sonnet-4-6`.

Business Stage and Meta Ads were moved from Haiku to Sonnet on purpose: Business Stage follows a long rule set across 10 categories in one call, and Meta Ads must quote exact spend and CTR numbers.

## Per-action costs outside modules

| Action | Model | ~Cost each |
|---|---|---|
| Apply fix (`planFix` + `generateFix` in `lib/modules/seo/fix-agent.ts`) | Sonnet | $0.10–0.30, scales with the size of the code files |
| Quick value fixes (title, meta, footer patches) | Haiku | under $0.005 |
| Item draft (`items/draft`) | Sonnet (default) | ~$0.035 |
| Generate blog | Haiku | ~$0.025 |
| Classify for export | Haiku | ~$0.02 |
| Onboarding prefill | Sonnet (default) | ~$0.01 |
| Email, campaign, follow-up, thread summary | Haiku | $0.004–0.008 |
| Reminders, verify, analytics summaries | Haiku | $0.002–0.008 |
| Gmail reply opt-out check | Haiku | ~$0.0005 |

## How cost varies with website size

Barely: a one-page site and a 500-page site differ by ~$0.05–0.10 per full run. The estimates above already assume the current page limits below.

Most modules read only the homepage, truncated to fixed lengths. The ones that read more pages are capped:

- **Content Audit**: up to 30 pages by default (`max_pages`, hard limit 50 in `content-audit/fetcher.ts`). From 30 pages on, per-page body excerpts are dropped (`content-audit/agent.ts`).
- **GEO**: samples 20 sitemap pages for title/meta and lists the first 30 sitemap URLs.
- **Brand Audit**: adds a small, capped sample of page titles/descriptions.
- **Competitor modules**: scale with the number of competitors (~$0.01 each in Competitor Audit; GEO Competitor Gap caps at 3).

Bigger drivers of variance than site size: how many checks fail (failing items get longer AI output), how long the Sonnet outputs run, and Meta Ads account size.

## Known data limits (deliberately left as is)

These limits can make results less accurate on larger sites. They were reviewed and kept for now:

1. **SEO**: title, meta description, H1, image alt and Open Graph checks run on the homepage HTML only (`lib/audit/seo-audit.ts`). The 300 discovered URLs are used only for link and technical checks. These are rule-engine checks, so covering more pages would cost fetch time, not AI tokens.
2. **Content Audit**: 30-page default misses most of a large blog. Raising to 50 with body excerpts kept: ~+$0.04 per run.
3. **Brand Audit**: the fetcher pulls 8,000 chars of homepage copy but the prompt uses only the first 1,000 (`brand-audit/agent.ts`). Sending ~4,000: ~+$0.01 per run.
4. **GEO**: 20 sampled pages is thin for large sites.

## Caveats on `ai_usage_logs`

- `lib/ai/client.ts` prices Haiku at $0.80/$4 (Haiku 3.5 rates). Haiku 4.5 is $1/$5, so logged Haiku costs are ~20% low.
- Calls made with `client.messages.create` directly (fix agent, blog generation, reminders, item verify, analytics routes) bypass `callAI` and are not logged.
- Cache tokens are not counted. The SEO `cachePrefix` is likely below Haiku 4.5's 4,096-token minimum, so it probably doesn't cache at all.
