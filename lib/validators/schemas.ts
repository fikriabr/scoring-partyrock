// lib/validators/schemas.ts

import { z } from 'zod'
import { ScoringMode } from '@prisma/client'

// -----------------------------------------------------------------------
// EventSchema
// Validates input for creating or updating a competition event.
// Requirements: 1.2, 1.4, 9.3
// -----------------------------------------------------------------------

/**
 * Accepts a date-only string (YYYY-MM-DD, as sent by HTML `<input type="date">`),
 * a full ISO 8601 datetime string, a `Date` object, `null`, or `undefined`.
 * Normalises everything to `Date | null`.
 */
const dateInputSchema = z
  .union([z.string(), z.date()])
  .optional()
  .nullable()
  .transform((val) => {
    if (val == null || val === '') return null
    if (val instanceof Date) return val
    const parsed = new Date(val)
    if (isNaN(parsed.getTime())) {
      throw new Error('Invalid date')
    }
    return parsed
  })

export const EventSchema = z.object({
  name: z
    .string()
    .min(1, 'Event name is required')
    .max(255, 'Event name must not exceed 255 characters'),
  description: z
    .string()
    .max(1000, 'Description must not exceed 1000 characters')
    .optional()
    .nullable(),
  startDate: dateInputSchema,
  endDate: dateInputSchema,
})

/**
 * `EventInput` represents the raw (pre-transform) shape accepted by
 * `EventSchema` — i.e. what callers (forms, actions, services) build and
 * pass in before validation/parsing. `startDate`/`endDate` may be a
 * date-only string, full ISO string, `Date`, `null`, or `undefined` here;
 * `EventSchema.parse()` normalises them to `Date | null` on output.
 */
export type EventInput = z.input<typeof EventSchema>

// -----------------------------------------------------------------------
// CategorySchema
// Validates input for creating or updating a scoring category within an event.
// Requirements: 1.3, 1.4, 9.3
// -----------------------------------------------------------------------

export const CategorySchema = z.object({
  eventId: z.string().min(1, 'Event ID is required'),
  name: z
    .string()
    .min(1, 'Category name is required')
    .max(255, 'Category name must not exceed 255 characters'),
  description: z
    .string()
    .max(1000, 'Description must not exceed 1000 characters')
    .optional()
    .nullable(),
})

export type CategoryInput = z.infer<typeof CategorySchema>

// -----------------------------------------------------------------------
// ParameterSchema
// Validates a single scoring parameter definition.
// Requirements: 2.1, 2.2, 2.3, 9.3
// -----------------------------------------------------------------------

export const ParameterSchema = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  name: z
    .string()
    .min(1, 'Parameter name is required')
    .max(255, 'Parameter name must not exceed 255 characters'),
  description: z
    .string()
    .max(1000, 'Description must not exceed 1000 characters')
    .optional()
    .nullable(),
  weight: z
    .number()
    .gt(0, 'Weight must be greater than 0%')
    .lte(100, 'Weight must not exceed 100%'),
  minScore: z
    .number()
    .min(0, 'Minimum score must be at least 0'),
  maxScore: z
    .number()
    .min(0, 'Maximum score must be at least 0'),
  scoringMode: z.nativeEnum(ScoringMode).default(ScoringMode.AUTO),
  orderIndex: z.number().int().min(0).default(0),
}).refine(
  (data) => data.maxScore > data.minScore,
  {
    message: 'maxScore must be greater than minScore',
    path: ['maxScore'],
  }
)

export type ParameterInput = z.infer<typeof ParameterSchema>

// -----------------------------------------------------------------------
// ParameterSetSchema
// Validates a full set of parameters for a category.
// Refine: total weight of all parameters must equal 100% within ±0.001 tolerance.
// Requirements: 2.2, 2.3, 9.3
// -----------------------------------------------------------------------

const ParameterItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Parameter name is required')
    .max(255, 'Parameter name must not exceed 255 characters'),
  description: z
    .string()
    .max(1000, 'Description must not exceed 1000 characters')
    .optional()
    .nullable(),
  weight: z
    .number()
    .gt(0, 'Weight must be greater than 0%')
    .lte(100, 'Weight must not exceed 100%'),
  minScore: z
    .number()
    .min(0, 'Minimum score must be at least 0'),
  maxScore: z
    .number()
    .min(0, 'Maximum score must be at least 0'),
  scoringMode: z.nativeEnum(ScoringMode).default(ScoringMode.AUTO),
  orderIndex: z.number().int().min(0).default(0),
}).refine(
  (data) => data.maxScore > data.minScore,
  {
    message: 'maxScore must be greater than minScore',
    path: ['maxScore'],
  }
)

