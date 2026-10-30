import type { SkillSource } from '@shared/types'

import agentsIcon from '@/assets/icons/agents.svg'
import claudeCodeIcon from '@/assets/icons/claude_code.svg'
import codexIcon from '@/assets/icons/codex.svg'
import opencodeIcon from '@/assets/icons/opencode.svg'
import { cn } from '@/lib/utils'

/** 四个存储位置各自的品牌图；漏配会在类型层面直接报错 */
const SRC: Record<SkillSource, string> = {
  claude: claudeCodeIcon,
  codex: codexIcon,
  opencode: opencodeIcon,
  agents: agentsIcon,
}

/**
 * Claude 与 Agents 是自带配色的品牌徽章，两主题都可读；
 * codex（无 fill，默认纯黑）与 opencode（墨色 #211E1E）在暗色下需反相。
 */
const DARK_INVERT: Partial<Record<SkillSource, string>> = {
  codex: 'dark:invert',
  opencode: 'dark:invert',
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
      className={cn(
        'img-ring h-4 w-4 shrink-0 rounded-xs object-contain',
        DARK_INVERT[agent],
        className,
      )}
    />
  )
}
