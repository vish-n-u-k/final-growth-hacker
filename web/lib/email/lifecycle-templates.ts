// HTML for lifecycle emails (welcome, Pro started, Pro ended, account deleted). Pure functions: no DB, no sending.
// Same look as the daily email: GrowJin green, white card, table layout so it renders in every client.

export type LifecycleKind = 'welcome' | 'pro_welcome' | 'pro_ended' | 'account_deleted'

export interface LifecycleContext {
  firstName: string | null
  brandName: string | null      // null for account_deleted when the brand is already gone
  websiteUrl: string | null
  appUrl: string
  replyAddress: string          // admin Gmail, for "tell us why" mailto links
  price?: string | null         // e.g. "$29/month"
  periodEnd?: Date | null       // trial end or next billing date
  isTrial?: boolean             // pro_welcome: the subscription started as a trial
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

function reasonLinks(c: LifecycleContext, subjectPrefix: string): string {
  const reasons = ['Too expensive', "Didn't see enough results", 'Not using it enough', 'Missing a feature I need', 'Switched to another tool']
  const rows = reasons.map(r => {
    const href = `mailto:${c.replyAddress}?subject=${encodeURIComponent(`${subjectPrefix}: ${r}`)}&body=${encodeURIComponent(`${c.brandName ? `Brand: ${c.brandName}\n\n` : ''}Anything else you'd like to add:\n`)}`
    return `<tr><td style="padding:0 0 8px;"><a href="${esc(href)}" style="display:block;padding:11px 14px;border:1px solid #d3ddd7;border-radius:7px;font-size:14px;color:${INK};text-decoration:none;font-family:${FONT};">${esc(r)}</a></td></tr>`
  })
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${rows.join('')}</table>`
}

function shell(
  c: LifecycleContext,
  opts: { hero?: { eyebrow: string; title: string; subtitle?: string; tone: 'dark' | 'green' }; body: string; footer: string },
): string {
  const hero = opts.hero
    ? `<tr><td style="background:${opts.hero.tone === 'dark' ? '#0d1a0f' : GREEN};padding:34px 36px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:${opts.hero.tone === 'dark' ? '#6fc08d' : '#dff5e8'};text-transform:uppercase;font-family:${FONT};">${opts.hero.eyebrow}</p>
        <h1 style="margin:0;font-size:26px;line-height:1.25;color:#ffffff;font-weight:800;letter-spacing:-0.5px;font-family:${FONT};">${opts.hero.title}</h1>
        ${opts.hero.subtitle ? `<p style="margin:8px 0 0;font-size:15px;color:${opts.hero.tone === 'dark' ? '#a9c4b3' : '#dff5e8'};font-family:${FONT};">${opts.hero.subtitle}</p>` : ''}
      </td></tr>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:32px 16px 40px;background:#f2f4f3;font-family:${FONT};">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e0e8e3;border-radius:10px;overflow:hidden;">
    <tr><td style="padding:22px 36px;border-bottom:1px solid #eef2ef;">
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
  const brand = c.brandName ? esc(c.brandName) : 'your brand'
  const site = c.websiteUrl ? esc(c.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')) : brand
  const date = fmtDate(c.periodEnd)
  const app = c.appUrl.replace(/\/$/, '')
  const pricing = `${app}/pricing`
  const dashboard = `${app}/dashboard`
  const signOff = p('The GrowJin Team')

  switch (kind) {
    case 'welcome':
      return {
        subject: `Welcome to GrowJin, ${c.brandName ?? 'you'}${c.brandName ? ' is all set' : "'re all set"}`,
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

    case 'pro_welcome':
      return {
        subject: c.isTrial ? 'Your GrowJin Pro trial is live' : 'Welcome to GrowJin Pro',
        html: shell(c, {
          hero: {
            eyebrow: c.isTrial ? 'Pro trial started' : 'Pro unlocked',
            title: 'Welcome to GrowJin Pro',
            subtitle: `${brand} now has the full growth toolkit.`,
            tone: 'green',
          },
          body: [
            p(`${hi(c)} thank you for going Pro. It genuinely helps us keep building. Here's what you have now:`),
            checklist([
              'Every GrowJin module unlocked',
              "The daily growth email with today's top tasks",
            ]),
            factBox([
              ['Plan', c.price ? `Pro, ${esc(c.price)}` : 'Pro'],
              ...(date ? [[c.isTrial ? 'Trial ends' : 'Next billing date', date] as [string, string]] : []),
              ...(c.isTrial ? [['Cancel', "anytime before the trial ends and you won't be charged"] as [string, string]] : [['Receipt', 'sent separately by Stripe'] as [string, string]]),
            ]),
            button('Start using Pro →', dashboard),
            signOff,
          ].join('\n'),
          footer: `Manage your plan, card or invoices on the <a href="${esc(pricing)}" style="color:${GREEN};text-decoration:none;">billing page</a>.`,
        }),
      }

    case 'pro_ended':
      return {
        subject: `Sorry to see you go${c.firstName ? `, ${c.firstName}` : ''}`,
        html: shell(c, {
          body: [
            p(hi(c)),
            p(`Your Pro plan for <b>${brand}</b> has ended, and you're now on the free plan. We're sad to see you go, and thank you for giving GrowJin Pro a try.`),
            note("Your reports, playbook and settings are all still saved. You can keep using the free modules, and if you come back to Pro everything is right where you left it."),
            p("<b>One quick question:</b> what was the main reason? Tap one and hit send. It takes a second and helps us a lot."),
            reasonLinks(c, 'Why I left Pro'),
            p("If this was a payment problem rather than a choice, you can update your card and reactivate from the billing page."),
            button('Reactivate Pro', pricing, true),
            signOff,
          ].join('\n'),
          footer: 'This confirms a change to your GrowJin subscription.',
        }),
      }

    case 'account_deleted':
      return {
        subject: 'Your GrowJin account has been deleted',
        html: shell(c, {
          body: [
            p(hi(c)),
            p(`Your GrowJin account${c.brandName ? ` and everything for <b>${brand}</b>` : ''} has been deleted. We're sad to see you leave, and thank you for trying GrowJin.`),
            note("If you had a Pro plan, it's been cancelled and you won't be charged again."),
            p("<b>One quick question before you go:</b> what was the main reason? Tap one and hit send."),
            reasonLinks(c, 'Why I deleted my account'),
            p("You're always welcome back. Signing up again takes a minute. If you didn't ask for this, reply to this email straight away."),
            signOff,
          ].join('\n'),
          footer: 'This confirms your GrowJin account was deleted. You won\'t get any more emails from us.',
        }),
      }
  }
}