export const ParameterSetSchema = z
  .array(ParameterItemSchema)
  .min(1, 'At least one parameter is required')
  .superRefine((parameters, ctx) => {
    const totalWeight = parameters.reduce((sum, p) => sum + p.weight, 0)
    if (Math.abs(totalWeight - 100) > 0.001) {
      const diff = (100 - totalWeight).toFixed(3)
      const direction = totalWeight < 100 ? 'increase' : 'decrease'
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Total parameter weight must equal 100%. Current total is ${totalWeight.toFixed(3)}%. Please ${direction} weights by ${Math.abs(Number(diff)).toFixed(3)}%.`,
        path: [],
      })
    }
  })

export type ParameterSetInput = z.infer<typeof ParameterSetSchema>

// -----------------------------------------------------------------------
// SubmissionSchema
// Validates a project submission URL and participant details.
// URL must be on the partyrock.aws domain.
// Requirements: 3.1, 3.2, 9.3
// -----------------------------------------------------------------------

export const SubmissionSchema = z.object({
  url: z
    .string()
    .min(1, 'URL is required')
    .url('URL must be a valid URL')
    .refine(
      (url) => {
        try {
          const parsed = new URL(url)
          return (
            parsed.hostname === 'partyrock.aws' ||
            parsed.hostname.endsWith('.partyrock.aws')
          )
        } catch {
          return false
        }
      },
      { message: 'URL must be a valid PartyRock URL (domain: partyrock.aws)' }
    ),
  participantName: z
    .string()
    .min(1, 'Participant name is required')
    .max(255, 'Participant name must not exceed 255 characters'),
  teamName: z
    .string()
    .max(255, 'Team name must not exceed 255 characters')
    .optional()
    .nullable(),
  sourceCode: z
    .string()
    .max(100000, 'Source code must not exceed 100,000 characters')
    .optional()
    .nullable(),
  categoryId: z.string().min(1, 'Category ID is required'),
})

export type SubmissionInput = z.infer<typeof SubmissionSchema>

// -----------------------------------------------------------------------
// JuryScoreSchema
// Validates a jury score submission for a single parameter.
// Score must be within the [minScore, maxScore] range configured per parameter.
// Requirements: 6.3, 6.4, 9.3
// -----------------------------------------------------------------------

export const JuryScoreSchema = z
  .object({
    projectId: z.string().min(1, 'Project ID is required'),
    parameterId: z.string().min(1, 'Parameter ID is required'),
    score: z.number().finite('Score must be a finite number'),
    comment: z
      .string()
      .max(2000, 'Comment must not exceed 2000 characters')
      .optional()
      .nullable(),
    /** Range bounds — resolved from the Parameter record before validation */
    minScore: z.number(),
    maxScore: z.number(),
  })
  .superRefine((data, ctx) => {
    if (data.score < data.minScore || data.score > data.maxScore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Score must be between ${data.minScore} and ${data.maxScore}`,
        path: ['score'],
      })
    }
  })

export type JuryScoreInput = z.infer<typeof JuryScoreSchema>

// -----------------------------------------------------------------------
// CsvRowSchema
// Validates a single row from a bulk CSV import.
// Columns: url, participantName (or participant_name), teamName (or team_name),
//          sourceCode (or source_code), categoryId (or category_id)
// Requirements: 3.4, 3.5, 9.3
// -----------------------------------------------------------------------

export const CsvRowSchema = z.object({
  url: z
    .string()
    .min(1, 'URL is required')
    .url('URL must be a valid URL')
    .refine(
      (url) => {
        try {
          const parsed = new URL(url)
          return (
            parsed.hostname === 'partyrock.aws' ||
            parsed.hostname.endsWith('.partyrock.aws')
          )
        } catch {
          return false
        }
      },
      { message: 'URL must be a valid PartyRock URL (domain: partyrock.aws)' }
    ),
  participantName: z
    .string()
    .min(1, 'Participant name is required')
    .max(255, 'Participant name must not exceed 255 characters'),
  /**
   * teamName is nullable. When reading from CSV the raw transform always
   * produces `string | null`, so we do not mark it as `.optional()` here —
   * that keeps the input type as `string | null` and makes `.pipe()` happy.
   */
  teamName: z
    .string()
    .max(255, 'Team name must not exceed 255 characters')
    .nullable(),
  /**
   * Pasted source code, mapped to the nullable `Project.sourceCode` column.
   * Same nullable-but-not-optional treatment as `teamName`: the raw transform
   * always produces `string | null`, and `.pipe()` requires the piped-into
   * input type to match exactly, so `.optional()` must not be added here.
   * A missing `source_code` column arrives as `null`.
   */
  sourceCode: z
    .string()
    .max(100000, 'Source code must not exceed 100,000 characters')
    .nullable(),
  categoryId: z.string().min(1, 'Category ID is required'),
})

