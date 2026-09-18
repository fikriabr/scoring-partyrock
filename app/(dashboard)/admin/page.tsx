// app/(dashboard)/admin/page.tsx
// Admin dashboard landing page: summary counts, crawl/score status
// breakdown, a "stuck processing" alert, and the most recent submissions.

import Link from 'next/link'
import { getDashboardStats, getRecentSubmissions } from '@/lib/services/dashboard.service'
import { StatusBadge } from '@/components/LiveProjectStatus'

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-3xl font-bold text-gray-900">{value}</div>
    </div>
  )
}

function StatusBreakdown({
  title,
  counts,
}: {
  title: string
  counts: Record<string, number>
}) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-4 space-y-3">
        {Object.entries(counts).map(([status, count]) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div key={status} className="flex items-center gap-3">
              <div className="w-28 shrink-0">
                <StatusBadge status={status} />
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-8 shrink-0 text-right text-sm font-medium text-gray-600">
                {count}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default async function AdminDashboardPage() {
  const [stats, recentSubmissions] = await Promise.all([
    getDashboardStats(),
    getRecentSubmissions(8),
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of events, submissions, and pipeline health
        </p>
      </div>

      {stats.stuckCount > 0 && (
        <Link
          href="/admin/submissions"
          className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
        >
          <span className="text-sm font-medium text-amber-800">
            ⚠️ {stats.stuckCount} submission{stats.stuckCount === 1 ? '' : 's'} still
            crawling/scoring — open Submissions to retry or cancel a stuck one.
          </span>
          <span className="text-sm font-medium text-amber-700">View →</span>
        </Link>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Events" value={stats.totalEvents} />
        <StatCard label="Categories" value={stats.totalCategories} />
        <StatCard label="Submissions" value={stats.totalSubmissions} />
        <StatCard label="Jury" value={stats.totalJury} />
      </div>

      {/* Status breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        <StatusBreakdown title="Crawl Status" counts={stats.crawlStatusCounts} />
        <StatusBreakdown title="Score Status" counts={stats.scoreStatusCounts} />
      </div>

      {/* Recent submissions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Submissions</h2>
          <Link
            href="/admin/submissions"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View all →
          </Link>
        </div>

        <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
          {recentSubmissions.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No submissions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Participant
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Crawl
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Score
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Final
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentSubmissions.map((project) => (
                    <tr key={project.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {project.participantName}
                        </div>
                        {project.teamName && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {project.teamName}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {project.eventName} — {project.categoryName}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={project.crawlStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={project.scoreStatus} />
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {project.finalScore != null ? project.finalScore.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center align-middle">
                        <Link
                          href={`/admin/submissions/${project.id}`}
                          className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
