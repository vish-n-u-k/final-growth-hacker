'use client'

import { useState } from 'react'
import { isPagePreview, type PagePreview as Preview } from '@/lib/audit/page-preview'

// How the page looks in a Google result, or as a link shared on WhatsApp / LinkedIn / X, drawn
// from its title, description and share tags (no screenshot). Approximate: Google sometimes
// rewrites titles and descriptions, and each app styles its link cards a little differently.
// For title/description checks, the AI's suggested wordings can be swapped in to compare.

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
// Google's second line: the full address, then the path as breadcrumbs ("https://site.com › blog › post")
const crumbs = (url: string) => {
  try {
    const u = new URL(url)
    return [`${u.protocol}//${u.hostname}`, ...u.pathname.split('/').filter(Boolean)].join(' › ')
  } catch { return url }
}

// Roughly where Google cuts them off (it measures pixels; these are the usual character limits)
const TITLE_MAX = 60
const DESC_MAX = 158
/** Cuts at the last word break before the limit, with "…", the way Google shows a long description. */
const cut = (text: string, max: number) => {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const sp = head.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,.;:–—-]+$/, '')} …`
}
const fits = (n: number, max: number) => n > 0 && n <= max

function Favicon({ src, name }: { src: string; name: string }) {
  const [bad, setBad] = useState(!src)
  return bad
    ? <span className="pp-fav pp-fav--letter" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
    // eslint-disable-next-line @next/next/no-img-element
    : <img className="pp-fav" src={src} alt="" onError={() => setBad(true)} />
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="ee-copy"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
      }}
    >
      {copied ? 'Copied' : 'Copy this'}
    </button>
  )
}

function GooglePreview({ d, options, slug }: { d: Preview; options?: string[] | null; slug: string }) {
  const swaps = slug.startsWith('description') || slug === 'meta-description' ? 'description' : 'title'
  const max = swaps === 'title' ? TITLE_MAX : DESC_MAX
  const choices = (options ?? []).filter(Boolean).slice(0, 3)
  const [pick, setPick] = useState(-1) // -1 = the page as it is now
  const title = swaps === 'title' && pick >= 0 ? choices[pick] : d.title
  const description = swaps === 'description' && pick >= 0 ? choices[pick] : d.description
  const host = hostOf(d.url)
  return (
    <>
      {choices.length > 0 && (
        <div className="pp-tabs" role="tablist" aria-label="Compare">
          <button type="button" role="tab" aria-selected={pick < 0} className={pick < 0 ? 'is-on' : ''} onClick={() => setPick(-1)}>Now</button>
          {choices.map((c, i) => (
            <button key={i} type="button" role="tab" aria-selected={pick === i} className={pick === i ? 'is-on' : ''} onClick={() => setPick(i)}>
              Suggestion {i + 1} <span className={fits(c.length, max) ? 'pp-ok' : 'pp-over'}>{c.length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="pp-serp">
        <div className="pp-serp-site">
          <Favicon src={d.favicon} name={d.siteName || host} />
          <span className="pp-serp-names">
            <span className="pp-serp-name">{d.siteName || host}</span>
            <span className="pp-serp-url">{crumbs(d.url)}</span>
          </span>
        </div>
        {title
          ? <div className="pp-serp-title">{cut(title, TITLE_MAX)}</div>
          : <div className="pp-serp-title pp-missing">No title: Google will make one up from your page</div>}
        {description
          ? <p className="pp-serp-desc">{cut(description, DESC_MAX)}</p>
          : <p className="pp-serp-desc pp-missing">No description: Google will pick some text from your page</p>}
      </div>
      <div className="pp-foot">
        <p className="pp-note">
          Title <span className={fits(title.length, TITLE_MAX) ? 'pp-ok' : 'pp-over'}>{title.length}</span> characters (Google shows about {TITLE_MAX})
          {' · '}Description <span className={fits(description.length, DESC_MAX) ? 'pp-ok' : 'pp-over'}>{description.length}</span> characters (about {DESC_MAX - 3})
        </p>
        {pick >= 0 && <CopyText text={choices[pick]} />}
      </div>
    </>
  )
}

function SharePreview({ d }: { d: Preview }) {
  const [imgBad, setImgBad] = useState(false)
  const title = d.og.title || d.twitter.title || d.title
  const description = d.og.description || d.twitter.description || d.description
  const image = d.og.image || d.twitter.image
  const notes: string[] = []
  if (!d.og.title) notes.push(d.title ? 'No og:title, so apps fall back to the page title.' : 'No og:title or page title: the link shows as a bare URL.')
  if (!d.og.description) notes.push(description ? 'No og:description, so apps fall back to the meta description.' : 'No description: the card shows no text under the title.')
  if (!image) notes.push('No og:image: the link is shared without a picture, which gets far fewer clicks.')
  else if (imgBad) notes.push('The share image didn\'t load: apps will likely show the link without it.')
  return (
    <>
      <div className="pp-card">
        {image && !imgBad
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="pp-card-img" src={image} alt="" referrerPolicy="no-referrer" onError={() => setImgBad(true)} />
          : <div className="pp-card-img pp-card-img--none">{image ? 'Image didn\'t load' : 'No share image'}</div>}
        <div className="pp-card-body">
          <span className="pp-card-host">{hostOf(d.url)}</span>
          {title ? <b className="pp-card-title">{title}</b> : <b className="pp-card-title pp-missing">{d.url}</b>}
          {description && <span className="pp-card-desc">{description}</span>}
        </div>
      </div>
      {notes.length > 0 && <ul className="pp-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </>
  )
}

export default function PagePreview({ data, options, slug }: { data: unknown; options?: string[] | null; slug: string }) {
  if (!isPagePreview(data)) return null
  return (
    <div className="pp" onClick={(e) => e.stopPropagation()}>
      <div className="ee-hd">
        <span className="sm-current-label">{data.show === 'google' ? 'How it looks on Google' : 'How it looks when shared'}</span>
        <span className="ee-note">{data.show === 'google' ? 'Preview · Google may rewrite it' : 'WhatsApp, LinkedIn, X · approximate'}</span>
      </div>
      {data.show === 'google' ? <GooglePreview d={data} options={options} slug={slug} /> : <SharePreview d={data} />}
    </div>
  )
}
