# Blog SEO loop: idea saved for later

Inspired by a "Claude SEO harness" skill seen on social media: a robot that writes blog posts for your
website and learns from how they perform.

## What it does (simple)

It repeats 3 steps:

1. **Find a topic.** Looks at what people search on Google to find your site and picks a good search
   term to write about (e.g. "best AI tool for Instagram posts").
2. **Write and post it.** Writes a blog post on that topic and puts it on your website by itself
   (if the site runs on WordPress).
3. **Check and learn.** A few weeks later, checks which posts brought visitors. Writes more like the
   ones that worked and fewer like the ones that didn't.

Then it starts again, getting a bit better each round.

## What GrowJin already has

| Step | Status | Where |
|---|---|---|
| Find a topic from Google data | ✅ Done | `web/app/api/blogs/topics/route.ts` (Search Console searches where the site almost ranks; falls back to brand keywords) |
| Write the post | ✅ Done | `web/app/api/blogs/generate/route.ts` (900–1200 words, headings, meta title/description, target keyword) |
| Put it on the site | 🟡 Partly | User hands it to Claude / GitHub; we check it went live (`brand_blogs.verification_status`) |
| See which pages get visitors | 🟡 Partly | Content Audit reads Search Console clicks per page, flags decaying posts → Refresh |
| Weekly rhythm | ✅ Done | Reminders "blog-post" job, auto-ticked when a new post shows up in the sitemap |

## What to build later

1. **"Beat the #1 result" brief (before writing).** Search the keyword via Serper (already integrated),
   read the top 3 results, have Claude note what they cover, their length and what they miss, then
   write a post that covers more. ~1 cent per post, 1–2 days of work. Biggest effect on ranking.
2. **One-click publish to WordPress.** User adds their site URL + a WordPress application password
   (built in, free). We post the blog as a **draft the user approves**, not auto-published.
   Webflow / Ghost / Shopify later if users ask. 2–3 days.
3. **Learning loop.** Track every GrowJin-written post at 2, 4 and 8 weeks (clicks, impressions,
   position from Search Console). Show a "Your posts" scorecard. Feed what worked (topic types,
   formats) back into topic picking and the writing prompt. Posts stuck at positions 6–20 get a
   "refresh this" task. ~1 week.

## Caution

Keep publishing as an approved draft. Google's "scaled content abuse" policy targets sites that
mass-publish unreviewed AI posts; a penalty would hurt users more than slower posting.
