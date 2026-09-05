// components/SourceCodeEditor.tsx
// Post-submit Source Code editor, shown on the project detail page for BOTH
// project types (Requirement 5.1) — unlike `CaptureImportPanel`, which is
// PartyRock-only (Requirement 5.5).
//
// This is the escape hatch for an HTML project whose URL the crawler cannot
// fetch, and the correction path for a PartyRock project whose captured
// payload came out wrong. Saving posts to `PATCH /api/submissions/[id]`, which
// stores the value, flips `scoreStatus` to PENDING and re-triggers scoring.
//
// Requirements: 5.1, 5.6

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
// Prisma-free module: the constant cannot come from `@/lib/validators/schemas`,
// which imports the Prisma enums as values and would pull the Prisma runtime
// into the client bundle. Requirements: 5.3
import { MAX_SOURCE_CODE_LENGTH } from '@/lib/validators/source-code-rules'
// Shared display label, so this panel names a project type the same way the
// submissions list, the detail header and the submission form do.
import { projectTypeLabel } from '@/lib/project-type'
// Type-only import: the Prisma runtime never reaches the client bundle.
import type { ProjectType } from '@prisma/client'

/**
 * Copy that depends on the project type. Keyed by the enum so adding a project
 * type makes this map fail to typecheck rather than silently falling back to
 * PartyRock wording.
 */
const PROJECT_TYPE_COPY: Record<
  ProjectType,
  { help: string; placeholder: string }
> = {
  PARTYROCK: {
    help: 'Isi dengan konfigurasi widget, prompt, atau source hasil capture. Ini evidence utama yang dinilai AI.',
    placeholder:
      'Tempel konfigurasi widget / prompt / source hasil capture di sini...',
  },
  HTML: {
    help: 'Isi dengan markup HTML halaman. Dipakai bila URL project tidak bisa di-fetch, dan menggantikan markup hasil crawl.',
    placeholder: 'Tempel markup HTML halaman di sini...',
  },
}

interface SourceCodeEditorProps {
  projectId: string
  /** Current column value. `null` when nothing has been stored yet. */
  sourceCode: string | null
  projectType: ProjectType
}

export default function SourceCodeEditor({
  projectId,
  sourceCode,
  projectType,
}: SourceCodeEditorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // The stored value, normalised to the empty string so the textarea stays
  // controlled. Kept as its own state (rather than read off the prop) so the
  // "unchanged" comparison below still works between the successful PATCH and
  // the moment `router.refresh()` delivers fresh props.
  const [saved, setSaved] = useState(sourceCode ?? '')
  const [draft, setDraft] = useState(sourceCode ?? '')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  )

  const copy = PROJECT_TYPE_COPY[projectType]
  const isUnchanged = draft === saved
  const isTooLong = draft.length > MAX_SOURCE_CODE_LENGTH

  function handleSave() {
    setMessage(null)

    startTransition(async () => {
      try {
        const res = await fetch(`/api/submissions/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // Blank input is sent as `null` rather than `''`: an empty column is
          // "no evidence", which is what the scorer and the indicator below
          // both read. The server normalises whitespace-only input the same
          // way, so the two agree.
          body: JSON.stringify({ sourceCode: draft.trim() === '' ? null : draft }),
        })

        // Not every failure carries a JSON body (a proxy 502, an HTML error
        // page), so parsing is allowed to fail without masking the status.
        const body = await res.json().catch(() => null)

        if (!res.ok) {
          setMessage({ kind: 'error', text: errorText(res.status, body) })
          return
        }

        // Response shape: { id, sourceCode, scoreStatus }. Trust the server's
        // normalised value over the local draft, so the counter and the
        // indicator show what is actually stored.
        const stored: string =
          typeof body?.sourceCode === 'string' ? body.sourceCode : ''
        setSaved(stored)
        setDraft(stored)
        setMessage({
          kind: 'ok',
          text: 'Source Code tersimpan. Skor AI sedang diperbarui — muat ulang beberapa saat lagi untuk melihat hasilnya.',
        })
        router.refresh()
      } catch {
        setMessage({ kind: 'error', text: 'Network error. Coba lagi.' })
      }
    })
  }

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Source Code</h3>
        {/* Availability + size indicator, for both project types.
            Requirements: 5.6 */}
        {saved.length > 0 ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            tersedia ({saved.length.toLocaleString()} karakter)
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
            belum ada (0 karakter)
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-gray-500">
        {copy.help} Project ini bertipe{' '}
        <span className="font-medium text-gray-700">
          {projectTypeLabel(projectType)}
        </span>
        . Menyimpan perubahan memicu ulang AI scoring.
      </p>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={10}
        spellCheck={false}
        maxLength={MAX_SOURCE_CODE_LENGTH}
        placeholder={copy.placeholder}
        className="mt-4 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-xs transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />

      <div className="mt-1.5 flex justify-end text-xs text-gray-400">
        <p className={`shrink-0 tabular-nums ${isTooLong ? 'text-red-600' : ''}`}>
          {draft.length.toLocaleString()} /{' '}
          {MAX_SOURCE_CODE_LENGTH.toLocaleString()}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          // Disabled while unchanged: saving an identical value would reset the
          // AI score to PENDING and burn an AI call for no new evidence. An
          // admin who wants a plain re-score has the separate "Retry Score"
          // button on this page, which does exactly that without touching the
          // column.
          disabled={isPending || isUnchanged || isTooLong}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Menyimpan...' : 'Simpan & Score Ulang'}
        </button>

        {draft !== saved && !isPending && (
          <button
            type="button"
            onClick={() => {
              setDraft(saved)
              setMessage(null)
            }}
            className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Batalkan Perubahan
          </button>
        )}

        {message && (
          <span
            className={`text-sm ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Turns a failed PATCH into a message an admin can act on.
 *
 * The endpoint's own `message` is preferred — it is the most specific text
 * available, and for a 400 it names the actual validation problem. The
 * per-status fallbacks exist because a response without a usable body must
 * still say what went wrong rather than degrade to a generic "gagal".
 */
function errorText(status: number, body: unknown): string {
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? (body as { message?: unknown }).message
      : undefined

  if (typeof message === 'string' && message.trim() !== '') {
    if (status === 403) return `Akses ditolak: ${message}`
    if (status === 404) return `Project tidak ditemukan: ${message}`
    return message
  }

  switch (status) {
    case 400:
      return 'Source Code tidak valid — periksa panjangnya lalu coba lagi.'
    case 403:
      return 'Akses ditolak. Hanya Admin yang boleh mengubah Source Code.'
    case 404:
      return 'Project tidak ditemukan. Mungkin sudah dihapus — muat ulang halaman.'
    case 429:
      return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.'
    default:
      return `Gagal menyimpan (HTTP ${status}).`
  }
}
