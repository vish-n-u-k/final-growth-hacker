// HTML for lifecycle emails (welcome, Pro, cancellation). Pure functions: no DB, no sending.
// Same look as the daily email: GrowJin green, white card, table layout so it renders in every client.

export type LifecycleKind =
  | 'welcome'
  | 'pro_trial_started'
  | 'pro_welcome'
  | 'cancel_scheduled'
  | 'cancel_undone'
  | 'access_ending'
  | 'subscription_ended'
  | 'winback_1'
  | 'winback_2'

export interface LifecycleContext {
  firstName: string | null
  brandName: string
  websiteUrl: string | null
  appUrl: string
  replyAddress: string          // admin Gmail, for "tell us why" mailto links
  price?: string | null         // e.g. "$29/month"
  periodEnd?: Date | null       // trial end, next billing date, or when access ends
  wasTrial?: boolean            // pro_welcome: trial converted to paid
  unsubscribeUrl?: string       // win-back emails only
}

export interface RenderedEmail { subject: string; html: string }

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const GREEN = '#179a50'
const INK = '#1a2e20'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(d: Date | null | undefined): string | null {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null
}

const hi = (c: LifecycleContext) => `Hi ${esc(c.firstName ?? 'there')},`

// ── Building blocks ──────────────────────────────────────────────────────────

const p = (html: string) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:${INK};font-family:${FONT};">${html}</p>`

const h1 = (text: string) =>
  `<h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:#0c1d13;font-weight:800;letter-spacing:-0.4px;font-family:${FONT};">${text}</h1>`

function button(text: string, url: string, outline = false): string {
  const style = outline
    ? `background:#ffffff;color:${GREEN};border:1.5px solid ${GREEN};`
    : `background:${GREEN};color:#ffffff;`
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td>
    <a href="${esc(url)}" style="display:inline-block;padding:12px 26px;${style}font-size:14px;font-weight:600;text-decoration:none;border-radius:7px;font-family:${FONT};">${esc(text)}</a>
  </td></tr></table>`
}

function steps(items: [string, string][]): string {
  const rows = items.map(([title, text], i) => `
    <tr><td style="padding:12px 14px;background:#f5faf7;border:1px solid #dcebe2;border-radius:8px;">
      <p style="margin:0;font-size:14px;line-height:1.6;color:${INK};font-family:${FONT};"><b style="color:${GREEN};">${i + 1}.</b> <b>${title}</b>: ${text}</p>
    </td></tr>`)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    ${rows.join('<tr><td style="height:8px;"></td></tr>')}
  </table>`
}

function checklist(items: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    ${items.map(t => `<tr><td style="padding:6px 0;font-size:14px;line-height:1.6;color:${INK};font-family:${FONT};"><span style="color:${GREEN};font-weight:700;">&#10003;</span>&nbsp; ${t}</td></tr>`).join('')}
  </table>`
}

function note(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f5faf7;border-left:3px solid ${GREEN};">
    <tr><td style="padding:12px 16px;font-size:14px;line-height:1.7;color:${INK};font-family:${FONT};">${html}</td></tr>
  </table>`
}

function factBox(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f7f9f7;border:1px solid #e0e8e3;border-radius:8px;">
    <tr><td style="padding:14px 16px;font-size:13px;line-height:1.8;color:#3d5246;font-family:${FONT};">
      ${rows.map(([k, v]) => `<b style="color:#0c1d13;">${k}:</b> ${v}`).join('<br>')}
    </td></tr>
  </table>`
}

function reasonLinks(c: LifecycleContext): string {
  const reasons = ['Too expensive', "Didn't see enough results", 'Not using it enough', 'Missing a feature I need', 'Switched to another tool']
  const rows = reasons.map(r => {
    const href = `mailto:${c.replyAddress}?subject=${encodeURIComponent(`Why I cancelled: ${r}`)}&body=${encodeURIComponent(`Brand: ${c.brandName}\n\nAnything else you'd like to add:\n`)}`
    return `<tr><td style="padding:0 0 8px;"><a href="${esc(href)}" style="display:block;padding:11px 14px;border:1px solid #d3ddd7;border-radius:7px;font-size:14px;color:${INK};text-decoration:none;font-family:${FONT};">${esc(r)}</a></td></tr>`
  })
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${rows.join('')}</table>`
}

