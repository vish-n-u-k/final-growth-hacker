// Runs one MCP tool by name for a brand. Used by the MCP server (app/api/mcp/route.ts) and by
// Ask (lib/ask), so both call exactly the same code.
import { getGrowthOverview } from '@/lib/mcp/tools/get_growth_overview'
import { getModuleDetail } from '@/lib/mcp/tools/get_module_detail'
import { analyzeModule } from '@/lib/mcp/tools/analyze_module'
import { toggleItem } from '@/lib/mcp/tools/toggle_item'
import { skipItem } from '@/lib/mcp/tools/skip_item'
import { getGrowthHistory } from '@/lib/mcp/tools/get_growth_history'
import { getBrandInfo } from '@/lib/mcp/tools/get_brand_info'
import { getPendingItems } from '@/lib/mcp/tools/get_pending_items'
import { getGaAnalytics } from '@/lib/mcp/tools/get_ga_analytics'
import { getGscData } from '@/lib/mcp/tools/get_gsc_data'
import { getPosthogAnalytics } from '@/lib/mcp/tools/get_posthog_analytics'
import { getCompetitors } from '@/lib/mcp/tools/get_competitors'
import { getSearchAgent, SEARCH_SECTIONS, type SearchSection } from '@/lib/mcp/tools/search_agent'
import { getGaConversions } from '@/lib/mcp/tools/get_ga_conversions'
import { getPosthogSegments } from '@/lib/mcp/tools/get_posthog_segments'
import { getKeywordTrends } from '@/lib/mcp/tools/get_keyword_trends'
import { getPosthogUsers } from '@/lib/mcp/tools/get_posthog_users'
import { getPosthogPowerUsers } from '@/lib/mcp/tools/get_posthog_power_users'
import { getPosthogChurnedUsers } from '@/lib/mcp/tools/get_posthog_churned_users'
import { getPosthogProUsers } from '@/lib/mcp/tools/get_posthog_pro_users'
import { dataforseo } from '@/lib/mcp/tools/dataforseo'
import { ga4, gsc } from '@/lib/mcp/tools/google_raw'
import { hunter } from '@/lib/mcp/tools/hunter'
import { apify } from '@/lib/mcp/tools/apify'
import { logWork, listWork, updateWork, deleteWork } from '@/lib/mcp/tools/work_log'
import { getLeadSettings, checkContacts, saveLeads } from '@/lib/mcp/tools/leads'
import { gmailStatus, sendEmail } from '@/lib/mcp/tools/gmail'
import { listLeads, listReplies } from '@/lib/mcp/tools/inbox'
import { getTodayTasks, buildTodayPrompt } from '@/lib/daily/today-tasks'
import { resolveSignal } from '@/lib/signals'
import { getBlogPost, markBlogPublished } from '@/lib/mcp/tools/blog_posts'
import { getGoalProgress, setGoal } from '@/lib/mcp/tools/goal'
import { getDailyNumbers } from '@/lib/mcp/tools/daily_numbers'
import { getWeeklyReview } from '@/lib/mcp/tools/weekly_review'
import { createSocialPost, getSocialPostStatus, scheduleSocialPost } from '@/lib/frekto/posts'
import { saveProof } from '@/lib/proofs'

