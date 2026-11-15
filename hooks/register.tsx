import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentProgress, Item, ItemState, Locale, Snapshot } from '../types'

/** Folder, relative to the session's working directory, that holds one subfolder of progress files per session. */
const ROOT = '.claude/progress'
const POLL_MS = 5000
const DEFAULT_STALE_MINUTES = 15

const snapshot = atom({ plugin: 'progress-band', key: 'snapshot' } as const, null, {
  shape: 'snapshot-1',
})

/** Share of an item's weight that counts as finished, by state. */
const SHARE: Record<ItemState, number> = { done: 1, review: 0.95, active: 0.9, waiting: 0 }

const STRINGS: Record<
  Locale,
  {
    finished: string
    review: string
    starting: string
    next: string
    stale: (minutes: number) => string
    malformed: string
  }
> = {
  en: {
    finished: 'done',
    review: 'in review',
    starting: 'starting',
    next: 'next',
    stale: minutes => `unchanged for ${minutes}m`,
    malformed: 'program.json is not valid',
  },
  ko: {
    finished: '끝남',
    review: '검토 · 머지 대기',
    starting: '시작 중',
    next: '다음',
    stale: minutes => `${minutes}분째 그대로`,
    malformed: 'program.json 형식 오류',
  },
}

type ProgramFile = {
  title?: string
  locale?: Locale
  staleMinutes?: number
  items: { id: string; label: string; weight?: number; state: ItemState; agent?: string }[]
}

type AgentFile = { step: string; done: number; total: number }

const STATES: readonly ItemState[] = ['done', 'review', 'active', 'waiting']

const parse = <T,>(text: string): T | null => {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

const isProgram = (value: unknown): value is ProgramFile =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as ProgramFile).items) &&
  (value as ProgramFile).items.every(
    item => typeof item.id === 'string' && typeof item.label === 'string' && STATES.includes(item.state),
  )

const isAgent = (value: unknown): value is AgentFile =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as AgentFile).step === 'string' &&
  typeof (value as AgentFile).done === 'number' &&
  typeof (value as AgentFile).total === 'number'

/** Ratio of one item that is finished, 0 to 1. */
const itemRatio = (item: Item): number => {
  if (item.state !== 'active') return SHARE[item.state]
  if (!item.agent || item.agent.total <= 0) return 0
  return SHARE.active * Math.min(1, item.agent.done / item.agent.total)
}

/** Overall ratio, each item weighted by its weight. */
const overallRatio = (items: Item[]): number => {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  if (total === 0) return 0
  return items.reduce((sum, item) => sum + item.weight * itemRatio(item), 0) / total
}

const bar = (ratio: number, width: number): [string, string] => {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width)
  return ['█'.repeat(filled), '░'.repeat(width - filled)]
}

/** Terminal cell width, counting Hangul, CJK and other wide glyphs as two. */
const cells = (text: string): number =>
  [...text].reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1), 0)

const padCells = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - cells(text)))

/** This session's own progress folder, so two terminals in one repo never share a band. */
const sessionDir = async ($: EngineInterface): Promise<string> => `${ROOT}/${await $.session.id()}`

/** Reads program.json and each named agent's progress file; null when there is no program. */
async function load($: EngineInterface): Promise<Snapshot | null> {
  const dir = await sessionDir($)
  if (!(await $.fs.exists(`${dir}/program.json`))) return null

  const raw = parse<unknown>(await $.fs.read(`${dir}/program.json`).catch(() => ''))
  if (!isProgram(raw)) {
    return { title: 'progress', locale: 'en', staleMinutes: DEFAULT_STALE_MINUTES, items: [], error: 'malformed' }
  }

  const entries = await $.fs.list(dir).catch(() => [])
  const now = await $.clock.now()
  const items: Item[] = []
  for (const item of raw.items) {
    const entry = item.agent ? entries.find(file => file.name === `${item.agent}.json`) : undefined
    const text = entry ? await $.fs.read(`${dir}/${entry.name}`).catch(() => '') : ''
    const file = entry ? parse<unknown>(text) : null
    const agent: AgentProgress | null =
      entry && isAgent(file)
        ? { ...file, minutesAgo: Math.floor((now - entry.mtimeMs) / 60000) }
        : null
    items.push({ id: item.id, label: item.label, weight: item.weight ?? 1, state: item.state, agent })
  }
  return {
    title: raw.title ?? 'progress',
    locale: raw.locale === 'ko' ? 'ko' : 'en',
    staleMinutes: raw.staleMinutes ?? DEFAULT_STALE_MINUTES,
    items,
    error: null,
  }
}

let lastJson = ''
let isPolling = false

/** Loads once now and, the first time it runs in this module, every POLL_MS after. */
async function refresh($: EngineInterface): Promise<void> {
  const value = await load($)
  const json = JSON.stringify(value)
  if (json !== lastJson) {
    lastJson = json
    await update($, snapshot, () => value)
  }
  if (!isPolling) {
    isPolling = true
    $.clock.every(POLL_MS, () => refresh($))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const value = await read($, snapshot)
    if (e.props.hasSurvey || value === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const t = STRINGS[value.locale]
    if (value.error) {
      return <Text color="warning">{t.malformed}</Text>
    }

    const ratio = overallRatio(value.items)
    const [filled, empty] = bar(ratio, 24)
    const doneCount = value.items.filter(item => item.state === 'done').length
    const running = value.items.filter(item => item.state === 'active' || item.state === 'review')
    const waiting = value.items.filter(item => item.state === 'waiting')
    const labelWidth = Math.max(4, ...running.map(item => cells(item.label)))

    return (
      <Box flexDirection="column">
        <Box>
          <Text weight="bold">{value.title} </Text>
          <Text color="success">{filled}</Text>
          <Text dimColor>{empty}</Text>
          <Text weight="bold"> {Math.round(ratio * 100)}%</Text>
          <Text dimColor>
            {'  '}
            {t.finished} {doneCount}/{value.items.length}
          </Text>
        </Box>
        {running.map(item => {
          const label = `  ${padCells(item.label, labelWidth)}  `
          if (item.state === 'review') {
            return (
              <Box key={item.id}>
                <Text>{label}</Text>
                <Text color="warning">{t.review}</Text>
              </Box>
            )
          }
          if (!item.agent) {
            return (
              <Box key={item.id}>
                <Text>{label}</Text>
                <Text dimColor>{t.starting}</Text>
              </Box>
            )
          }
          const [lit, unlit] = bar(item.agent.done / Math.max(1, item.agent.total), 10)
          const isStale = item.agent.minutesAgo >= value.staleMinutes
          return (
            <Box key={item.id}>
              <Text>{label}</Text>
              <Text color="suggestion">{lit}</Text>
              <Text dimColor>{unlit}</Text>
              <Text>
                {' '}
                {item.agent.done}/{item.agent.total} {item.agent.step}
              </Text>
              {isStale && <Text color="warning"> ({t.stale(item.agent.minutesAgo)})</Text>}
            </Box>
          )
        })}
        {waiting.length > 0 && (
          <Text dimColor>
            {'  '}
            {t.next} · {waiting.map(item => item.label).join(' → ')}
          </Text>
        )}
      </Box>
    )
  })
}
