import claudeCodeIcon from '@/assets/icons/claude_code.svg'
import codexIcon from '@/assets/icons/codex.svg'
import opencodeIcon from '@/assets/icons/opencode.svg'
import { cn } from '@/lib/utils'
import type { SkillSource } from '@shared/types'

const SRC: Record<SkillSource, string> = {
  claude: claudeCodeIcon,
  codex: codexIcon,
  opencode: opencodeIcon
}

/**
 * Claude 是自带底色的品牌徽章，两主题都可读；
 * codex（无 fill，默认纯黑）与 opencode（墨色 #211E1E）在暗色下需反相。
 */
const DARK_INVERT: Record<SkillSource, string> = {
  claude: '',
  codex: 'dark:invert',
  opencode: 'dark:invert'
}

export interface AgentIconProps {
  agent: SkillSource
  className?: string
}

export function AgentIcon({ agent, className }: AgentIconProps): React.ReactElement {
  return (
    <img
      src={SRC[agent]}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('h-4 w-4 shrink-0 object-contain', DARK_INVERT[agent], className)}
    />
  )
}

export function agentIconSrc(agent: SkillSource): string {
  return SRC[agent]
}