function shell(
  c: LifecycleContext,
  opts: { hero?: { eyebrow: string; title: string; subtitle?: string; tone: 'dark' | 'green' }; badge?: string; body: string; footer: string },
): string {
  const hero = opts.hero
    ? `<tr><td style="background:${opts.hero.tone === 'dark' ? '#0d1a0f' : GREEN};padding:34px 36px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:${opts.hero.tone === 'dark' ? '#6fc08d' : '#dff5e8'};text-transform:uppercase;font-family:${FONT};">${opts.hero.eyebrow}</p>
        <h1 style="margin:0;font-size:26px;line-height:1.25;color:#ffffff;font-weight:800;letter-spacing:-0.5px;font-family:${FONT};">${opts.hero.title}</h1>
        ${opts.hero.subtitle ? `<p style="margin:8px 0 0;font-size:15px;color:${opts.hero.tone === 'dark' ? '#a9c4b3' : '#dff5e8'};font-family:${FONT};">${opts.hero.subtitle}</p>` : ''}
      </td></tr>`
    : ''
  const badge = opts.badge
    ? `<span style="float:right;margin-top:5px;font-size:11px;font-weight:700;letter-spacing:1px;color:${GREEN};background:#e6f5ec;padding:4px 10px;border-radius:999px;font-family:${FONT};">${opts.badge}</span>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:32px 16px 40px;background:#f2f4f3;font-family:${FONT};">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e0e8e3;border-radius:10px;overflow:hidden;">
    <tr><td style="padding:22px 36px;border-bottom:1px solid #eef2ef;">
      ${badge}
      <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;background:${GREEN};border-radius:7px;color:#fff;font-weight:800;font-size:14px;vertical-align:middle;font-family:${FONT};">G</span>
      <span style="font-size:16px;font-weight:700;color:#0c1d13;vertical-align:middle;margin-left:8px;font-family:${FONT};">GrowJin</span>
    </td></tr>
    ${hero}
    <tr><td style="padding:30px 36px 8px;">
      ${opts.body}
    </td></tr>
    <tr><td style="padding:16px 36px;background:#f7f9f7;border-top:1px solid #e0e8e3;text-align:center;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#8a9e90;font-family:${FONT};">${opts.footer}</p>
    </td></tr>
  </table>
</td></tr>
</table>`
}

// ── Emails ───────────────────────────────────────────────────────────────────

