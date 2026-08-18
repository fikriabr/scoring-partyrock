// app/api/submissions/bulk/route.ts
// API route handler for bulk CSV import of project submissions.
// Admin-only + rate limited.
// Requirements: 3.4, 3.5, 9.6

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/config'
import { handleApiError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { bulkImportFromCsv } from '@/lib/services/submission.service'
import { CrawlerService } from '@/lib/services/crawler.service'
import { db } from '@/lib/db'

// Rate limiter: 10 requests per 60 seconds per user
const limiter = rateLimit({ interval: 60_000, uniqueTokenPerInterval: 500 })

// -----------------------------------------------------------------------
// POST /api/submissions/bulk — Bulk import via CSV file upload
// Expects multipart/form-data with:
//   - file: CSV file
//   - categoryId: target category ID
// -----------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    // Admin-only guard
    if (!session?.user?.id || session.user.role !== 'ADMIN') {
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'Authentication required.', code: 'UNAUTHORIZED' },
          { status: 401 },
        )
      }
      return NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    // Rate limit: 10 requests per minute per authenticated user
    limiter.check(10, session.user.id)

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file')
    const categoryId = formData.get('categoryId')

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Validation Error', message: 'CSV file is required.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    if (!categoryId || typeof categoryId !== 'string' || categoryId.trim() === '') {
      return NextResponse.json(
        { error: 'Validation Error', message: 'Category ID is required.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    // Read CSV content from the uploaded file
    const csvText = await file.text()

    if (!csvText.trim()) {
      return NextResponse.json(
        { error: 'Validation Error', message: 'CSV file is empty.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    // Import valid rows and collect errors
    const result = await bulkImportFromCsv(csvText, categoryId.trim())

    // Trigger crawling for all newly imported projects (fire-and-forget)
    // if (result.imported > 0) {
    //   // Fetch recently created PENDING projects in this category to trigger crawl
    //   const pendingProjects = await db.project.findMany({
    //     where: {
    //       categoryId: categoryId.trim(),
    //       crawlStatus: 'PENDING',
    //     },
    //     select: { id: true },
    //     orderBy: { createdAt: 'desc' },
    //     take: result.imported,
    //   })

    //   for (const project of pendingProjects) {
    //     CrawlerService.triggerCrawl(project.id).catch(console.error)
    //   }
    // }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return handleApiError(error)
  }
}