export type CsvRowInput = z.infer<typeof CsvRowSchema>

// -----------------------------------------------------------------------
// CsvRowRawSchema
// Handles snake_case column headers from CSV files before normalisation.
// Requirements: 3.4, 3.5
// -----------------------------------------------------------------------

export const CsvRowRawSchema = z
  .object({
    url: z.string().min(1, 'URL is required'),
    participant_name: z.string().optional(),
    participantName: z.string().optional(),
    team_name: z.string().optional().nullable(),
    teamName: z.string().optional().nullable(),
    source_code: z.string().optional().nullable(),
    sourceCode: z.string().optional().nullable(),
    category_id: z.string().optional(),
    categoryId: z.string().optional(),
  })
  .transform((row) => {
    const teamRaw = row.teamName ?? row.team_name
    const sourceRaw = row.sourceCode ?? row.source_code
    return {
      url: row.url,
      participantName: (row.participantName ?? row.participant_name ?? '').trim(),
      // Ensure teamName is always string | null (never undefined) for CsvRowSchema
      teamName: teamRaw != null && teamRaw.trim() !== '' ? teamRaw.trim() : null,
      // Same for sourceCode — absent column means "no code pasted", i.e. null
      sourceCode: sourceRaw != null && sourceRaw.trim() !== '' ? sourceRaw : null,
      categoryId: (row.categoryId ?? row.category_id ?? '').trim(),
    }
  })
  .pipe(CsvRowSchema)

export type CsvRowRawInput = z.input<typeof CsvRowRawSchema>

// -----------------------------------------------------------------------
// CaptureSchema
// Validates a manual capture payload produced by `public/partyrock-capture.js`
// and posted to `POST /api/capture`.
//
// This is the replacement for headless crawling of widget/prompt data:
// AWS WAF blocks PartyRock's internal `getLatestAppVersion` API for
// automated browsers, so widgets and prompts are collected from a real,
// human-driven browser session instead. See docs/CAPTURE.md.
// Requirements: 4.2, 4.5, 9.3
// -----------------------------------------------------------------------

export const CaptureWidgetSchema = z.object({
  type: z.string().max(200).default('unknown'),
  label: z.string().max(500).default(''),
})

export const CaptureSchema = z.object({
  /** The PartyRock app URL that was open in the browser when captured. */
  url: z
    .string()
    .min(1, 'URL is required')
    .refine(
      (url) => {
        try {
          const parsed = new URL(url)
          return (
            parsed.hostname === 'partyrock.aws' ||
            parsed.hostname.endsWith('.partyrock.aws')
          )
        } catch {
          return false
        }
      },
      { message: 'URL must be a valid PartyRock URL (domain: partyrock.aws)' },
    ),
  title: z.string().max(1000).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  widgets: z.array(CaptureWidgetSchema).max(500).default([]),
  prompts: z.array(z.string().max(20000)).max(500).default([]),
  /** Text the app's AI widgets actually generated, if the human triggered them. */
  outputs: z.array(z.string().max(20000)).max(500).default([]),
  /**
   * Raw app-definition JSON observed on the page's own network traffic.
   * Free-form because PartyRock's internal response shape is not a contract.
   */
  appDefinition: z.unknown().optional().nullable(),
  /** Where the data came from — useful when debugging a thin capture. */
  source: z.enum(['network', 'dom', 'mixed', 'manual']).default('mixed'),
  capturedAt: z.string().max(100).optional().nullable(),
  /** Restrict matching to a single category; otherwise every match is updated. */
  categoryId: z.string().max(100).optional().nullable(),
})

export type CaptureInput = z.input<typeof CaptureSchema>
export type CaptureData = z.infer<typeof CaptureSchema>
