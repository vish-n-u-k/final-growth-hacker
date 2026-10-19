'use client'

import SocialIcon, { socialBrand } from '@/components/SocialIcon'
import { connectUrl } from '@/lib/integrations/connect-url'
import type { SocialProfileSummary } from '@/lib/modules/social-media/summary'

// Social Media Audit: one tile per platform, saying what the last run found (where the profile came
// from, whether the website links to it, and when it last posted).

const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
const ago = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`)
const inDays = (iso: string) => {
  const d = Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000))
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`
}

export default function SocialProfilesOverview({ profiles }: { profiles: SocialProfileSummary[] }) {
  // Profiles we found first, the rest after
  const list = [...profiles].sort((a, b) => Number(!!b.url) - Number(!!a.url))
  const found = list.filter(p => p.url).length

  return (
    <section className="spo" aria-label="Your social profiles">
      <div className="spo-hd">
        <div>
          <h3 className="spo-title">Your social profiles</h3>
          <p className="spo-sub">
            {found === 0 ? 'We didn\'t find any profiles. Add them so we can check them.' : `${found} of ${list.length} platforms found, from your website, Settings and connected accounts.`}
          </p>
        </div>
        <a className="spo-edit" href={`${connectUrl('social_profiles')}`}>{found === 0 ? 'Add profiles' : 'Add or change'}</a>
      </div>
      <ul className="spo-grid">
        {list.map(p => {
          const name = socialBrand(p.platform)?.name ?? p.platform
          if (!p.url) {
            return (
              <li key={p.platform} className="spo-tile is-missing">
                <span className="spo-name"><SocialIcon platform={p.platform} size={16} mono />{name}</span>
                <span className="spo-line">Not found</span>
              </li>
            )
          }
          const last = p.lastPostDate ? daysAgo(p.lastPostDate) : null
          return (
            <li key={p.platform} className="spo-tile">
              <span className="spo-name"><SocialIcon platform={p.platform} size={16} />{name}</span>
              <a className="spo-handle" href={p.url} target="_blank" rel="noopener noreferrer">{p.handle ? `@${p.handle}` : 'Open profile'}</a>
              {p.link === 'broken' && <span className="spo-line is-bad">Link is broken</span>}
              <span className={`spo-line${p.onWebsite ? ' is-ok' : ' is-warn'}`}>{p.onWebsite ? 'Linked from your website' : 'Not linked from your website'}</span>
              {last !== null
                ? <span className={`spo-line${last > 30 ? ' is-warn' : ''}`}>Last post {ago(last)}{p.followers != null ? ` · ${p.followers.toLocaleString()} followers` : ''}</span>
                : p.nextPostDate
                  ? <span className="spo-line">First post goes out {inDays(p.nextPostDate)}</span>
                  : <span className="spo-line is-muted">{p.followers != null ? `${p.followers.toLocaleString()} followers · ` : ''}Posting not checked</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
