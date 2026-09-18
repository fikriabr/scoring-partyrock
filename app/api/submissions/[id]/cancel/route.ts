// app/api/submissions/[id]/cancel/route.ts
// API route handler for force-cancelling a project's crawl/score pipeline
// when it is stuck in PENDING/PROCESSING (e.g. the background job died
// without ever writing a terminal status — see lib/services/scorer.service.ts
// and lib/services/crawler.service.ts). Admin-only.

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/config'
import { handleApiError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { cancelProcessing } from '@/lib/services/submission.service'
import { db } from '@/lib/db'

// Rate limiter: 10 requests per 60 seconds per user
const limiter = rateLimit({ interval: 60_000, uniqueTokenPerInterval: 500 })

type RouteContext = { params: Promise<{ id: string }> }

// -----------------------------------------------------------------------
// POST /api/submissions/[id]/cancel — force PENDING/PROCESSING crawl/score
// statuses to FAILED so a stuck project unblocks (Retry becomes available
// again) instead of spinning forever.
// -----------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const session = await auth()
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Admin only', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    // Rate limit: 10 requests per minute per authenticated user
    limiter.check(10, session.user.id)

    const { id } = await context.params

    const project = await db.project.findUnique({
      where: { id, deletedAt: null },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Project not found', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const updated = await cancelProcessing(id)

    return NextResponse.json(updated)
  } catch (error) {
    return handleApiError(error)
  }
}
