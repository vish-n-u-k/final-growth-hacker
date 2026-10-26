import ToolIntro from '@/components/ToolIntro'
import { AboutPage } from '@/components/ui/loading'
import type { ToolIntroId } from '@/lib/tool-intros'

// The header every tool page uses, in the same style as a Growth Path module (Website Audit,
// Foundation…): a breadcrumb with the sidebar group, the tool's name in large type, a line of
// status chips and short info under it (ending in "About this page"), the main buttons on the
// right, then the one-line "what this does" strip.

// The sidebar group each tool sits in (components/AppSidebar), for the breadcrumb
const GROUP: Record<string, string> = {
  'Lead Agent': 'Get customers', 'Competitor Leads': 'Get customers', 'Email Outreach': 'Get customers', 'AI Agents': 'Get customers',
  'Search Agent': 'Get seen', 'Social Studio': 'Get seen', 'Meta Ads': 'Get seen',
  Reminders: 'Keep track', Analytics: 'Keep track',
}

export default function ToolHeader({ title, chips, meta, actions, intro }: {
  icon?: string           // kept for callers; the module-style header shows no icon
  title: React.ReactNode
  chips?: React.ReactNode // e.g. <span className="th-chip th-chip--on">On · weekly</span>
  meta?: React.ReactNode  // short and plain: "Last run 2 h ago"
  actions?: React.ReactNode
  intro?: ToolIntroId
}) {
  const group = typeof title === 'string' ? GROUP[title] : undefined
  return (
    <>
      <header className="th">
        {group && <nav className="th-crumbs" aria-label="Breadcrumb"><span>{group}</span><span aria-hidden="true">›</span><b>{title}</b></nav>}
        <div className="th-row">
          <div className="th-main">
            <h1 className="th-title">{title}</h1>
            {(chips || meta || intro) && <div className="th-sub">{chips}{meta && <span className="th-meta">{meta}</span>}{intro && <AboutPage page={intro} />}</div>}
          </div>
          {actions && <div className="th-actions">{actions}</div>}
        </div>
      </header>
      {intro && <ToolIntro id={intro} />}
    </>
  )
}
