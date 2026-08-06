import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function resolveBrandFromToken(
  request: Request,
): Promise<{ brandId: string } | { error: string; status: number }> {
  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401 }
  }
  const token = authHeader.slice(7).trim()
  if (!token) return { error: 'Unauthorized', status: 401 }

  const [row] = await db
    .select({ brandId: brandIntegrations.brandId })
    .from(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.apiKey, token),
        eq(brandIntegrations.provider, 'mcp'),
        eq(brandIntegrations.status, 'connected'),
      ),
    )
    .limit(1)

  if (!row) return { error: 'Unauthorized', status: 401 }
  return { brandId: row.brandId }
}
