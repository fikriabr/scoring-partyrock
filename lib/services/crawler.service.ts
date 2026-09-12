// lib/services/crawler.service.ts
//
// Lightweight metadata crawler using plain HTTP fetch, no browser needed.
//
// AWS WAF blocks the internal getLatestAppVersion API call that PartyRock
// needs to render app-specific data (returns 403), so headless browser
// automation such as Playwright or Patchright cannot reliably extract
// widget or prompt data, even with stealth patches applied. PartyRock does
// render static SEO meta tags such as og:title and meta description on the
// server for link preview purposes, and those tags are reachable via a
// plain fetch request with no browser, no WAF challenge, fast execution,
// and compatibility with serverless platforms such as Vercel.
//
// Trade off: widgets and prompts are intentionally left empty here because
// that data requires the blocked internal API or full client side JS
// rendering. They are filled in afterwards by the manual capture pipeline —
// see lib/services/capture.service.ts and docs/CAPTURE.md — which reads them
// from a real, human-driven browser session instead. A project whose
// widgetCount is still 0 has not been captured yet, and its AI score rests on
// title and description alone.

import { after } from 'next/server'
import { db } from '@/lib/db'
import { ScorerService } from '@/lib/services/scorer.service'
import { Prisma } from '@prisma/client'
import type { WidgetInfo } from '@/types'

const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const DOUBLE_QUOTE = String.fromCharCode(34)

export interface CrawlOutcome {
  title: string | null
  description: string | null
  widgets: WidgetInfo[]
  prompts: string[]
  widgetCount: number
}

function buildMetaRegex(attr: string, key: string, contentFirst: boolean): RegExp {
  const q = DOUBLE_QUOTE
  const pair = contentFirst
    ? 'content=' + q + '([^' + q + ']*)' + q + '[^>]*' + attr + '=' + q + key + q
    : attr + '=' + q + key + q + '[^>]*content=' + q + '([^' + q + ']*)' + q
  return new RegExp('<meta[^>]*' + pair + '[^>]*>', 'i')
}

export class CrawlerService {
  /**
   * Fetch project, run crawl, persist CrawlMetadata, and update crawl status.
   */
  static async triggerCrawl(projectId: string): Promise<void> {
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { category: true },
    })

    console.log('[Crawler] Starting crawl for project ' + projectId + ' (' + project.url + ')')

    await db.project.update({
      where: { id: projectId },
      data: { crawlStatus: 'PROCESSING', crawlError: null },
    })

    console.log('[Crawler] Status set to PROCESSING')

    try {
      console.log('[Crawler] Fetching ' + project.url + '...')
      const metadata = await CrawlerService.crawl(project.url)

      console.log('[Crawler] Crawl succeeded - title: ' + metadata.title + ', widgets: ' + metadata.widgetCount + ', prompts: ' + metadata.prompts.length)

      const widgetsJson = metadata.widgets as unknown as Prisma.InputJsonValue
      const promptsJson = metadata.prompts as unknown as Prisma.InputJsonValue

      await db.crawlMetadata.upsert({
        where: { projectId },
        create: {
          projectId,
          title: metadata.title,
          description: metadata.description,
          widgets: widgetsJson,
          prompts: promptsJson,
          widgetCount: metadata.widgetCount,
        },
        update: {
          title: metadata.title,
          description: metadata.description,
          widgets: widgetsJson,
          prompts: promptsJson,
          widgetCount: metadata.widgetCount,
          crawledAt: new Date(),
        },
      })

      await db.project.update({
        where: { id: projectId },
        data: { crawlStatus: 'SUCCESS', crawlError: null },
      })

      console.log('[Crawler] Metadata saved. Status set to SUCCESS.')

      console.log('[Crawler] Triggering AI scoring for project ' + projectId + '...')
      // Registers this promise with the enclosing request's after() so it
      // also gets to finish, even though triggerCrawl's own returned promise
      // resolves without waiting for it.
      after(() => ScorerService.triggerScoring(projectId).catch(console.error))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown crawl error'
      console.error('[Crawler] Crawl FAILED for project ' + projectId + ': ' + message)
      await db.project.update({
        where: { id: projectId },
        data: { crawlStatus: 'FAILED', crawlError: message },
      })
    }
  }

  /**
   * Delete existing CrawlMetadata, reset scoreStatus to PENDING, then re-crawl.
   */
  static async retriggerCrawl(projectId: string): Promise<void> {
    console.log('[Crawler] Re-triggering crawl for project ' + projectId + ' - deleting old metadata')

    await db.crawlMetadata.deleteMany({ where: { projectId } })

    await db.project.update({
      where: { id: projectId },
      data: { scoreStatus: 'PENDING' },
    })

    await CrawlerService.triggerCrawl(projectId)
  }

  static decodeHtmlEntities(text: string): string {
    return text
      .replace(/&quot;/g, DOUBLE_QUOTE)
      .replace(/&#39;/g, String.fromCharCode(39))
      .replace(/&apos;/g, String.fromCharCode(39))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  static extractMetaTag(html: string, key: string, attr?: string): string | null {
    const a = attr || 'name'
    const regexAttrFirst = buildMetaRegex(a, key, false)
    const regexContentFirst = buildMetaRegex(a, key, true)
    const match = html.match(regexAttrFirst) || html.match(regexContentFirst)
    if (!match) return null
    return CrawlerService.decodeHtmlEntities(match[1])
  }

  /**
   * Fetch a URL over plain HTTP and return its body. The 15 second
   * `AbortController` deadline runs in `finally` so an aborted or rejected
   * fetch does not leave a timer behind.
   */
  private static async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error('Failed to fetch ' + url + ': HTTP ' + response.status)
      }

      return await response.text()
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Reads the static SEO meta tags (og:title, description) with regex
   * helpers. No browser automation is used because headless browsers are
   * blocked by AWS WAF at the internal API level. widgets/prompts are always
   * empty — that data is not present in the static HTML and would require
   * the blocked API or full JS rendering; they are filled in afterwards by
   * the manual capture pipeline.
   */
  static async crawl(url: string): Promise<CrawlOutcome> {
    const html = await CrawlerService.fetchHtml(url)

    const ogTitle =
      CrawlerService.extractMetaTag(html, 'og:title', 'property') ||
      CrawlerService.extractMetaTag(html, 'og:title', 'name')
    const titleTagMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const htmlTitle = titleTagMatch ? CrawlerService.decodeHtmlEntities(titleTagMatch[1].trim()) : null

    const title = ogTitle || htmlTitle

    const description =
      CrawlerService.extractMetaTag(html, 'description', 'name') ||
      CrawlerService.extractMetaTag(html, 'og:description', 'property')

    console.log('[Crawler] Extracted title: ' + title + ', description present: ' + (description !== null))

    return {
      title,
      description,
      widgets: [],
      prompts: [],
      widgetCount: 0,
    }
  }
}
