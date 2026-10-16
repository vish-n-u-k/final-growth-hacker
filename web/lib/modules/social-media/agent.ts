import { callAI } from '@/lib/ai/client'
import { SOCIAL_MEDIA_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import { PLATFORM_NAME, type SocialMediaFetchResult, type SocialPlatformData, type SocialProvider } from './fetcher'
import { domainWord } from '../geo/fetcher'
import { blockedSkipText } from '@/lib/audit/blocked'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// Social Media: the facts (website links, profile links, handles, posting and engagement from
// connected accounts) are fixed rule checks with stable slugs, so ticks and the score stay put
// between runs. Claude only writes the ideas (content strategy, playbook, post suggestions),
// which are shown as ideas and never scored.

type Result = DynamicModuleAnalysisResult

const r = (category: string, slug: string, weight: 1 | 2 | 3, label: string, verified: boolean, detail: string, highlight: string, narrative: string, action: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight, verified, detail, highlight, narrative, action, fixable: false })

/** "Couldn't check": shown as Not checked and left out of the score. */
const skip = (category: string, slug: string, label: string, detail: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight: 1, verified: false, detail, narrative: '', action: '', fixable: false })

const names = (list: string[]) => list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
const nm = (p: SocialProvider) => PLATFORM_NAME[p]
const daysSince = (d: string) => Math.floor((Date.now() - Date.parse(d)) / 86_400_000)
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const SHELL_SKIP = 'Couldn\'t check: your homepage builds its content with JavaScript, so its social links aren\'t in the HTML we (and search engines) read.'

// Engagement benchmarks: [below this is low, at or above this is good] (% per post)
const ENGAGEMENT: Partial<Record<SocialProvider, [number, number]>> = {
  instagram: [1, 3], facebook: [0.5, 1], linkedin: [1, 2], tiktok: [3, 5], twitter: [0.5, 1], youtube: [1, 3],
}

