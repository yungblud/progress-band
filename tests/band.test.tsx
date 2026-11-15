import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'progress-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PROGRAM = JSON.stringify({
  title: 'Migration',
  items: [
    { id: 'a', label: 'Auth', weight: 2, state: 'done' },
    { id: 'b', label: 'Billing', weight: 2, state: 'active', agent: 'billing' },
    { id: 'c', label: 'Cleanup', weight: 1, state: 'waiting' },
  ],
})

const NOW = 1_000_000_000

const files = (program: string | null, billing: string, billingMtime = NOW) => ({
  'program.json': program,
  'billing.json': billing,
  billingMtime,
})

const SESSION = 'sess-a'
const PROJECT = '/repo'
const FOLDER = `${PROJECT}/.claude/progress/${SESSION}`

const seed = (on: On, fixture: ReturnType<typeof files>, cwd = PROJECT) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: PROJECT }))
  on('session.cwd', () => ({ value: cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: e.path === `${FOLDER}/program.json` && fixture['program.json'] !== null }))
  on('fs.list', (_, e) => ({
    value: e.path !== FOLDER ? [] : [
      { name: 'program.json', kind: 'file', size: 1, mtimeMs: NOW, isLink: false },
      { name: 'billing.json', kind: 'file', size: 1, mtimeMs: fixture.billingMtime, isLink: false },
    ],
  }))
  on('fs.read', (_, e) => ({
    value: !e.path.startsWith(`${FOLDER}/`)
      ? ''
      : e.path.endsWith('program.json')
        ? (fixture['program.json'] ?? '')
        : fixture['billing.json'],
  }))
}

test('the band shows the weighted percent, the running agent and what is next', async ($, on) => {
  seed(on, files(PROGRAM, JSON.stringify({ step: 'tests', done: 5, total: 10 })))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // (2 * 1 + 2 * 0.9 * 0.5 + 1 * 0) / 5 = 58%
  expect((await ui.find({ type: 'Text', text: /58%/ }))?.text).toContain('58%')
  expect((await ui.find({ type: 'Text', text: /5\/10 tests/ }))?.text).toContain('5/10 tests')
  expect((await ui.find({ type: 'Text', text: /Cleanup/ }))?.text).toContain('next')
  expect(await ui.find({ type: 'Text', text: /unchanged/ })).toBeUndefined()
  await ui.unmount()
})

test('a shell cd into a subfolder keeps the band', async ($, on) => {
  seed(on, files(PROGRAM, JSON.stringify({ step: 'tests', done: 5, total: 10 })), `${PROJECT}/apps/web`)
  await $.session.start({ cwd: `${PROJECT}/apps/web`, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /58%/ }))?.text).toContain('58%')
  await ui.unmount()
})

test('an agent file that has not changed for a while is flagged', async ($, on) => {
  seed(on, files(PROGRAM, JSON.stringify({ step: 'tests', done: 5, total: 10 }), NOW - 20 * 60000))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /unchanged/ }))?.text).toContain('unchanged for 20m')
  await ui.unmount()
})

test('without program.json the band draws nothing of its own', async ($, on) => {
  seed(on, files(null, ''))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a malformed program.json says so instead of failing quietly', async ($, on) => {
  seed(on, files('{"items": "nope"}', ''))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('program.json is not valid')
  await ui.unmount()
})

test('a second session in the same folder sees neither the first session\'s program nor the shared folder', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-b' }))
  on('session.root', () => ({ value: PROJECT }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: !e.path.includes('sess-b') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: PROGRAM }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
