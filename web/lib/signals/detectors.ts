// ── Signal detectors ──────────────────────────────────────────────────────────
// Cheap, rule-based checks (no AI). Each compares fresh data with the last
// snapshot and opens / clears signals. Email + Meta run from the daily-signals
// cron; business stage runs whenever that module is re-analysed.

import { checkSpf, checkDkim, checkDmarc } from '@/lib/modules/email-marketing/fetcher'
import { openSignal, clearSignals, getSnapshot, saveSnapshot, getOpenSignals } from '@/lib/signals'
import { db } from '@/lib/db'
import { adLaunches } from '@/lib/db/schema'
import { and, eq, gte } from 'drizzle-orm'

// ── Email deliverability (SPF / DKIM / DMARC newly broken) ────────────────────

interface EmailDnsSnapshot {
  domain: string
  spf: boolean
  dkim: boolean
  dkimSelector: string | null
  dmarc: boolean
}

const DNS_RECORDS = [
  { key: 'spf',   name: 'SPF',   why: 'Without it, inbox providers can\'t confirm your emails are really from you, so more of them land in spam.' },
  { key: 'dkim',  name: 'DKIM',  why: 'Without a valid signature, your emails look unverified and deliverability drops.' },
  { key: 'dmarc', name: 'DMARC', why: 'Without it, Gmail and Yahoo may reject or spam-folder your bulk emails.' },
] as const

async function checkDns(domain: string, prevSelector: string | null) {
  const [spf, dmarc, dkimPrev] = await Promise.all([
    checkSpf(domain),
    checkDmarc(domain),
    prevSelector ? checkDkim(domain, [prevSelector]) : Promise.resolve(null),
  ])
  // Known selector missing (or never known) → full selector scan
  const dkim = dkimPrev?.found ? dkimPrev : await checkDkim(domain)
  return { spf: spf.found, dmarc: dmarc.found, dkim: dkim.found, dkimSelector: dkim.selector }
}

export async function detectEmailDns(brandId: string, websiteUrl: string) {
  let domain: string
  try {
    domain = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, '')
  } catch {
    return { skipped: 'invalid url' }
  }

  const prev = await getSnapshot<EmailDnsSnapshot>(brandId, 'email-marketing')
  const samePrev = prev?.domain === domain ? prev : null

  let now = await checkDns(domain, samePrev?.dkimSelector ?? null)

  // A record that was there yesterday and is gone today: re-check once to rule out a DNS blip
  if (samePrev && DNS_RECORDS.some((r) => samePrev[r.key] && !now[r.key])) {
    const retry = await checkDns(domain, samePrev.dkimSelector)
    now = {
      spf: now.spf || retry.spf,
      dmarc: now.dmarc || retry.dmarc,
      dkim: now.dkim || retry.dkim,
      dkimSelector: now.dkimSelector ?? retry.dkimSelector,
    }
  }

  const opened: string[] = []
  const healthy: string[] = []
  for (const r of DNS_RECORDS) {
    const signalKey = `dns-${r.key}-missing`
    if (now[r.key]) {
      healthy.push(signalKey)
    } else if (samePrev?.[r.key]) {
      // Was present at the last check, missing now → newly broken
      const raised = await openSignal(brandId, {
        source: 'email-marketing',
        signalKey,
        title: `${r.name} record for ${domain} is missing`,
        detail: `Your ${r.name} record was present at the last check and can no longer be found. ${r.why}`,
        action: `Check your DNS settings at your domain registrar or DNS host and restore the ${r.name} record for ${domain}. If you changed email providers recently, add the new provider's ${r.name} record.`,
        route: 'manual',
        priority: 3,
      })
      if (raised) opened.push(signalKey)
    }
  }
  await clearSignals(brandId, 'email-marketing', healthy)

  // First run only records a baseline — the Email Marketing checklist covers never-configured records
  await saveSnapshot(brandId, 'email-marketing', { domain, ...now } satisfies EmailDnsSnapshot)
  return { domain, ...now, opened, baseline: !samePrev }
}

// ── Meta Ads (CTR / CPC worse than benchmark, budget underspending) ──────────

const META_BASE = 'https://graph.facebook.com/v23.0'
// Same benchmarks the Meta Ads agent uses (lib/modules/meta-ads/definition.ts)
const BENCH_CTR = 0.9    // %
const BENCH_CPC = 1.72   // USD — only applied to USD accounts
const MIN_SPEND = 20     // ignore accounts that barely spent (noise)
const UNDERSPEND_RATIO = 0.5

const META_KEYS = ['token-expired', 'ctr-below-benchmark', 'cpc-above-benchmark', 'budget-underspend']

async function metaGet(path: string, token: string): Promise<{ data?: unknown; error?: { code: number; message: string } } | null> {
  try {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${META_BASE}/${path}${sep}access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(15000),
    })
    return await res.json()
  } catch {
    return null
  }
}

