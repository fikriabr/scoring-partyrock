// app/api/submissions/route.ts
// API route handler for creating a single project submission.
// Requirements: 3.1, 3.2, 3.3, 9.6

export const runtime = 'nodejs'
// Scoring runs one Gemini call per AUTO parameter (in parallel) after this
// route responds; give waitUntil() room to let that background work finish.
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { auth } from '@/lib/auth/config'
import { handleApiError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { submitProject, DuplicateUrlError } from '@/lib/services/submission.service'
import { ScorerService } from '@/lib/services/scorer.service'

// Rate limiter: 10 requests per 60 seconds per user
const limiter = rateLimit({ interval: 60_000, uniqueTokenPerInterval: 500 })

// -----------------------------------------------------------------------
// POST /api/submissions — Submit a single project
// -----------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required.', code: 'UNAUTHORIZED' },
        { status: 401 },
      )
    }

    // Rate limit: 10 requests per minute per authenticated user
    limiter.check(10, session.user.id)

    const body = await request.json()
    const project = await submitProject(body)

    // Kick off scoring without blocking the response. The project is created
    // with crawlStatus/scoreStatus = PENDING, so a caller who never sees this
    // promise settle still reads a truthful status. Widgets and prompts come
    // from the Capture Pipeline rather than a crawl, so scoring starts
    // immediately on whatever evidence was pasted at submission time.
    //
    // waitUntil() keeps the serverless function alive until this promise
    // settles even though the response below is already sent — without it,
    // Vercel freezes/tears down the function right after the response and
    // the scoring call gets killed mid-flight.
    waitUntil(ScorerService.triggerScoring(project.id).catch(console.error))

    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    // Handle duplicate URL errors with a 409 Conflict response
    if (error instanceof DuplicateUrlError) {
      return NextResponse.json(
        { error: 'Conflict', message: error.message, code: 'DUPLICATE_URL' },
        { status: 409 },
      )
    }

    return handleApiError(error)
  }
}
