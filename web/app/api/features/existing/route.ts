import { NextRequest, NextResponse } from 'next/server'
import { MODULE_REGISTRY } from '@/lib/modules/registry'

// GET /api/features/existing - Get all existing modules/features in the app
export async function GET() {
  try {
    const existingFeatures = MODULE_REGISTRY.map((module) => ({
      id: module.type,
      name: module.name,
      description: module.description,
      type: 'module',
      order: module.order,
    }))

    return NextResponse.json(existingFeatures)
  } catch (error) {
    console.error('Failed to fetch existing features:', error)
    return NextResponse.json(
      { error: 'Failed to fetch existing features' },
      { status: 500 },
    )
  }
}
