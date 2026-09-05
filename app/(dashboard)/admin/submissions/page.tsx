// app/(dashboard)/admin/submissions/page.tsx
// RSC page listing all submissions/projects with status badges.
// Provides single submission form and CSV bulk upload.
// Requirements: 1.7, 3.1, 3.2, 3.3, 3.4, 3.5, 4.3, 4.4

import Link from 'next/link'
import type { ProjectType } from '@prisma/client'
import { db } from '@/lib/db'
import SubmissionForm from '@/components/SubmissionForm'
import ProjectTypeBadge from '@/components/ProjectTypeBadge'
import { groupProjectsByCategory } from '@/lib/submission-grouping'

export default async function AdminSubmissionsPage() {
  // Fetch all categories (with event name for context)
  const categories = await db.category.findMany({
    orderBy: { name: 'asc' },
    include: { event: { select: { name: true } } },
  })

  // Fetch all projects with category info
  const projects = await db.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      category: {
        select: { id: true, name: true, event: { select: { name: true } } },
      },
    },
  })

  const serializedCategories = categories.map((c) => ({
    id: c.id,
    name: c.name,
    eventName: c.event.name,
  }))

  // The query above has no explicit `select`, so every Project column —
  // including projectType — is already loaded here. Requirements: 1.7
  const serializedProjects = projects.map((p) => ({
    id: p.id,
    url: p.url,
    projectType: p.projectType,
    participantName: p.participantName,
    teamName: p.teamName,
    crawlStatus: p.crawlStatus,
    scoreStatus: p.scoreStatus,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    eventName: p.category.event.name,
    createdAt: p.createdAt.toISOString(),
  }))

  // Group projects into one section per category (event + category name),
  // sorted by event then category. Empty categories never appear here.
  const groups = groupProjectsByCategory(serializedProjects)

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Submissions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Submit new projects or manage existing submissions
        </p>
      </div>

      {/* Client component handles single submission + CSV upload */}
      <SubmissionForm categories={serializedCategories} />

      {/* Project list table */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Projects ({serializedProjects.length})
        </h2>

        {serializedProjects.length === 0 ? (
          <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-100 text-center">
            <p className="text-gray-500 text-sm">No projects submitted yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.categoryId}>
                <h3 className="text-base font-semibold text-gray-800 mb-3">
                  {group.heading} ({group.projects.length})
                </h3>
                <ProjectsTable projects={group.projects} />
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// -----------------------------------------------------------------------
// SerializedProject — shape of a project row as rendered by this page
// -----------------------------------------------------------------------
type SerializedProject = {
  id: string
  url: string
  projectType: ProjectType
  participantName: string
  teamName: string | null
  crawlStatus: string
  scoreStatus: string
  categoryId: string
  categoryName: string
  eventName: string
  createdAt: string
}

// -----------------------------------------------------------------------
// ProjectsTable — card-wrapped, horizontally scrollable table of projects.
// Used per section so the header markup isn't duplicated.
// -----------------------------------------------------------------------
function ProjectsTable({ projects }: { projects: SerializedProject[] }) {
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
                Type
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
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------
// StatusBadge — renders a colored pill badge based on status enum value
// -----------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    PROCESSING: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    SUCCESS: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    FAILED: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    PARTIAL: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  }

  const colorClass =
    colors[status] ?? 'bg-gray-50 text-gray-700 ring-1 ring-gray-200'

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${colorClass}`}
    >
      {status}
    </span>
  )
}

// -----------------------------------------------------------------------
// ProjectRow — renders a table row for a single project with action buttons
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
      <td className="px-4 py-3 whitespace-nowrap">
        <ProjectTypeBadge projectType={project.projectType} />
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={project.crawlStatus} />
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={project.scoreStatus} />
      </td>
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
