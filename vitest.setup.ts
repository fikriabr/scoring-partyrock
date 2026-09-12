// vitest.setup.ts
// `next/server`'s `after()` throws when called outside an active Next.js
// request scope (see https://nextjs.org/docs/messages/next-dynamic-api-wrong-context).
// Tests call service functions (CrawlerService, ScorerService, ingestCapture)
// directly, with no real HTTP request underneath them, so the real `after()`
// always throws there. Replace it with a stand-in that just runs the
// callback, keeping every other `next/server` export untouched.
import { vi } from 'vitest'

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (task: () => void | Promise<void>) => {
      void task()
    },
  }
})
