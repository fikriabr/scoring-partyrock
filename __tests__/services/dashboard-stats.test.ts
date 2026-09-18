/**
 * Unit Tests: getDashboardStats and getRecentSubmissions
 * (lib/services/dashboard.service.ts)
 *
 * getDashboardStats — status-breakdown counts must be zero-filled for
 * every enum value (a status with no rows should read 0, not be missing
 * from the object), and `stuckCount` must query with an OR across both
 * crawl and score being non-terminal, filtered to non-deleted projects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    event: { count: vi.fn() },
    category: { count: vi.fn() },
    user: { count: vi.fn() },
    project: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { db } from '@/lib/db'
import { getDashboardStats, getRecentSubmissions } from '@/lib/services/dashboard.service'

const mockEventCount = vi.mocked(db.event.count)
const mockCategoryCount = vi.mocked(db.category.count)
const mockUserCount = vi.mocked(db.user.count)
const mockProjectGroupBy = vi.mocked(db.project.groupBy)
const mockProjectCount = vi.mocked(db.project.count)
const mockProjectFindMany = vi.mocked(db.project.findMany)

beforeEach(() => {
  vi.clearAllMocks()
  mockEventCount.mockResolvedValue(3)
  mockCategoryCount.mockResolvedValue(5)
  mockUserCount.mockResolvedValue(4)
  mockProjectCount.mockResolvedValue(0)
  mockProjectGroupBy.mockResolvedValue([] as never)
})

describe('getDashboardStats', () => {
  it('zero-fills every crawl/score status, not just the ones with rows', async () => {
    mockProjectGroupBy
      .mockResolvedValueOnce([
        { crawlStatus: 'SUCCESS', _count: { _all: 7 } },
      ] as never)
      .mockResolvedValueOnce([
        { scoreStatus: 'FAILED', _count: { _all: 2 } },
      ] as never)

    const stats = await getDashboardStats()

    expect(stats.crawlStatusCounts).toEqual({
      PENDING: 0,
      PROCESSING: 0,
      SUCCESS: 7,
      FAILED: 0,
    })
    expect(stats.scoreStatusCounts).toEqual({
      PENDING: 0,
      PROCESSING: 0,
      PARTIAL: 0,
      SUCCESS: 0,
      FAILED: 2,
    })
    // totalSubmissions is derived from the crawl-status breakdown
    expect(stats.totalSubmissions).toBe(7)
  })

  it('queries stuckCount with deletedAt: null and an OR across both statuses', async () => {
    mockProjectCount.mockResolvedValueOnce(3)

    const stats = await getDashboardStats()

    expect(stats.stuckCount).toBe(3)
    expect(mockProjectCount).toHaveBeenCalledExactlyOnceWith({
      where: {
        deletedAt: null,
        OR: [
          { crawlStatus: { in: ['PENDING', 'PROCESSING'] } },
          { scoreStatus: { in: ['PENDING', 'PROCESSING'] } },
        ],
      },
    })
  })

  it('passes through the simple counts unchanged', async () => {
    const stats = await getDashboardStats()

    expect(stats.totalEvents).toBe(3)
    expect(stats.totalCategories).toBe(5)
    expect(stats.totalJury).toBe(4)
    expect(mockUserCount).toHaveBeenCalledExactlyOnceWith({ where: { role: 'JURY' } })
  })
})

describe('getRecentSubmissions', () => {
  it('excludes soft-deleted projects and orders newest first', async () => {
    mockProjectFindMany.mockResolvedValueOnce([] as never)

    await getRecentSubmissions(5)

    expect(mockProjectFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        category: { select: { name: true, event: { select: { name: true } } } },
      },
    })
  })

  it('flattens category/event names onto each row', async () => {
    mockProjectFindMany.mockResolvedValueOnce([
      {
        id: 'p1',
        participantName: 'Alice',
        teamName: null,
        crawlStatus: 'SUCCESS',
        scoreStatus: 'SUCCESS',
        finalScore: 88.5,
        createdAt: new Date('2026-01-01'),
        category: { name: 'Category A', event: { name: 'Event A' } },
      },
    ] as never)

    const result = await getRecentSubmissions()

    expect(result).toEqual([
      {
        id: 'p1',
        participantName: 'Alice',
        teamName: null,
        categoryName: 'Category A',
        eventName: 'Event A',
        crawlStatus: 'SUCCESS',
        scoreStatus: 'SUCCESS',
        finalScore: 88.5,
        createdAt: new Date('2026-01-01'),
      },
    ])
  })
})