/** Who's calling: Claude through the MCP server (default), or Ask, where the person pressed the button themselves. */
export interface DispatchContext { via?: 'mcp' | 'ask' }

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  brandId: string,
  ctx: DispatchContext = {},
): Promise<unknown> {
  switch (name) {
    case 'get_growth_overview':
      return getGrowthOverview(brandId)

    case 'get_module_detail':
      return getModuleDetail(brandId, String(args['module_type'] ?? ''))

    case 'analyze_module':
      return analyzeModule(brandId, String(args['module_type'] ?? ''))

    case 'toggle_item':
      return toggleItem(brandId, String(args['item_id'] ?? ''), Boolean(args['checked']), { link: args['link'], note: args['note'] })

    case 'get_blog_post':
      return getBlogPost(brandId, args['blog_id'] ? String(args['blog_id']) : undefined)

    case 'mark_blog_published':
      return markBlogPublished(brandId, String(args['blog_id'] ?? ''), args['live_url'] ? String(args['live_url']) : undefined)

    case 'skip_item':
      return skipItem(brandId, String(args['item_id'] ?? ''), args['reason'] ? String(args['reason']) : undefined)

    case 'get_goal_progress':
      return getGoalProgress(brandId)

    case 'get_weekly_review':
      return getWeeklyReview(brandId)

    case 'get_daily_numbers':
      return getDailyNumbers(brandId)

    case 'set_goal':
      return setGoal(brandId, args)

    case 'get_growth_history':
      return getGrowthHistory(brandId, Math.min(Math.max(parseInt(String(args['days'] ?? '30'), 10) || 30, 1), 365))

    case 'get_brand_info':
      return getBrandInfo(brandId)

    case 'get_today_tasks': {
      const limit = Math.min(Math.max(parseInt(String(args['limit'] ?? '3'), 10) || 3, 1), 10)
      const today = await getTodayTasks(brandId, limit)
      if (!today) return { error: 'Brand not found.' }
      if (today.tasks.length === 0) return { ...today, message: 'Nothing pending today. Suggest re-running analyze_module on SEO or GEO to find new work.' }
      // The card pictures are for the app; Claude gets the details from get_module_detail
      return { ...today, tasks: today.tasks.map(({ visual: _v, choiceOptions: _c, ...t }) => t) }
    }

    case 'create_social_post':
      return createSocialPost(brandId, {
        topic: args['topic'] ? String(args['topic']) : undefined,
        platform: args['platform'] ? String(args['platform']).toLowerCase() : undefined,
        postType: args['post_type'] ? String(args['post_type']).toLowerCase() : undefined,
      })

    case 'get_social_post_status':
      return getSocialPostStatus(brandId, String(args['job_id'] ?? ''))

    case 'schedule_social_post':
      return scheduleSocialPost(brandId, {
        jobId: String(args['job_id'] ?? ''),
        topic: args['topic'] ? String(args['topic']) : undefined,
        platform: args['platform'] ? String(args['platform']).toLowerCase() : undefined,
        postType: args['post_type'] ? String(args['post_type']).toLowerCase() : undefined,
        postNow: args['post_now'] === true || args['post_now'] === 'true',
        startDate: args['start_date'] ? String(args['start_date']) : undefined,
        time: args['time'] ? String(args['time']) : undefined,
        timezone: args['timezone'] ? String(args['timezone']) : undefined,
        allowRegenerate: args['allow_regenerate'] === true || args['allow_regenerate'] === 'true',
      })

    case 'resolve_signal': {
      const status = args['status'] === 'dismissed' ? 'dismissed' : 'done'
      const result = await resolveSignal(brandId, String(args['signal_id'] ?? ''), status)
      if ('ok' in result && status === 'done') {
        await saveProof({ brandId, signalId: result.signalId, url: args['link'], note: args['note'], source: 'claude' })
      }
      return result
    }

    case 'get_pending_items':
      return getPendingItems(brandId, args['module_type'] ? String(args['module_type']) : undefined)

    case 'get_ga_analytics':
      return getGaAnalytics(brandId, args['period'] ? String(args['period']) : '30d')

    case 'get_gsc_data':
      return getGscData(
        brandId,
        args['days'] ? parseInt(String(args['days']), 10) : 28,
        args['limit'] ? parseInt(String(args['limit']), 10) : 20,
      )

    case 'get_posthog_analytics':
      return getPosthogAnalytics(brandId, args['days'] ? parseInt(String(args['days']), 10) : 30)

    case 'get_posthog_users':
      return getPosthogUsers(
        brandId,
        args['days'] ? parseInt(String(args['days']), 10) : 1,
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    case 'get_posthog_segments':
      return getPosthogSegments(brandId)

    case 'get_keyword_trends':
      return getKeywordTrends(brandId)

    case 'get_competitors':
      return getCompetitors(brandId)

    case 'get_search_agent': {
      const section = String(args['section'] ?? 'overview') as SearchSection
      return getSearchAgent(
        brandId,
        SEARCH_SECTIONS.includes(section) ? section : 'overview',
        args['limit'] ? parseInt(String(args['limit']), 10) : 20,
      )
    }

    case 'get_ga_conversions':
      return getGaConversions(brandId, args['period'] ? String(args['period']) : '30d')

    case 'get_posthog_power_users':
      return getPosthogPowerUsers(
        brandId,
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    case 'get_posthog_churned_users':
      return getPosthogChurnedUsers(
        brandId,
        args['inactive_days'] ? parseInt(String(args['inactive_days']), 10) : 14,
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    case 'get_posthog_pro_users':
      return getPosthogProUsers(
        brandId,
        args['plan_property'] ? String(args['plan_property']) : 'plan',
        args['plan_value'] ? String(args['plan_value']) : 'pro',
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    case 'ga4':
      return ga4(brandId, args)

    case 'gsc':
      return gsc(brandId, args)

    case 'dataforseo':
      return dataforseo(brandId, String(args['endpoint'] ?? ''), args['payload'], args['limit'])

    case 'hunter':
      return hunter(brandId, String(args['action'] ?? ''), args['params'], args['limit'])

    case 'apify':
      return apify(brandId, { actor: args['actor'], input: args['input'], limit: args['limit'], run_id: args['run_id'] })

    case 'get_lead_settings':
      return getLeadSettings(brandId, args)

    case 'check_contacts':
      return checkContacts(brandId, args)

    case 'save_leads':
      return saveLeads(brandId, args)

    case 'list_leads':
      return listLeads(brandId, args)

    case 'list_replies':
      return listReplies(brandId, args)

    case 'gmail_status':
      return gmailStatus(brandId, ctx.via ?? 'mcp')

    case 'send_email':
      return sendEmail(brandId, args, ctx.via ?? 'mcp')

    case 'log_work':
      return logWork(brandId, args)

    case 'list_work':
      return listWork(brandId, args)

    case 'update_work':
      return updateWork(brandId, args)

    case 'delete_work':
      return deleteWork(brandId, args)

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