export async function detectMetaAds(brandId: string, accessToken: string, rawAccountId: string) {
  if (!accessToken || !rawAccountId || accessToken === 'demo') return { skipped: 'no credentials' }
  const act = `act_${rawAccountId.replace(/^act_/, '')}`

  const [account, campaigns, insights] = await Promise.all([
    metaGet(`${act}?fields=currency`, accessToken),
    metaGet(`${act}/campaigns?fields=status,daily_budget&limit=200`, accessToken),
    metaGet(`${act}/insights?level=account&date_preset=last_7d&fields=spend,impressions,clicks`, accessToken),
  ])

  if (!account || !campaigns || !insights) return { skipped: 'meta unreachable' }

  const err = account.error ?? campaigns.error ?? insights.error
  if (err?.code === 190) {
    await openSignal(brandId, {
      source: 'meta-ads',
      signalKey: 'token-expired',
      title: 'Meta Ads connection expired',
      detail: 'GrowJin can no longer read your Meta Ads data, so ad performance isn\'t being tracked.',
      action: 'Go to GrowJin Settings → Integrations and reconnect Meta Ads with a fresh access token.',
      priority: 3,
    })
    return { opened: ['token-expired'] }
  }
  if (err) return { skipped: `meta error: ${err.message}` }

  const currency = (account as { currency?: string }).currency ?? 'USD'
  const row = ((insights.data as { spend?: string; impressions?: string; clicks?: string }[]) ?? [])[0]
  const spend = parseFloat(row?.spend ?? '0')
  const impressions = parseInt(row?.impressions ?? '0', 10)
  const clicks = parseInt(row?.clicks ?? '0', 10)
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
  const cpc = clicks > 0 ? spend / clicks : 0

  // Campaign-level budgets only (ad-set budgets aren't visible here)
  const weeklyBudget = ((campaigns.data as { status: string; daily_budget?: string }[]) ?? [])
    .filter((c) => c.status === 'ACTIVE' && c.daily_budget)
    .reduce((s, c) => s + parseInt(c.daily_budget!, 10) / 100, 0) * 7

  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`
  const triggered = new Map<string, Parameters<typeof openSignal>[1]>()

  if (spend >= MIN_SPEND && impressions > 0 && ctr < BENCH_CTR) {
    triggered.set('ctr-below-benchmark', {
      source: 'meta-ads',
      signalKey: 'ctr-below-benchmark',
      title: 'Your Meta ads are getting fewer clicks than average',
      detail: `Last 7 days: ${ctr.toFixed(2)}% click rate on ${impressions.toLocaleString()} impressions (benchmark ${BENCH_CTR}%), with ${fmt(spend)} spent.`,
      action: 'Review your lowest-CTR ads in Ads Manager: refresh the creative and headline, tighten targeting, or pause the weakest ads.',
      priority: 2,
    })
  }
  if (currency === 'USD' && spend >= MIN_SPEND && clicks > 0 && cpc > BENCH_CPC) {
    triggered.set('cpc-above-benchmark', {
      source: 'meta-ads',
      signalKey: 'cpc-above-benchmark',
      title: 'Each click on your Meta ads costs more than average',
      detail: `Last 7 days: ${fmt(cpc)} per click (benchmark USD ${BENCH_CPC}), ${clicks.toLocaleString()} clicks for ${fmt(spend)}.`,
      action: 'Check which campaigns have the highest CPC in Ads Manager. Broaden audiences, test new creatives, or move budget to cheaper-performing campaigns.',
      priority: 2,
    })
  }
  if (weeklyBudget > 0 && spend < weeklyBudget * UNDERSPEND_RATIO) {
    triggered.set('budget-underspend', {
      source: 'meta-ads',
      signalKey: 'budget-underspend',
      title: 'Your Meta ads are spending much less than their budget',
      detail: `Last 7 days: spent ${fmt(spend)} of a ${fmt(weeklyBudget)} weekly budget (${Math.round((spend / weeklyBudget) * 100)}%). Ads may be stuck in review, rejected, or targeting too narrow an audience.`,
      action: 'Open Ads Manager and check for rejected ads, ads stuck in review, or audiences that are too small. Fix delivery or lower the budget.',
      priority: 2,
    })
  }

  const opened: string[] = []
  for (const s of triggered.values()) {
    if (await openSignal(brandId, s)) opened.push(s.signalKey)
  }
  await clearSignals(brandId, 'meta-ads', META_KEYS.filter((k) => !triggered.has(k)))
  await saveSnapshot(brandId, 'meta-ads', { currency, spend, impressions, clicks, ctr, cpc, weeklyBudget })
  return { currency, spend, ctr, cpc, weeklyBudget, opened }
}

// ── Campaigns launched from GrowJin (still paused? how are they doing?) ──────
// Launches are created PAUSED. Refreshes each one's status and lifetime results in
// ad_launches, and raises a task if it was never switched on.

const LAUNCH_TRACK_DAYS = 90
const LAUNCH_PAUSED_DAYS = 2

interface MetaInsightRow {
  spend?: string; impressions?: string; clicks?: string; ctr?: string; cpc?: string
  actions?: { action_type: string; value: string }[]
}

export async function detectLaunchedCampaigns(brandId: string, accessToken: string) {
  if (!accessToken || accessToken === 'demo') return { skipped: 'no credentials' }

  const launches = await db.select().from(adLaunches).where(and(
    eq(adLaunches.brandId, brandId),
    eq(adLaunches.platform, 'meta'),
    gte(adLaunches.launchedAt, new Date(Date.now() - LAUNCH_TRACK_DAYS * 86400000)),
  ))
  if (launches.length === 0) return { launches: 0 }

  const opened: string[] = []
  const toClear: string[] = []
  for (const l of launches) {
    const [info, insights] = await Promise.all([
      metaGet(`${l.campaignId}?fields=effective_status`, accessToken),
      metaGet(`${l.campaignId}/insights?date_preset=maximum&fields=spend,impressions,clicks,ctr,cpc,actions`, accessToken),
    ])
    const status = (info as { effective_status?: string } | null)?.effective_status
    if (!status) continue // unreachable, token problem (handled by detectMetaAds) or deleted

    const row = ((insights?.data as MetaInsightRow[] | undefined) ?? [])[0]
    const metrics = row ? {
      spend: parseFloat(row.spend ?? '0'),
      impressions: parseInt(row.impressions ?? '0', 10),
      clicks: parseInt(row.clicks ?? '0', 10),
      ctr: parseFloat(row.ctr ?? '0'),
      cpc: parseFloat(row.cpc ?? '0'),
      linkClicks: parseInt(row.actions?.find((a) => a.action_type === 'link_click')?.value ?? '0', 10),
    } : l.metrics
    const activatedAt = l.activatedAt ?? (status === 'ACTIVE' ? new Date() : null)

    await db.update(adLaunches)
      .set({ status, metrics, activatedAt, checkedAt: new Date() })
      .where(eq(adLaunches.id, l.id))

    const key = `campaign-paused:${l.campaignId}`
    const ageDays = (Date.now() - (l.launchedAt?.getTime() ?? Date.now())) / 86400000
    if (!activatedAt && status === 'PAUSED' && ageDays >= LAUNCH_PAUSED_DAYS) {
      const isNew = await openSignal(brandId, {
        source: 'meta-ads',
        signalKey: key,
        title: `Your campaign "${l.name}" is ready but still paused`,
        detail: `GrowJin created it ${Math.floor(ageDays)} days ago, paused so you could review it first. It hasn't run yet, so it isn't reaching anyone.`,
        action: 'Open Meta Ads Manager, review the campaign, ad set and ad, then switch the campaign on. If you decided not to run it, dismiss this task.',
        priority: 2,
      })
      if (isNew) opened.push(key)
    } else {
      toClear.push(key)
    }
  }
  await clearSignals(brandId, 'meta-ads', toClear)
  return { launches: launches.length, opened }
}

// ── Business stage (stage changed, new red flag) ─────────────────────────────

export interface BusinessStageState {
  classification: string | null // e.g. "Self-Serve Product · 10–50 customers"
  redFlag: string | null        // e.g. "No Pricing on Your Website"
  redFlagDetail?: string | null
}

// "Self-Serve Product · 10–50 customers" → "self:10-50" (ignores wording drift between runs)
function stageKey(label: string): string {
  const words = label.toLowerCase().match(/[a-z]+/g) ?? []
  const nums = label.match(/\d+/g) ?? []
  return `${words[0] ?? ''}:${nums.join('-')}`
}

function flagKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export async function detectBusinessStageChange(brandId: string, prev: BusinessStageState, next: BusinessStageState) {
  const opened: string[] = []

  if (prev.classification && next.classification && stageKey(prev.classification) !== stageKey(next.classification)) {
    const signalKey = `stage-changed:${stageKey(next.classification)}`
    const raised = await openSignal(brandId, {
      source: 'business-stage',
      signalKey,
      title: `Business stage changed to ${next.classification}`,
      detail: `Your business moved from "${prev.classification}" to "${next.classification}". What worked at the last stage may not be the priority now.`,
      action: 'Review the Business Stage module and your sales playbook: check the new concern, insight, and recommended actions for this stage.',
      priority: 2,
    })
    if (raised) opened.push(signalKey)
  }

  if (next.redFlag && (!prev.redFlag || flagKey(prev.redFlag) !== flagKey(next.redFlag))) {
    const signalKey = `red-flag:${flagKey(next.redFlag)}`
    // A new red flag replaces the previous one
    const stale = (await getOpenSignals(brandId))
      .filter((s) => s.source === 'business-stage' && s.signalKey.startsWith('red-flag:') && s.signalKey !== signalKey)
      .map((s) => s.signalKey)
    await clearSignals(brandId, 'business-stage', stale)

    const raised = await openSignal(brandId, {
      source: 'business-stage',
      signalKey,
      title: `Red flag: ${next.redFlag}`,
      detail: next.redFlagDetail ?? undefined,
      action: 'Open the Business Stage module for details, then fix this before spending more on growth.',
      priority: 3,
    })
    if (raised) opened.push(signalKey)
  }

  return { opened }
}
