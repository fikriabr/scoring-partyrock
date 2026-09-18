// lib/services/dashboard.service.ts
// Read-only aggregates for the admin dashboard landing page (/admin).

import { db } from '@/lib/db'
import type { CrawlStatus, ScoreStatus } from '@prisma/client'

export type StatusCounts<S extends string> = Record<S, number>

export type DashboardStats = {
  totalEvents: number
  totalCategories: number
  totalSubmissions: number
  totalJury: number
  /** Projects whose crawl and/or score pipeline is still PENDING/PROCESSING. */
  stuckCount: number
  crawlStatusCounts: StatusCounts<CrawlStatus>
  scoreStatusCounts: StatusCounts<ScoreStatus>
}

const CRAWL_STATUSES: CrawlStatus[] = ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED']
const SCORE_STATUSES: ScoreStatus[] = ['PENDING', 'PROCESSING', 'PARTIAL', 'SUCCESS', 'FAILED']
const NON_TERMINAL_CRAWL: CrawlStatus[] = ['PENDING', 'PROCESSING']
const NON_TERMINAL_SCORE: ScoreStatus[] = ['PENDING', 'PROCESSING']

function zeroFilledCounts<S extends string>(
  statuses: S[],
  groups: { count: number; status: S }[],
): StatusCounts<S> {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0])) as StatusCounts<S>
  for (const g of groups) counts[g.status] = g.count
  return counts
}

// -----------------------------------------------------------------------
// getDashboardStats
// Counts used by the summary cards and status-breakdown bars. Soft-deleted
// projects (deletedAt set) are excluded everywhere, same as the rest of
// the app.
// -----------------------------------------------------------------------
export async function getDashboardStats(): Promise<DashboardStats> {
  const [totalEvents, totalCategories, totalJury, crawlGroups, scoreGroups, stuckCount] =
    await Promise.all([
      db.event.count(),
      db.category.count(),
      db.user.count({ where: { role: 'JURY' } }),
      db.project.groupBy({
        by: ['crawlStatus'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      db.project.groupBy({
        by: ['scoreStatus'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      db.project.count({
        where: {
          deletedAt: null,
          OR: [
            { crawlStatus: { in: NON_TERMINAL_CRAWL } },
            { scoreStatus: { in: NON_TERMINAL_SCORE } },
          ],
        },
      }),
    ])

  const crawlStatusCounts = zeroFilledCounts(
    CRAWL_STATUSES,
    crawlGroups.map((g) => ({ status: g.crawlStatus, count: g._count._all })),
  )
  const scoreStatusCounts = zeroFilledCounts(
    SCORE_STATUSES,
    scoreGroups.map((g) => ({ status: g.scoreStatus, count: g._count._all })),
  )

  const totalSubmissions = Object.values(crawlStatusCounts).reduce(
    (sum, n) => sum + n,
    0,
  )

  return {
    totalEvents,
    totalCategories,
    totalSubmissions,
    totalJury,
    stuckCount,
    crawlStatusCounts,
    scoreStatusCounts,
  }
}

export type RecentSubmission = {
  id: string
  participantName: string
  teamName: string | null
  categoryName: string
  eventName: string
  crawlStatus: CrawlStatus
  scoreStatus: ScoreStatus
  finalScore: number | null
  createdAt: Date
}

// -----------------------------------------------------------------------
// getRecentSubmissions
// The most recently created non-deleted projects, newest first.
// -----------------------------------------------------------------------
export async function getRecentSubmissions(limit = 8): Promise<RecentSubmission[]> {
  const projects = await db.project.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      category: { select: { name: true, event: { select: { name: true } } } },
    },
  })

  return projects.map((p) => ({
    id: p.id,
    participantName: p.participantName,
    teamName: p.teamName,
    categoryName: p.category.name,
    eventName: p.category.event.name,
    crawlStatus: p.crawlStatus,
    scoreStatus: p.scoreStatus,
    finalScore: p.finalScore,
    createdAt: p.createdAt,
  }))
}
