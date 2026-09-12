'use client'

// components/LiveProjectStatus.tsx
// Client-side live status for one project's crawl/score pipeline.
//
// `LiveProjectStatusProvider` polls GET /api/submissions/[id] on an
// interval (1 second by default; pass `pollIntervalMs` to change it — the
// submissions table uses 5 minutes since it can render many rows at once)
// while either status is still PENDING/PROCESSING, so admins watching a
// project see it move queued -> running -> done without reloading. Once
// both land on a terminal value, polling stops and the page is refreshed
// once so server-rendered content (AI scores, final score, crawl metadata,
// retry button disabled state) catches up too.
//
// `LiveStatusBadges` and `LiveRetryButtons` are separate consumers of the
// same context because they render in different parts of the detail page
// layout (badges in the header, retry actions in a footer row below) but
// need to share one poll loop and one "retry in flight" state — a retry
// click must resume polling immediately, before the server has even set
// status to PROCESSING (that happens inside `after()`, moments after the
// response comes back), so the badge is optimistically flipped to
// PROCESSING right away and the real value is confirmed on the next tick.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'

const NON_TERMINAL = new Set(['PENDING', 'PROCESSING'])
const DEFAULT_POLL_INTERVAL_MS = 1000

type ProjectStatus = {
  crawlStatus: string
  scoreStatus: string
}

function isTerminal(status: ProjectStatus): boolean {
  return !NON_TERMINAL.has(status.crawlStatus) && !NON_TERMINAL.has(status.scoreStatus)
}

type ContextValue = {
  status: ProjectStatus
  isRetrying: boolean
  retryScoring: () => void
}

const LiveProjectStatusContext = createContext<ContextValue | null>(null)

export function LiveProjectStatusProvider({
  projectId,
  initialCrawlStatus,
  initialScoreStatus,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  children,
}: {
  projectId: string
  initialCrawlStatus: string
  initialScoreStatus: string
  pollIntervalMs?: number
  children: ReactNode
}) {
  const [status, setStatus] = useState<ProjectStatus>({
    crawlStatus: initialCrawlStatus,
    scoreStatus: initialScoreStatus,
  })
  const [isRetrying, setIsRetrying] = useState(false)
  const router = useRouter()
  // Guards against refreshing more than once for the same non-terminal run.
  const hasRefreshedRef = useRef(false)

  useEffect(() => {
    if (isTerminal(status)) return

    hasRefreshedRef.current = false

    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`/api/submissions/${projectId}`)
        if (!response.ok) return

        const data: ProjectStatus = await response.json()
        setStatus(data)

        if (isTerminal(data) && !hasRefreshedRef.current) {
          hasRefreshedRef.current = true
          router.refresh()
        }
      } catch {
        // Transient network error — the next tick retries.
      }
    }, pollIntervalMs)

    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pollIntervalMs, status.crawlStatus, status.scoreStatus])

  const retryScoring = useCallback(() => {
    setIsRetrying(true)
    fetch(`/api/score/${projectId}`, { method: 'POST' })
      .then(() => {
        // Optimistically mark scoring as running so the badge and poll loop
        // react immediately — the real PROCESSING write happens moments
        // later, inside the route's after().
        setStatus((prev) => ({ ...prev, scoreStatus: 'PROCESSING' }))
        router.refresh()
      })
      .finally(() => setIsRetrying(false))
  }, [projectId, router])

  return (
    <LiveProjectStatusContext.Provider value={{ status, isRetrying, retryScoring }}>
      {children}
    </LiveProjectStatusContext.Provider>
  )
}

function useLiveProjectStatusContext(): ContextValue {
  const ctx = useContext(LiveProjectStatusContext)
  if (!ctx) {
    throw new Error(
      'LiveStatusBadges/LiveRetryButtons must be rendered inside a LiveProjectStatusProvider',
    )
  }
  return ctx
}

// -----------------------------------------------------------------------
// Spinner — small inline spinner shown next to a badge that is actively
// PENDING/PROCESSING.
// -----------------------------------------------------------------------
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"
    />
  )
}

// -----------------------------------------------------------------------
// StatusBadge — colored pill for a single status value, with a spinner
// appended while the status is non-terminal. Exported standalone too, for
// places (e.g. the submissions list table) that show a static status
// without wiring up the live-polling provider.
// -----------------------------------------------------------------------
export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    PROCESSING: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    SUCCESS: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    FAILED: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    PARTIAL: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  }

  const colorClass = colors[status] ?? 'bg-gray-50 text-gray-700 ring-1 ring-gray-200'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${colorClass}`}
    >
      {NON_TERMINAL.has(status) && <Spinner />}
      {status}
    </span>
  )
}

// -----------------------------------------------------------------------
// LiveStatusBadges — crawl + score badges together, driven by the poll
// loop. For layouts (like the detail page header) where both sit side by
// side in the same spot.
// -----------------------------------------------------------------------
export function LiveStatusBadges() {
  const { status } = useLiveProjectStatusContext()
  return (
    <>
      <StatusBadge status={status.crawlStatus} />
      <StatusBadge status={status.scoreStatus} />
    </>
  )
}

// -----------------------------------------------------------------------
// LiveStatusBadge — a single crawl OR score badge, driven by the same poll
// loop. For layouts (like the submissions table) where crawl and score
// render in separate table cells rather than side by side.
// -----------------------------------------------------------------------
export function LiveStatusBadge({ field }: { field: 'crawl' | 'score' }) {
  const { status } = useLiveProjectStatusContext()
  return (
    <StatusBadge status={field === 'crawl' ? status.crawlStatus : status.scoreStatus} />
  )
}

// -----------------------------------------------------------------------
// LiveRetryButtons — retry-score button wired to the same poll loop so
// clicking it resumes live polling immediately. There is no retry-crawl
// button: crawling PartyRock apps only works through the manual capture
// pipeline (`npm run capture`), not the HTTP crawler, so retriggering it
// from here would never do anything useful.
// -----------------------------------------------------------------------
export function LiveRetryButtons() {
  const { status, isRetrying, retryScoring } = useLiveProjectStatusContext()

  return (
    <button
      type="button"
      onClick={retryScoring}
      disabled={status.scoreStatus === 'PROCESSING' || isRetrying}
      className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
        status.scoreStatus === 'PROCESSING' || isRetrying
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
      }`}
    >
      {isRetrying ? '...' : 'Retry Score'}
    </button>
  )
}
