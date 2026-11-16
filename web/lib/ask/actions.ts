// Tools Ask's Claude may only PROPOSE: they change something or spend money, so each runs only when
// the owner presses the button (POST /api/ask/tool). Writing emails has its own move (propose_emails).
export const ACTION_TOOLS = [
  'create_social_post', 'schedule_social_post',            // Frekto: draft a post, then schedule the approved one
  'set_goal',                                              // the growth goal
  'toggle_item', 'skip_item', 'resolve_signal',            // roadmap items and Today's tasks
  'analyze_module',                                        // re-check a roadmap module (AI)
  'log_work', 'update_work', 'delete_work',                // the work log
  'save_leads', 'mark_blog_published',
  'hunter', 'apify',                                       // lookups that cost credits
] as const

/** Short words for the approve button's list. */
export const ACTION_WORDS: Record<string, string> = {
  create_social_post: 'Make a post', schedule_social_post: 'Schedule a post', set_goal: 'Set your goal',
  toggle_item: 'Roadmap item', skip_item: 'Skip a roadmap item', resolve_signal: 'Today task',
  analyze_module: 'Re-check a roadmap step', log_work: 'Add to your work log', update_work: 'Update your work log',
  delete_work: 'Remove from your work log', save_leads: 'Add leads', mark_blog_published: 'Mark a post published',
  hunter: 'Find an email (Hunter credit)', apify: 'Run a web lookup (Apify, costs a little)',
}
