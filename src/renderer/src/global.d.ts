import type { SkillApi } from '@shared/types'

declare global {
  interface Window {
    api: SkillApi
  }
}

export {}
