import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { features } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { execSync } from 'child_process'
import path from 'path'

// POST /api/features/check-commits - Check git commits and auto-complete features
export async function POST(request: NextRequest) {
  try {
    const { days = 7 } = await request.json()

    // Get all incomplete features with keywords
    const incompleteFeatures = await db
      .select()
      .from(features)
      .where(eq(features.isCompleted, false))

    if (incompleteFeatures.length === 0) {
      return NextResponse.json({ message: 'No incomplete features to check', completed: [] })
    }

    const projectRoot = path.resolve(process.cwd(), '..')
    let gitLog = ''

    try {
      // Get commit history from last N days
      gitLog = execSync(
        `cd "${projectRoot}" && git log --all --pretty=format:"%h %s %b" --since="${days}d"`,
        {
          encoding: 'utf-8',
          stdio: 'pipe',
        },
      ).toLowerCase()
    } catch (error) {
      console.error('Failed to read git history:', error)
      return NextResponse.json(
        { error: 'Failed to read git history' },
        { status: 500 },
      )
    }

    const completed: string[] = []

    // Check each incomplete feature
    for (const feature of incompleteFeatures) {
      if (!feature.keywords) continue

      const keywords = feature.keywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)

      // Check if any keyword appears in recent commits
      const foundKeyword = keywords.some((keyword) => gitLog.includes(keyword))

      if (foundKeyword) {
        await db
          .update(features)
          .set({
            isCompleted: true,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(features.id, feature.id))

        completed.push(feature.name)
      }
    }

    return NextResponse.json({
      message: `Checked last ${days} days of commits`,
      completed,
      count: completed.length,
    })
  } catch (error) {
    console.error('Failed to check commits:', error)
    return NextResponse.json({ error: 'Failed to check commits' }, { status: 500 })
  }
}