export function buildSocialRuleResults(data: SocialMediaFetchResult): Result[] {
  const out: Result[] = []
  const known = data.platforms.filter(p => p.profileUrl)
  const linked = data.socialLinksOnWebsite.map(l => l.platform)

  // ── Website ──
  const W = 'website-detection'
  if (linked.length > 0) {
    out.push(r(W, 'links', 3, 'Your website links to your social profiles', true,
      `Your homepage links to **${names(linked.map(nm))}**.`, `Links to ${linked.length} social profile${linked.length > 1 ? 's' : ''}`,
      'Visitors can follow you, and search engines and AI can connect your site to your profiles.', ''))
  } else if (data.homepageBlocked) {
    out.push(skip(W, 'links', 'Your website links to your social profiles', blockedSkipText(data.homepageBlocked)))
  } else if (data.homepageIsJsShell) {
    out.push(skip(W, 'links', 'Your website links to your social profiles', SHELL_SKIP))
  } else if (!data.homepageLoaded) {
    out.push(skip(W, 'links', 'Your website links to your social profiles', 'Couldn\'t check: your homepage didn\'t load for our checker this time. Re-analyse to try again.'))
  } else {
    out.push(r(W, 'links', 3, 'Your website links to your social profiles', false,
      '**No social profile links** found on your homepage (header, footer or anywhere on the page).', 'No social links on your website',
      '**Visitors who like you have no way to follow you**, and search engines can\'t tie your profiles to your site.',
      known.length
        ? `Add icon links to ${names(known.map(p => nm(p.platform)))} in your site footer.`
        : 'Add icon links to your social profiles in your site footer.'))
  }

  // Profiles you have (from setup, Settings or a connected account) that the website doesn't link
  const elsewhere = known.filter(p => p.source !== 'website')
  const missing = elsewhere.filter(p => !p.onWebsite)
  if (data.homepageBlocked) {
    out.push(skip(W, 'missing-links', 'Every profile you have is linked from your website', blockedSkipText(data.homepageBlocked)))
  } else if (data.homepageIsJsShell && linked.length === 0) {
    out.push(skip(W, 'missing-links', 'Every profile you have is linked from your website', SHELL_SKIP))
  } else if (elsewhere.length === 0) {
    out.push(skip(W, 'missing-links', 'Every profile you have is linked from your website',
      'Couldn\'t check: we only know the profiles your website already links to. Add your other profile URLs in this module\'s setup (or Settings → Integrations → Social profiles) to check none are missing.'))
  } else if (missing.length > 0) {
    out.push(r(W, 'missing-links', 2, 'Every profile you have is linked from your website', false,
      `Your website doesn't link to your **${names(missing.map(p => nm(p.platform)))}** profile${missing.length > 1 ? 's' : ''}.`, `${missing.length} profile${missing.length > 1 ? 's' : ''} not linked`,
      '**Followers you could win from your website go nowhere** on those platforms.',
      `Add links in your site footer: ${missing.map(p => p.profileUrl).join(', ')}.`))
  } else {
    out.push(r(W, 'missing-links', 2, 'Every profile you have is linked from your website', true,
      `Every profile we know about (${names(elsewhere.map(p => nm(p.platform)))}) is linked from your homepage.`, 'All your profiles are linked', 'Visitors can find you on every platform you use.', ''))
  }

  // ── Profiles ──
  const P = 'profile-analysis'
  if (known.length === 0) {
    out.push(skip(P, 'profiles', 'Your social profiles',
      'Couldn\'t check: we found no social profiles — none in setup, none linked from your website, none connected. Add your profile URLs in this module\'s setup.'))
  }
  for (const p of known) {
    const label = `${nm(p.platform)} profile link works`
    const from = p.source === 'website' ? ' (linked from your website)' : ''
    if (p.link === 'broken') {
      out.push(r(P, `link-${p.platform}`, 2, label, false,
        `**${p.profileUrl}**${from} shows "page not found" (error ${p.linkStatus}).`, `${nm(p.platform)} link is broken`,
        '**People who click it land on an error page** — the account may be renamed or deleted.',
        `Open ${p.profileUrl}; if the account was renamed, update the link${p.source === 'website' ? ' on your website' : ' in setup'}.`))
    } else if (p.link === 'ok') {
      out.push(r(P, `link-${p.platform}`, 2, label, true,
        `**${p.profileUrl}**${from} opens normally${p.publicTitle ? ` ("${p.publicTitle.slice(0, 80)}")` : ''}.`, `${nm(p.platform)} link opens`,
        'Visitors who click it reach your profile.', ''))
    } else {
      out.push(skip(P, `link-${p.platform}`, label,
        p.linkStatus === null
          ? `Couldn't check: ${nm(p.platform)} didn't answer when our checker opened ${p.profileUrl}. Re-analyse to try again.`
          : `Couldn't check: ${nm(p.platform)} didn't let our checker open ${p.profileUrl} (it answered ${p.linkStatus}) — it often asks visitors to log in first.`))
    }
  }

  // Handles vs brand name
  const brand = data.brandName.trim() || domainWord(data.websiteUrl)
  const handles = known.filter(p => p.handle).map(p => ({ platform: p.platform, handle: p.handle! }))
  if (handles.length === 0 || !brand) {
    if (known.length > 0) out.push(skip(P, 'handles', 'Your handles match your brand name',
      handles.length === 0 ? 'Couldn\'t check: your profile links don\'t include a readable handle (e.g. facebook.com/profile.php?id=…).' : 'Couldn\'t check: add your brand name in Settings.'))
  } else {
    const b = norm(brand)
    const fits = (h: string) => { const n = norm(h); return n === b || n.includes(b) || (b.includes(n) && n.length >= Math.max(3, b.length * 0.6)) }
    const off = handles.filter(h => !fits(h.handle))
    const variants = [...new Set(handles.map(h => norm(h.handle)))].length
    out.push(off.length === 0
      ? r(P, 'handles', 2, 'Your handles match your brand name', true,
          `${handles.map(h => `${nm(h.platform)} **@${h.handle}**`).join(', ')} — ${handles.length === 1 ? 'matches' : variants > 1 ? 'slightly different, but all clearly' : 'all'} "${brand}".`,
          variants > 1 ? 'Handles match, with small variations' : 'Same handle everywhere',
          'People searching for your brand find the right accounts.', variants > 1 ? 'If you can, use one identical handle on every platform so people can guess it.' : '')
      : r(P, 'handles', 2, 'Your handles match your brand name', false,
          `${off.map(h => `${nm(h.platform)} **@${h.handle}**`).join(', ')} ${off.length > 1 ? 'don\'t' : 'doesn\'t'} look like "${brand}".`,
          `${off.length} handle${off.length > 1 ? 's' : ''} don't match your brand`,
          '**People searching for your brand may not find or trust these accounts.**',
          `Rename ${off.length > 1 ? 'them' : 'it'} to match "${brand}" where the name is free (e.g. @${b}).`))
  }

  // ── Connected accounts ──
  const M = 'metrics-analysis'
  let anyData = false
  for (const p of data.platforms) {
    const m = p.metrics
    if (m?.fetchError) {
      out.push(skip(M, `${p.platform}-connection`, `${nm(p.platform)} account`,
        `Couldn't check: ${nm(p.platform)} rejected the saved connection (${m.fetchError.slice(0, 140)}). Reconnect it in Settings → Integrations.`))
      continue
    }
    const lastPost = m?.lastPostDate ?? p.publicLastPostDate
    if (m || lastPost) anyData = true
    const followers = m?.followerCount != null ? ` · ${m.followerCount.toLocaleString()} followers` : ''

    // Posting
    if (lastPost) {
      const d = daysSince(lastPost)
      const rate = m?.postsPerWeek != null ? `, about ${m.postsPerWeek} posts a week` : ''
      out.push(d <= 14
        ? r(M, `${p.platform}-active`, 3, `Posting regularly on ${nm(p.platform)}`, true,
            `Last ${nm(p.platform)} post **${d} day${d === 1 ? '' : 's'} ago**${rate}${followers}.`, `Active on ${nm(p.platform)}`, 'Regular posting keeps you in your followers\' feeds.', '')
        : r(M, `${p.platform}-active`, 3, `Posting regularly on ${nm(p.platform)}`, false,
            `Last ${nm(p.platform)} post was **${d} days ago**${rate}${followers}.`, d > 30 ? `${nm(p.platform)} has gone quiet` : `${nm(p.platform)} posting is slowing`,
            '**Accounts that stop posting drop out of feeds** and look abandoned to new visitors.',
            `Post on ${nm(p.platform)} at least once a week — plan the next 4 posts now.`))
    } else if (m && m.postCount === 0) {
      out.push(r(M, `${p.platform}-active`, 3, `Posting regularly on ${nm(p.platform)}`, false,
        `Your ${nm(p.platform)} account has **no posts yet**${followers}.`, `No ${nm(p.platform)} posts yet`,
        '**An empty profile gives visitors no reason to follow.**', `Publish your first 3 posts on ${nm(p.platform)} this week.`))
    } else if (m) {
      out.push(skip(M, `${p.platform}-active`, `Posting regularly on ${nm(p.platform)}`, `Couldn't check: ${m.via} didn't share post dates.`))
    }

    // Engagement
    if (m && m.engagementRate !== null) {
      const [low, good] = ENGAGEMENT[p.platform] ?? [1, 2]
      const e = m.engagementRate
      out.push(e >= low
        ? r(M, `${p.platform}-engagement`, 2, `People engage with your ${nm(p.platform)} posts`, true,
            `About **${e}%** of followers like or comment on a typical recent post (${e >= good ? 'good' : 'average'} for ${nm(p.platform)}).`, `${e >= good ? 'Good' : 'Average'} engagement on ${nm(p.platform)}`,
            'Engaged followers spread your posts further.', e >= good ? '' : `Ask a question or add a clear call to comment in your next ${nm(p.platform)} posts.`)
        : r(M, `${p.platform}-engagement`, 2, `People engage with your ${nm(p.platform)} posts`, false,
            `Only **${e}%** of followers like or comment on a typical recent post (under ${low}% is low for ${nm(p.platform)}).`, `Low engagement on ${nm(p.platform)}`,
            '**Posts few people react to are shown to fewer people** next time.',
            `Test formats that invite replies on ${nm(p.platform)} (questions, polls, behind-the-scenes) and compare engagement after 2 weeks.`))
    }

    // Website in bio (only when the platform tells us)
    if (m && m.websiteInBio !== null) {
      out.push(m.websiteInBio
        ? r(M, `${p.platform}-bio-link`, 1, `Your website is in your ${nm(p.platform)} profile`, true, `Your ${nm(p.platform)} profile links to your website.`, 'Website linked in profile', 'Followers can reach your site in one tap.', '')
        : r(M, `${p.platform}-bio-link`, 1, `Your website is in your ${nm(p.platform)} profile`, false, `Your ${nm(p.platform)} profile has **no website link**.`, 'No website in profile',
            '**Followers who want to buy or learn more have no direct path** to your site.', `Add ${data.websiteUrl} to your ${nm(p.platform)} profile.`))
    }
  }
  if (!anyData) {
    out.push(skip(M, 'connect', 'Followers, posting and engagement',
      'Couldn\'t check: no social account is connected, so followers, posting and engagement can\'t be read. Connect Instagram, Facebook or LinkedIn in Settings → Integrations (one click).'))
  }

  return out
}

