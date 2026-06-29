import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { features } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// PATCH /api/features/[id] - Update feature
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { isCompleted, description, keywords } = await request.json()

    const updates: any = {
      updatedAt: new Date(),
    }

    if (typeof isCompleted === 'boolean') {
      updates.isCompleted = isCompleted
      updates.completedAt = isCompleted ? new Date() : null
    }

    if (description !== undefined) {
      updates.description = description?.trim() || null
    }

    if (keywords !== undefined) {
      updates.keywords = keywords?.trim() || null
    }

    const [feature] = await db
      .update(features)
      .set(updates)
      .where(eq(features.id, id))
      .returning()

    if (!feature) {
      return NextResponse.json({ error: 'Feature not found' }, { status: 404 })
    }

    return NextResponse.json(feature)
  } catch (error) {
    console.error('Failed to update feature:', error)
    return NextResponse.json({ error: 'Failed to update feature' }, { status: 500 })
  }
}

// DELETE /api/features/[id] - Delete feature
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await db
      .delete(features)
      .where(eq(features.id, id))
      .returning()

    if (result.length === 0) {
      return NextResponse.json({ error: 'Feature not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete feature:', error)
    return NextResponse.json({ error: 'Failed to delete feature' }, { status: 500 })
  }
}
