'use client'

// components/DeleteProjectButton.tsx
// Soft-deletes a project (stamps `deletedAt` — see deleteProject in
// lib/services/submission.service.ts; crawl metadata, AI scores and jury
// scores are kept, not removed) after a native confirm dialog, then sends
// the admin back to the submissions list.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteProjectButton({
  projectId,
  participantName,
}: {
  projectId: string
  participantName: string
}) {
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()

  async function handleClick() {
    const confirmed = window.confirm(
      `Delete the submission from "${participantName}"? It will disappear from all lists and leaderboards. Its data isn't erased — a developer can restore it directly in the database if needed.`,
    )
    if (!confirmed) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/submissions/${projectId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        window.alert('Failed to delete the submission. Please try again.')
        return
      }
      router.push('/admin/submissions')
      router.refresh()
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDeleting}
      className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
        isDeleting
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-red-50 text-red-700 hover:bg-red-100'
      }`}
    >
      {isDeleting ? 'Deleting...' : 'Delete'}
    </button>
  )
}
