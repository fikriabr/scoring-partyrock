'use client'

// app/(dashboard)/admin/submissions/ProjectsTable.tsx
// Client component: card-wrapped, horizontally scrollable table of projects
// with an expand/collapse toggle. By default only the first COLLAPSED_ROWS
// rows are shown; a footer button reveals the rest ("Show all N") or hides
// them again ("Show less"). The toggle only appears when a table has more
// rows than the collapsed limit.

import Link from 'next/link'
import { useState } from 'react'
import { LiveProjectStatusProvider, LiveStatusBadge } from '@/components/LiveProjectStatus'

// -----------------------------------------------------------------------
// SerializedProject — shape of a project row as rendered by this table
// -----------------------------------------------------------------------
export type SerializedProject = {
  id: string
  url: string
  participantName: string
  teamName: string | null
  crawlStatus: string
  scoreStatus: string
  categoryId: string
  categoryName: string
  categoryCreatedAt: string
  eventName: string
  createdAt: string
}

// Number of rows shown while collapsed.
const COLLAPSED_ROWS = 5

// This list can render many rows at once, each polling independently, so it
// uses a much longer interval than the detail page's 1-second default —
// enough to notice a status change without hammering the API per row.
const STATUS_POLL_INTERVAL_MS = 5 * 60 * 1000

// -----------------------------------------------------------------------
// ProjectsTable — card-wrapped, horizontally scrollable table of projects.
// Used per section so the header markup isn't duplicated.
// -----------------------------------------------------------------------
export default function ProjectsTable({
  projects,
}: {
  projects: SerializedProject[]
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  const hasOverflow = projects.length > COLLAPSED_ROWS
  const visibleProjects =
    isExpanded || !hasOverflow ? projects : projects.slice(0, COLLAPSED_ROWS)
  const hiddenCount = projects.length - COLLAPSED_ROWS

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Participant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                URL
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Crawl
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Score
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visibleProjects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </tbody>
        </table>
      </div>

      {hasOverflow && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2 text-center">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            {isExpanded ? 'Show less' : `Show all ${projects.length}`}
            <span aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
          </button>
          {!isExpanded && (
            <span className="ml-2 text-xs text-gray-400">
              ({hiddenCount} hidden)
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------
// ProjectRow — renders a table row for a single project with action buttons.
// Crawl/score badges are wrapped in LiveProjectStatusProvider so they poll
// GET /api/submissions/[id] once a second while either is still
// PENDING/PROCESSING, and stop once both settle.
// -----------------------------------------------------------------------
function ProjectRow({ project }: { project: SerializedProject }) {
  return (
    <tr className="hover:bg-gray-50/50 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">
          {project.participantName}
        </div>
        {project.teamName && (
          <div className="text-xs text-gray-500 mt-0.5">{project.teamName}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-700 hover:underline text-xs break-all transition-colors"
        >
          {project.url}
        </a>
      </td>
      <LiveProjectStatusProvider
        projectId={project.id}
        initialCrawlStatus={project.crawlStatus}
        initialScoreStatus={project.scoreStatus}
        pollIntervalMs={STATUS_POLL_INTERVAL_MS}
      >
        <td className="px-4 py-3">
          <LiveStatusBadge field="crawl" />
        </td>
        <td className="px-4 py-3">
          <LiveStatusBadge field="score" />
        </td>
      </LiveProjectStatusProvider>
      {/*
        Actions cell — only "View" is exposed here; the retry crawl/score
        buttons are hidden on this list and remain available on the
        submission detail page (/admin/submissions/[projectId]).
      */}
      <td className="px-4 py-3 text-center align-middle">
        <div className="flex items-center justify-center">
          <Link
            href={`/admin/submissions/${project.id}`}
            className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            View
          </Link>
        </div>
      </td>
    </tr>
  )
}
