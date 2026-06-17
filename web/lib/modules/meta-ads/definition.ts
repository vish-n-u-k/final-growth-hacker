import type { ModuleDefinition } from '../types'

export const META_ADS_MODULE: ModuleDefinition = {
  type: 'meta-ads',
  name: 'Meta Ads Audit',
  description: 'Audit your Meta advertising performance — campaign efficiency, budget allocation, audience fatigue, and conversion optimisation based on live data from your ad account.',
  order: 7,
  unlockThreshold: 0, // Always available — credential-gated, not score-gated
  dynamic: true,
  requirements: [],
  systemPrompt: `You are a senior paid media strategist embedded in a growth audit tool. Your tone is direct, data-driven, and consultant-like.

You receive pre-processed data: real campaign performance metrics fetched from the Meta Marketing API (spend, impressions, clicks, CTR, CPC, CPM, frequency, reach, total conversions, campaign objectives, daily budgets, status).

Rules:
1. Only report what you can verify from the data provided. Never fabricate metrics or benchmarks not in the data.
2. Every finding must cite specific numbers — exact spend, CTR percentages, CPC values, campaign names.
3. Compare metrics against Meta industry benchmarks: average CTR 0.9%, average CPC $1.72, average CPM $14.40, healthy frequency < 3.0, ad fatigue threshold > 5.0.
4. Slug format: {category-slug}-{short-descriptor} e.g. campaign-performance-high-cpc
5. Weight: 3 = directly wastes budget or kills conversions | 2 = measurably hurts performance | 1 = optimisation opportunity
6. verified: true = this check passes or metric is better than benchmark | verified: false = gap or inefficiency exists
7. fixable: false for all items — Meta Ads optimisations happen inside Ads Manager, not on the website
8. All action steps must be specific and executable inside Meta Ads Manager within one week`,
  categories: [
    {
      slug: 'campaign-performance',
      label: 'Campaign Performance',
      order: 1,
      prompt: `Analyse the performance of each campaign over the last 7 days.

For each campaign, assess:
- CTR: above 1.5% = strong | 0.9–1.5% = average | below 0.9% = underperforming
- CPC: below $1.00 = strong | $1.00–$3.00 = average | above $3.00 = expensive
- CPM: below $10 = efficient | $10–$20 = average | above $20 = expensive
- Is spend distributed evenly or concentrated in one campaign?
- Are any high-spend campaigns producing below-average CTR or CPC?
- Which campaign is the top performer and which is the weakest?

Cite exact campaign names, spend amounts, CTR percentages, and CPC values in every finding.

Generate 4–6 findings. Weight 3 for campaigns burning budget with CTR below 0.5%. Weight 2 for below-average metrics. Weight 1 for minor optimisations.`,
    },
    {
      slug: 'budget-efficiency',
      label: 'Budget Efficiency',
      order: 2,
      prompt: `Evaluate how budget is allocated and whether it is being spent efficiently.

Assess:
- Total daily budget across all campaigns (daily_budget in cents ÷ 100 = USD)
- Are paused campaigns holding budget that should be reallocated?
- Is budget concentrated on the lowest-performing campaigns?
- Are any campaigns underspending (spend much less than daily_budget × 7 days)?
- Ratio of active vs paused campaigns — too many paused campaigns signals poor account hygiene
- Is the overall budget proportional to the objectives (e.g. LINK_CLICKS vs LEAD_GENERATION campaigns should have different CPL expectations)

Generate 3–5 findings with exact budget figures and campaign names.`,
    },
    {
      slug: 'audience-reach',
      label: 'Audience & Reach',
      order: 3,
      prompt: `Analyse audience size, reach, and frequency for signs of ad fatigue or audience exhaustion.

Assess:
- Frequency: below 2.0 = fresh | 2.0–3.5 = normal | 3.5–5.0 = getting fatigued | above 5.0 = ad fatigue, immediate action needed
- Reach vs impressions ratio: low reach with high impressions = same people seeing the ad repeatedly
- Are campaigns with high frequency also showing declining CTR? (correlation = confirmation of fatigue)
- Total unique reach across all campaigns — is the brand reaching enough people?
- Are multiple campaigns targeting the same audience (audience overlap risk)?

Generate 3–5 findings. Weight 3 for frequency above 5.0 on any active campaign. Weight 2 for frequency 3.5–5.0. Weight 1 for reach expansion opportunities.`,
    },
    {
      slug: 'conversion-performance',
      label: 'Conversion Performance',
      order: 4,
      prompt: `Evaluate whether campaigns are achieving their stated objectives and generating conversions.

Assess:
- Total conversions (actions) relative to total spend — what is the cost per conversion?
- Are CONVERSIONS or LEAD_GENERATION objective campaigns producing actions? If spend is high and actions are 0, this is critical.
- Are LINK_CLICKS campaigns driving traffic proportional to spend?
- Which campaigns have the best conversion efficiency (lowest cost per action)?
- Campaign objective alignment: is the right objective set for what the business needs?
- If no conversion data is available, note this and assess by objective type and spend efficiency.

Generate 4–5 findings. Weight 3 for high-spend campaigns with zero conversions. Weight 2 for poor conversion rates. Weight 1 for objective misalignment.`,
    },
    {
      slug: 'meta-score',
      label: 'Meta Ads Score',
      order: 5,
      prompt: `Synthesise all findings from the four previous categories into a holistic Meta Ads Score from 0 to 10 (lower is better — 0 is perfect).

Weighting:
- Campaign Performance: 30%
- Budget Efficiency: 25%
- Audience & Reach: 20%
- Conversion Performance: 25%

Score mapping:
- 0–3: Strong — campaigns performing above benchmark, efficient spend, healthy frequency
- 4–6: Average — performing but with clear optimisation opportunities
- 7–8: Weak — significant waste, audience fatigue, or poor conversion rates
- 9–10: Critical — budget burning with minimal return, immediate restructure needed

Generate exactly 2 findings:
1. slug: "meta-score-overall" — the score, which categories are weakest, verified: true if score <= 4 else false, weight based on severity
2. slug: "meta-score-action-plan" — a prioritised 30/60/90 day Meta Ads action plan targeting the weakest areas, verified: false, weight 2

Use only what the data showed — do not invent findings from outside the provided data.`,
    },
  ],
}
