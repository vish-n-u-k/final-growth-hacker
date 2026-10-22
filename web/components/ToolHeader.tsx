import ToolIcon from '@/components/ToolIcon'
import ToolIntro from '@/components/ToolIntro'
import type { ToolIntroId } from '@/lib/tool-intros'

// The one slim header every tool page uses: the tool's icon and name, small status chips, a short
// line of info, the main buttons on the right, then the one-line "what this does" strip.
// Stays pinned while the page scrolls.
export default function ToolHeader({ icon, title, chips, meta, actions, intro }: {
  icon: string            // components/ToolIcon name, same as the sidebar
  title: React.ReactNode
  chips?: React.ReactNode // e.g. <span className="th-chip th-chip--on">On · weekly</span>
  meta?: React.ReactNode  // short and plain: "Last run 2 h ago"
  actions?: React.ReactNode
  intro?: ToolIntroId
}) {
  return (
    <>
      <header className="th">
        <div className="th-main">
          <span className="th-ic"><ToolIcon name={icon} size={16} /></span>
          <h1 className="th-title">{title}</h1>
          {chips}
          {meta && <span className="th-meta">{meta}</span>}
        </div>
        {actions && <div className="th-actions">{actions}</div>}
      </header>
      {intro && <ToolIntro id={intro} />}
    </>
  )
}
