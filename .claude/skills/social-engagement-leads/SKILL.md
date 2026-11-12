---
name: social-engagement-leads
description: Find social accounts and threads a brand should follow, comment on and engage with, based on the brand's own buyers, niche and competitors. Use when asked for engagement leads, accounts to comment on, or warm social prospects for any brand.
---

# Social Engagement Leads

Find the accounts and conversations where a brand's real buyers are active, so the brand can follow, comment and reply in a way that leads to sign-ups or sales. Works for any brand: everything is driven by the brand profile below.

## 1. Build the brand profile first

Pull what you can from the brand's own data (brand info, website, products), then fill gaps by asking the user. Do not start searching without items marked **required**.

| Field | Example (SaaS) | Example (D2C store) | Required |
|---|---|---|---|
| `brand_name` | Frekto | SiddhDhara | yes |
| `what_it_sells` | AI marketing content for small businesses | Ayurvedic wellness products | yes |
| `target_buyer` | small-business owners, solo founders | health-conscious women 25-45 | yes |
| `buyer_problem` | no time to post consistently | joint pain, stress, sleep | yes |
| `region` | India, global English | India | yes |
| `competitors` | Predis, Ocoya, Jasper | Kapiva, Dabur, Himalaya | recommended |
| `exclude` | marketing agencies, freelancers | other sellers, resellers | recommended |
| `platforms` | Instagram, Reddit | Instagram, Reddit, YouTube | default: Instagram + Reddit |

The **buyer type decides everything**:
- **B2B / SaaS brand**: leads are *business owners and founders*. Their own posts and their questions are the targets.
- **B2C / D2C brand**: leads are *consumers with the problem*, plus creators and pages those consumers follow.

## 2. Turn the profile into search inputs

Generate these from the profile; never reuse another brand's list.

- **Intent phrases (Reddit)**: how the buyer would describe `buyer_problem` in their own words. 5-8 phrases, e.g. "what to post on social media for my business", "natural remedy for joint pain".
- **Subreddits**: 5-8 communities where `target_buyer` asks for help. Scope searches inside them; sitewide Reddit search returns mostly noise.
- **Hashtags (Instagram)**: 5-8 tags the *buyer* uses, not tags the brand's industry uses. A SaaS for small businesses uses #smallbusinessowner, #d2cbrand; an Ayurveda brand uses #jointpainrelief, #ayurvedicliving.
- **Hub accounts**: large pages whose comment sections are full of `target_buyer` (news pages, educators, niche creators).
- **Competitor accounts**: their commenters and their 1-3 star reviewers are warm leads.

## 3. Collect

Use the Apify connection. Cap spend per run (`maxTotalChargeUsd`) and tell the user the cost.

| Source | Actor | Input that worked | Notes |
|---|---|---|---|
| Reddit threads | `harshmaur/reddit-scraper` | `startUrls` of subreddit searches: `https://www.reddit.com/r/<sub>/search/?q=<phrase>&restrict_sr=1&sort=new&t=month`, `maxPostsCount: 15` | Keyword search across all of Reddit ignores the keywords with `sort=new`; always scope to subreddits |
| Instagram posts by hashtag | `apify/instagram-hashtag-scraper` | `hashtags: [...]`, `resultsType: "posts"`, `resultsLimit: 20` | Free tier returns only the newest page: good for fresh, low-comment posts |
| Instagram ranked accounts | `coregent/instagram-creator-leads-scraper` | search terms or hashtags with follower/engagement filters | Often blocked by Instagram and returns 0 rows; treat as optional |
| TikTok creators | `coregent/tiktok-influencer-finder` | hashtag or keyword | For B2C brands with a TikTok audience |
| Competitor commenters | Instagram/TikTok comment scrapers on competitor post URLs | competitor's recent post URLs | Best warm leads; needs competitor handles |

## 4. Filter

Drop:
- Agencies, freelancers, consultants and other sellers of what the brand sells (these are competitors, not buyers). Detect from name or bio words: agency, marketing, digital, studio, solutions, services, growth partner.
- Anything matching `exclude`.
- Off-topic, NSFW, job posts, promo spam, crypto/loans.
- Duplicates (same account from several hashtags: keep one row).

Keep, in priority order:
1. **Asking for help now**: posts that describe `buyer_problem` or ask for a tool or recommendation.
2. **Buyers posting their own content**: owners or consumers who match `target_buyer`, active in the last 7 days.
3. **Hub accounts** whose audience is `target_buyer`.
4. **Read-only context**: threads showing objections to the brand's category, and competitors to watch. Mark these Skip.

## 5. Output

One row per lead, as a sheet with a tab per platform, or as the JSON below.

```json
{
  "brand": "<brand_name>",
  "collected_at": "YYYY-MM-DD",
  "leads": [
    {
      "platform": "instagram | reddit | tiktok | x | linkedin",
      "handle_or_title": "@account or thread title",
      "type": "buyer | founder | hub | asking_for_help | context | competitor",
      "niche": "short description",
      "action": "follow + comment | follow + engage | comment regularly | reply in thread | read only",
      "status": "to_do | followed | commented | replied | skip",
      "url": "post or thread link",
      "profile_url": "account link if any",
      "engagement": "comments or likes count",
      "posted_at": "YYYY-MM-DD",
      "notes": "why this lead matters"
    }
  ]
}
```

Status values: Instagram/TikTok use To do, Followed, Commented, Replied, Skip. Reddit/forums use To do, Commented, Replied, Skip.

## 6. Engagement rules (show these to the user with the leads)

- Answer the actual question first. Mention `brand_name` only when someone asks for a tool or recommendation; most subreddits ban promotion.
- On a buyer's post, leave something genuinely useful (an idea, a tip, a better caption), never a pitch or a DM link.
- Check the "read only" threads for the objections people have to this category, and phrase replies to avoid them.
- Prefer fresh posts with few comments: the owner reads every early comment.
- Never automate comments or follows; the brand posts each one by hand from its own account.

## 7. Repeat

Offer to run this daily or weekly as a scheduled task that appends new leads, skipping handles and URLs already in the list.
