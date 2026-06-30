import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { features } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// GET /api/features - List all features
export async function GET() {
  try {
    const allFeatures = await db.select().from(features).orderBy(features.createdAt)
    return NextResponse.json(allFeatures || [])
  } catch (error) {
    console.error('Failed to fetch features:', error)
    return NextResponse.json([], { status: 200 })
  }
}

// POST /api/features - Create new feature
export async function POST(request: NextRequest) {
  try {
    const { name, description, keywords, isCompleted, completedAt } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Feature name is required' }, { status: 400 })
    }

    const [feature] = await db
      .insert(features)
      .values({
        name: name.trim(),
        description: description?.trim() || null,
        keywords: keywords?.trim() || null,
        isCompleted: isCompleted || false,
        completedAt: isCompleted && completedAt ? new Date(completedAt) : null,
      })
      .returning()

    return NextResponse.json(feature, { status: 201 })
  } catch (error) {
    console.error('Failed to create feature:', error)
    return NextResponse.json({ error: 'Failed to create feature' }, { status: 500 })
  }
}
