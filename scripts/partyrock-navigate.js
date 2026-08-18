#!/usr/bin/env node
/*
 * scripts/partyrock-navigate.js
 *
 * Navigation automation — deliberately NOT interaction automation.
 *
 * What it automates
 * -----------------
 * Opening each submitted PartyRock URL in a real, visible Chrome window and
 * injecting `public/partyrock-capture.js`. That is the boring part: with 30
 * to 100 submissions, opening and closing tabs by hand is where the time goes.
 *
 * What stays manual, on purpose
 * -----------------------------
 * Clicking widgets to trigger AI generation. That needs a semantic reading of
 * each app — which widget produces the output worth judging differs per app,
 * and no selector generalises across them. It is also exactly the human
 * presence that keeps the session ordinary: this script never calls a
 * WAF-protected endpoint, never replays an internal API, and never drives a
 * widget. It opens pages a logged-in human then uses normally.
 *
 * That split is what keeps the risk low. Everything this script touches is
 * page navigation; everything the WAF actually guards is left to the human.
 *
 * Usage
 * -----
 *   npm run capture                      # every project still missing widgets
 *   npm run capture -- --all             # including already-captured ones
 *   npm run capture -- --category <id>   # one category only
 *   npm run capture -- --limit 10        # first 10 of the queue
 *   npm run capture -- --urls list.txt   # explicit URL list, one per line
 *
 * Environment (.env)
 * ------------------
 *   CAPTURE_TOKEN       shared secret, must match the running app
 *   APP_BASE_URL        default http://localhost:3000
 *   PR_CHROME_PROFILE   Chrome user-data-dir to reuse. Defaults to a
 *                       dedicated folder in this repo so your everyday Chrome
 *                       profile is never locked or modified. Point it at your
 *                       real profile only if you understand that Chrome must
 *                       be fully closed first.
 */

import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env') })

const CAPTURE_SCRIPT = path.join(projectRoot, 'public', 'partyrock-capture.js')
const DEFAULT_PROFILE_DIR = path.join(projectRoot, '.pr-chrome-profile')

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const CAPTURE_TOKEN = (process.env.CAPTURE_TOKEN || '').trim()
const PROFILE_DIR = process.env.PR_CHROME_PROFILE || DEFAULT_PROFILE_DIR

/**
 * Which profile inside the user-data-dir to open, e.g. "Default" or
 * "Profile 3". Chrome keeps every profile under one user-data-dir and picks
 * between them with --profile-directory; without this, a real User Data
 * folder always opens as "Default", which may not be the signed-in one.
 */
const PROFILE_NAME = (process.env.PR_CHROME_PROFILE_DIR || '').trim()