// ── Ideas (Claude) ────────────────────────────────────────────────────────────

function platformLine(p: SocialPlatformData): string {
  const parts = [`${nm(p.platform)}: ${p.profileUrl ?? 'no profile found'}`]
  if (p.handle) parts.push(`handle @${p.handle}`)
  const m = p.metrics
  if (m && !m.fetchError) {
    if (m.followerCount != null) parts.push(`${m.followerCount} followers`)
    if (m.postsPerWeek != null) parts.push(`${m.postsPerWeek} posts/week`)
    if (m.engagementRate != null) parts.push(`${m.engagementRate}% engagement`)
    if (m.bio) parts.push(`bio: "${m.bio.slice(0, 160)}"`)
  }
  const last = m?.lastPostDate ?? p.publicLastPostDate
  if (last) parts.push(`last post ${daysSince(last)} days ago`)
  return `- ${parts.join(' · ')}`
}

export async function analyzeSocialMedia(data: SocialMediaFetchResult, brainContext?: string): Promise<DynamicModuleAnalysisResult[]> {
  const rules = buildSocialRuleResults(data)
  const ideaCats = (SOCIAL_MEDIA_MODULE.categories as DynamicModuleCategoryDefinition[]).filter(c => c.insight)
  const active = data.platforms.filter(p => p.profileUrl)

  const prompt = `${brainContext ? `=== About this brand ===\n${brainContext}\n\n` : ''}Brand: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl}
Industry: ${data.industry ?? 'not provided'}
Target audience: ${data.targetAudience ?? 'not provided'}

=== Social profiles we found (facts) ===
${data.platforms.map(platformLine).join('\n')}

=== Write ideas for these sections ===
${ideaCats.map(c => `--- "${c.slug}" (${c.label}) ---\n${c.prompt}`).join('\n\n')}
${active.length === 0 ? '\nThe brand has no social profiles yet: base ideas on which platform to start with for this industry and audience.' : ''}

Return ONLY a JSON array. Each element:
{"category": one of ${ideaCats.map(c => `"${c.slug}"`).join(', ')}, "slug": "{category}-{short-descriptor}", "label": plain English title, "weight": 1|2|3 (priority), "detail": one sentence, the idea, key point in **double asterisks**, "highlight": 5–8 words, "narrative": one sentence on why it helps this brand, "action": the concrete first step}`

  let ideas: Result[] = []
  try {
    const raw = await callAI({ system: SOCIAL_MEDIA_MODULE.systemPrompt, prompt, maxTokens: 6000, model: 'claude-haiku-4-5-20251001' })
    const allowed = new Set(ideaCats.map(c => c.slug))
    ideas = (parseClaudeJsonArray(raw) as Result[])
      .filter(x => typeof x?.category === 'string' && allowed.has(x.category) && typeof x.label === 'string' && typeof x.detail === 'string')
      .map(x => ({
        category: x.category,
        // Ideas are recognised by their slug prefix (see isDynamicIdea), so make sure it's there
        slug: String(x.slug ?? x.label).startsWith(`${x.category}-`) ? String(x.slug) : `${x.category}-${String(x.slug ?? x.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
        label: x.label,
        weight: x.weight === 3 || x.weight === 1 ? x.weight : 2,
        detail: x.detail,
        highlight: x.highlight,
        narrative: x.narrative ?? '',
        action: x.action ?? '',
        verified: false,
        fixable: false,
      }))
  } catch (err) {
    console.error('[social-media] ideas failed', err)
  }

  // Unique slugs (two ideas with the same slug would overwrite each other)
  const seen = new Set<string>()
  return [...rules, ...ideas].filter(x => (seen.has(x.slug) ? false : (seen.add(x.slug), true)))
}
