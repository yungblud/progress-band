export type ItemState = 'done' | 'review' | 'active' | 'waiting'

export type Locale = 'en' | 'ko'

export type AgentProgress = {
  step: string
  done: number
  total: number
  minutesAgo: number
}

export type Item = {
  id: string
  label: string
  weight: number
  state: ItemState
  agent: AgentProgress | null
}

export type Snapshot = {
  title: string
  locale: Locale
  staleMinutes: number
  items: Item[]
  error: 'malformed' | null
}

declare module 'claude-code' {
  interface PluginState {
    'progress-band': { snapshot: Shaped<Snapshot | null> }
  }
}