const usingRealProfile = PROFILE_DIR !== DEFAULT_PROFILE_DIR

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { all: false, category: null, limit: null, urls: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--all') args.all = true
    else if (arg === '--category') args.category = argv[++i]
    else if (arg === '--limit') args.limit = Number(argv[++i])
    else if (arg === '--urls') args.urls = argv[++i]
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(
    [
      'Usage: npm run capture -- [options]',
      '',
      '  --all              include projects that already have captured widgets',
      '  --category <id>    restrict to one category',
      '  --limit <n>        stop after n projects',
      '  --urls <file>      use a text file of URLs instead of the app queue',
    ].join('\n'),
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Worklist
// ---------------------------------------------------------------------------

/**
 * Is a Chrome process already running?
 *
 * Only used to produce a clear message before launching against a real
 * profile — a false negative just falls through to Playwright's own error.
 */
async function isChromeRunning() {
  const { exec } = await import('node:child_process')
  const command =
    process.platform === 'win32'
      ? 'tasklist /FI "IMAGENAME eq chrome.exe" /NH'
      : 'pgrep -x "Google Chrome" || pgrep -x chrome'

  return new Promise((resolve) => {
    exec(command, (error, stdout) => {
      if (error) return resolve(false)
      resolve(/chrome/i.test(stdout || ''))
    })
  })
}

/** Read the queue from the running app, or from a plain URL file. */
async function loadQueue() {
  if (args.urls) {
    const raw = await readFile(path.resolve(process.cwd(), args.urls), 'utf8')
    const urls = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    return urls.map((url) => ({ url, participantName: '(from file)', categoryName: '—' }))
  }

  const params = new URLSearchParams()
  if (!args.all) params.set('pending', '1')
  if (args.category) params.set('categoryId', args.category)

  const endpoint = `${APP_BASE_URL}/api/capture/queue?${params.toString()}`
  let response
  try {
    response = await fetch(endpoint, { headers: { 'X-Capture-Token': CAPTURE_TOKEN } })
  } catch (error) {
    throw new Error(
      `Could not reach ${endpoint}. Is the dev server running (npm run dev)?\n  ${error.message}`,
    )
  }

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Queue request failed (HTTP ${response.status}): ${body.message || ''}`)
  }

  return body.projects || []
}

/** POST one capture payload to the scoring app. */
async function postCapture(payload) {
  const response = await fetch(`${APP_BASE_URL}/api/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Capture-Token': CAPTURE_TOKEN,
    },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!CAPTURE_TOKEN) {
    console.error(
      'CAPTURE_TOKEN is not set in .env.\n' +
        'Generate one and add it to both .env and your shell, e.g.\n' +
        '  CAPTURE_TOKEN="' + Math.random().toString(36).slice(2) + Date.now().toString(36) + '"',
    )
    process.exit(1)
  }

  if (!existsSync(CAPTURE_SCRIPT)) {
    console.error(`Capture script not found at ${CAPTURE_SCRIPT}`)
    process.exit(1)
  }

  let queue = await loadQueue()
  if (args.limit && Number.isFinite(args.limit)) queue = queue.slice(0, args.limit)

  if (queue.length === 0) {
    console.log('Nothing to capture — every project already has widget data.')
    console.log('Run with --all to revisit projects that were already captured.')
    return
  }

  console.log(`\n${queue.length} project(s) to visit.`)
  console.log(`Chrome profile: ${PROFILE_DIR}${PROFILE_NAME ? ` (${PROFILE_NAME})` : ''}`)

  if (usingRealProfile) {
    // Chrome holds an exclusive lock on a user-data-dir while it runs, so a
    // real profile cannot be shared with an open Chrome window. Failing here
    // with an explanation beats Playwright's opaque "Target closed".
    if (await isChromeRunning()) {
      throw new Error(
        'Chrome is already running, and PR_CHROME_PROFILE points at a real\n' +
          'Chrome profile. Chrome locks its profile folder while open.\n\n' +
          'Close every Chrome window (check the tray, and Task Manager for\n' +
          'leftover chrome.exe) and run npm run capture again.\n\n' +
          'To avoid closing Chrome each time, clone the profile instead:\n' +
          '  npm run capture:clone-profile\n' +
          'then remove PR_CHROME_PROFILE from .env.',
      )
    }
  } else {
    console.log('First run: sign in to PartyRock in the window that opens. The')
    console.log('session persists in that folder, so later runs skip the login.')
    console.log('If Google refuses to sign in there, see docs/CAPTURE.md —')
    console.log('cloning your real profile avoids the login entirely.\n')
  }

  const launchArgs = ['--start-maximized']
  if (PROFILE_NAME) launchArgs.push(`--profile-directory=${PROFILE_NAME}`)

  let context
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      args: launchArgs,
    })
  } catch (error) {
    throw new Error(
      `Could not launch Chrome with profile "${PROFILE_DIR}".\n  ${error.message.split('\n')[0]}\n\n` +
        'If Chrome is installed somewhere unusual, or this is a real profile\n' +
        'that is still locked, see docs/CAPTURE.md.',
    )
  }

  // Injected before any page script runs, so the in-page fetch/XHR hooks are
  // installed in time to observe the app definition request.
  await context.addInitScript(
    ({ apiUrl, token }) => {
      window.__PR_CAPTURE_CONFIG = { apiUrl, token, postFromPage: false }
    },
    { apiUrl: `${APP_BASE_URL}/api/capture`, token: CAPTURE_TOKEN },
  )
  await context.addInitScript({ path: CAPTURE_SCRIPT })

  const summary = { sent: 0, skipped: 0, failed: 0, noMatch: 0 }

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]
    const position = `[${i + 1}/${queue.length}]`
    console.log(`\n${position} ${item.participantName} — ${item.categoryName}`)
    console.log(`        ${item.url}`)

    const page = await context.newPage()

    // Browser-level safety net: some JSON never passes through the page's own
    // fetch/XHR (service worker, preloads). Anything seen here is pushed into
    // the page so one set of extraction walkers handles everything.
    page.on('response', async (response) => {
      try {
        const contentType = response.headers()['content-type'] || ''
        if (!contentType.includes('json')) return
        const body = await response.json()
        await page.evaluate(
          ([url, parsed]) => {
            if (typeof window.__prCaptureIngest === 'function') {
              window.__prCaptureIngest(url, parsed)
            }
          },
          [response.url(), body],
        )
      } catch {
        // Response already consumed, navigated away, or not really JSON.
      }
    })

    try {
      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    } catch (error) {
      console.log(`        Could not open the page: ${error.message}`)
      summary.failed++
      await page.close().catch(() => {})
      continue
    }

    // A real Chrome profile restores its previous session on launch, so the
    // automation tab can end up behind the windows the user already had open —
    // looking exactly like "the URL never opened". Raise it explicitly.
    await page.bringToFront().catch(() => {})

    // Report where the tab actually landed. PartyRock redirects to a sign-in
    // page when the session is not valid, and that redirect is otherwise
    // invisible from the terminal.
    const landedUrl = page.url()
    if (!/(^|\.)partyrock\.aws$/.test(new URL(landedUrl).hostname)) {
      console.log(`        Redirected off PartyRock → ${landedUrl}`)
      console.log('        (usually a sign-in wall — see docs/CAPTURE.md)')
    } else if (landedUrl !== item.url) {
      console.log(`        Opened as ${landedUrl}`)
    }

    console.log('        Click the widgets to generate output, then press')
    console.log('        "Kirim & Lanjut" in the panel (bottom right).')

    let state = 'skipped'
    try {
      // No timeout: the human decides when this app is done.
      await page.waitForFunction(() => window.__PR_CAPTURE_STATE !== '', null, {
        timeout: 0,
      })
      state = await page.evaluate(() => window.__PR_CAPTURE_STATE)
    } catch (error) {
      console.log(`        Page closed before capture (${error.message.split('\n')[0]}).`)
      summary.skipped++
      await page.close().catch(() => {})
      continue
    }

    if (state === 'skipped') {
      console.log('        Skipped.')
      summary.skipped++
      await page.close().catch(() => {})
      continue
    }

    let payload
    try {
      payload = await page.evaluate(() => window.__partyRockCapture())
    } catch (error) {
      console.log(`        Could not read the capture: ${error.message}`)
      summary.failed++
      await page.close().catch(() => {})
      continue
    }

    // Keep the submitted URL as the identity: PartyRock rewrites the address
    // bar (app rename, share redirect) and the payload URL may no longer match
    // what the participant submitted.
    if (item.url) payload.url = item.url
    if (item.categoryId) payload.categoryId = item.categoryId

    const result = await postCapture(payload)
    if (result.ok) {
      console.log(
        `        Saved — ${payload.widgets.length} widget, ` +
          `${payload.prompts.length} prompt, ${payload.outputs.length} output. Scoring started.`,
      )
      summary.sent++
    } else if (result.body?.code === 'NO_MATCHING_PROJECT') {
      console.log(`        ${result.body.message}`)
      summary.noMatch++
    } else {
      console.log(`        Failed (HTTP ${result.status}): ${result.body?.message || ''}`)
      summary.failed++
    }

    await page.close().catch(() => {})
  }

  console.log(
    `\nDone. ${summary.sent} sent, ${summary.skipped} skipped, ` +
      `${summary.failed} failed, ${summary.noMatch} without a matching submission.`,
  )
  console.log('Leave the browser open to keep the session, or close it now.')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise((resolve) => rl.question('Press Enter to close the browser... ', resolve))
  rl.close()

  await context.close()
}

main().catch((error) => {
  console.error(`\n${error.message}`)
  process.exit(1)
})