export function renderLifecycleEmail(kind: LifecycleKind, c: LifecycleContext): RenderedEmail {
  const brand = esc(c.brandName)
  const site = c.websiteUrl ? esc(c.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')) : brand
  const date = fmtDate(c.periodEnd)
  const app = c.appUrl.replace(/\/$/, '')
  const pricing = `${app}/pricing`
  const dashboard = `${app}/dashboard`
  const billingFooter = `Manage your plan, card or invoices on the <a href="${esc(pricing)}" style="color:${GREEN};text-decoration:none;">billing page</a>.`
  const signOff = p('The GrowJin Team')

  switch (kind) {
    case 'welcome':
      return {
        subject: `Welcome to GrowJin, ${c.brandName} is all set`,
        html: shell(c, {
          hero: { eyebrow: 'Welcome aboard', title: `Let's grow ${brand}${c.firstName ? `, ${esc(c.firstName)}` : ''}.`, tone: 'dark' },
          body: [
            p(`Thanks for signing up. We're analysing <b>${site}</b> now, and your Foundation report will be ready on your dashboard in a few minutes.`),
            p('Three things to do first:'),
            steps([
              ['Read your Foundation report', 'it sets up your brand playbook and the first fixes worth making.'],
              ['Work through the next modules', 'each one unlocks as you go and adds new tasks to your list.'],
              ['Turn on the daily update', 'one short email each morning with what to do today.'],
            ]),
            button('Open my dashboard →', dashboard),
            p('Questions? Just reply to this email. A real person reads every one.'),
            signOff,
          ].join('\n'),
          footer: "You're receiving this because you created a GrowJin account.",
        }),
      }

    case 'pro_trial_started':
      return {
        subject: 'Your GrowJin Pro trial is live',
        html: shell(c, {
          badge: 'PRO TRIAL',
          body: [
            h1(`${hi(c).replace(/,$/, '')}, your Pro trial has started.`),
            p(`Everything is unlocked for <b>${brand}</b>${date ? ` until <b>${date}</b>` : ''}. You can cancel anytime before then and won't be charged.`),
            ...(date || c.price ? [factBox([
              ...(date ? [['Trial ends', date] as [string, string]] : []),
              ...(c.price ? [['Then', esc(c.price)] as [string, string]] : []),
            ])] : []),
            p('A good way to use the trial: open the modules you couldn\'t use before and work through the top tasks they give you.'),
            button('Explore Pro →', dashboard),
            signOff,
          ].join('\n'),
          footer: billingFooter,
        }),
      }

    case 'pro_welcome':
      return {
        subject: c.wasTrial ? "You're officially on GrowJin Pro" : 'Welcome to GrowJin Pro',
        html: shell(c, {
          hero: {
            eyebrow: c.wasTrial ? 'Trial converted' : 'Pro unlocked',
            title: 'Welcome to GrowJin Pro',
            subtitle: `${brand} now has the full growth toolkit.`,
            tone: 'green',
          },
          body: [
            p(`${hi(c)} thank you for going Pro. It genuinely helps us keep building. Here's what you have now:`),
            checklist([
              'Every GrowJin module unlocked',
              "The daily growth email with today's top tasks",
              'Full access to new modules as they launch',
            ]),
            factBox([
              ['Plan', c.price ? `Pro, ${esc(c.price)}` : 'Pro'],
              ...(date ? [['Next billing date', date] as [string, string]] : []),
              ['Receipt', 'sent separately by Stripe'],
            ]),
            button('Start using Pro →', dashboard),
            signOff,
          ].join('\n'),
          footer: billingFooter,
        }),
      }

    case 'cancel_scheduled':
      return {
        subject: `Sorry to see you go${c.firstName ? `, ${c.firstName}` : ''}`,
        html: shell(c, {
          body: [
            p(hi(c)),
            p(`Your Pro plan for <b>${brand}</b> has been cancelled. We're sad to see you go, and thank you for giving GrowJin a try.`),
            note(`You keep full Pro access${date ? ` until <b>${date}</b>` : ' until the end of your billing period'}. After that you move to the free plan, and your reports and data stay saved.`),
            p("<b>One quick question:</b> what was the main reason? Tap one and hit send. It takes a second and helps us a lot."),
            reasonLinks(c),
            p('Changed your mind? You can keep Pro from the billing page, and nothing will be lost.'),
            button('Keep my Pro plan', pricing, true),
            p('Or just reply and tell us in your own words.'),
            signOff,
          ].join('\n'),
          footer: 'This confirms a change to your GrowJin subscription.',
        }),
      }

    case 'cancel_undone':
      return {
        subject: "Glad you're staying",
        html: shell(c, {
          body: [
            p(hi(c)),
            p(`Your cancellation is undone and <b>${brand}</b> stays on GrowJin Pro. Nothing changes${date ? `, and your next billing date is <b>${date}</b>` : ''}.`),
            p("Thanks for sticking with us. If something made you consider leaving, reply and let us know. We'd love to fix it."),
            button('Back to my dashboard →', dashboard),
            signOff,
          ].join('\n'),
          footer: billingFooter,
        }),
      }

    case 'access_ending':
      return {
        subject: `Your GrowJin Pro access ends ${date ? `on ${date}` : 'soon'}`,
        html: shell(c, {
          body: [
            h1(`${hi(c).replace(/,$/, '')}, a quick heads-up`),
            p(`Pro access for <b>${brand}</b> ends ${date ? `on <b>${date}</b>` : 'in a couple of days'}. Here's what changes:`),
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>
              <td width="50%" valign="top" style="padding-right:10px;font-family:${FONT};">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b4532a;">You'll lose</p>
                <p style="margin:0;font-size:14px;line-height:1.8;color:${INK};">Pro-only modules<br>The daily growth email<br>New modules as they launch</p>
              </td>
              <td width="50%" valign="top" style="padding-left:10px;font-family:${FONT};">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${GREEN};">You keep</p>
                <p style="margin:0;font-size:14px;line-height:1.8;color:${INK};">Your past reports<br>Your brand playbook<br>Free-plan modules</p>
              </td>
            </tr></table>`,
            button('Keep Pro →', pricing),
            signOff,
          ].join('\n'),
          footer: "No action needed if you're happy to move to the free plan.",
        }),
      }

    case 'subscription_ended':
      return {
        subject: "You're now on the GrowJin free plan",
        html: shell(c, {
          body: [
            p(hi(c)),
            p(`Your Pro plan for <b>${brand}</b> has ended, and you're now on the free plan.`),
            note('Your reports, playbook and settings are all still saved. If you come back to Pro, everything is right where you left it.'),
            p('You can keep using the free modules as long as you like.'),
            button('Open my dashboard →', dashboard),
            signOff,
          ].join('\n'),
          footer: 'This confirms a change to your GrowJin subscription.',
        }),
      }

    case 'winback_1':
    case 'winback_2': {
      const first = kind === 'winback_1'
      return {
        subject: first ? `Still growing ${c.brandName}?` : `Your GrowJin data is still here`,
        html: shell(c, {
          body: [
            p(hi(c)),
            p(first
              ? `It's been a couple of weeks since <b>${brand}</b> left Pro. We've kept improving GrowJin since then, and your reports and playbook are saved and ready.`
              : `One last note from us. <b>${brand}</b>'s reports, playbook and settings are still saved in GrowJin, ready whenever you want them.`),
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#0d1a0f;border-radius:10px;">
              <tr><td style="padding:24px 26px;text-align:center;font-family:${FONT};">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6fc08d;">Pick up where you left off</p>
                <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#ffffff;">Every module, one click away</p>
                <p style="margin:0 0 16px;font-size:13px;color:#a9c4b3;">Reactivate Pro and your full growth plan comes straight back.</p>
                <a href="${esc(pricing)}" style="display:inline-block;padding:12px 26px;background:${GREEN};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:7px;">Reactivate Pro →</a>
              </td></tr>
            </table>`,
            p(first ? 'If something was missing, reply and tell us. It shapes what we build next.' : "We won't email about this again. Thanks for being part of GrowJin."),
            signOff,
          ].join('\n'),
          footer: c.unsubscribeUrl
            ? `<a href="${esc(c.unsubscribeUrl)}" style="color:#8a9e90;">Unsubscribe from these emails</a>`
            : "You're receiving this because you had a GrowJin Pro plan.",
        }),
      }
    }
  }
}
