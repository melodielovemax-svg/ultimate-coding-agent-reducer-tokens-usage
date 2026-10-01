// Reduction profiles. Each profile is a complete patch applied on top of the
// user's existing config, so it only ever adds or overwrites keys it owns.

export const PROFILES = {
  // Noticeably smaller context, still safe for normal work.
  balanced: {
    description: 'Lower output and history limits with minimal workflow disruption.',
    opencode: {
      tool_output: { max_lines: 300, max_bytes: 16384 },
      compaction: {
        auto: true,
        prune: true,
        tail_turns: 5,
        preserve_recent_tokens: 20000,
        reserved: 40000,
      },
      subagent_depth: 1,
      experimental: {
        disable_paste_summary: true,
        continue_loop_on_deny: false,
      },
      agent: {
        build: { steps: 60 },
        plan: { steps: 25 },
        explore: { steps: 20 },
        general: { steps: 35 },
      },
    },
    gemini: {
      context: {
        includeDirectoryTree: true,
        discoveryMaxDirs: 40,
        loadMemoryFromIncludeDirectories: true,
      },
      model: {
        maxSessionTurns: 120,
        compressionThreshold: 0.4,
        summarizeToolOutput: { run_shell_command: { tokenBudget: 4000 } },
      },
      contextManagement: {
        historyWindow: { maxTokens: 120000, retainedTokens: 40000 },
        messageLimits: {
          normalMaxTokens: 2500,
          retainedMaxTokens: 12000,
          normalizationHeadRatio: 0.25,
        },
        tools: {
          distillation: { maxOutputTokens: 6000, summarizationThresholdTokens: 12000 },
        },
      },
    },
  },

  // Aggressive. Roughly an order of magnitude less context than defaults.
  deep: {
    description: 'Aggressively trim tool output and retained conversation history.',
    opencode: {
      tool_output: { max_lines: 120, max_bytes: 8192 },
      compaction: {
        auto: true,
        prune: true,
        tail_turns: 3,
        preserve_recent_tokens: 12000,
        reserved: 32000,
      },
      subagent_depth: 0,
      experimental: {
        disable_paste_summary: true,
        continue_loop_on_deny: false,
      },
      agent: {
        build: { steps: 40 },
        plan: { steps: 20 },
        explore: { steps: 12 },
        general: { steps: 25 },
      },
    },
    gemini: {
      context: {
        includeDirectoryTree: false,
        discoveryMaxDirs: 10,
        loadMemoryFromIncludeDirectories: false,
      },
      model: {
        maxSessionTurns: 60,
        compressionThreshold: 0.2,
        summarizeToolOutput: { run_shell_command: { tokenBudget: 1000 } },
      },
      contextManagement: {
        historyWindow: { maxTokens: 40000, retainedTokens: 8000 },
        messageLimits: {
          normalMaxTokens: 800,
          retainedMaxTokens: 4000,
          normalizationHeadRatio: 0.15,
        },
        tools: {
          distillation: { maxOutputTokens: 2000, summarizationThresholdTokens: 4000 },
        },
      },
    },
  },

  // Maximum reduction. Context is held so small that long tasks need more
  // than one session.
  extreme: {
    description: 'Smallest history and output budgets; complex tasks may need more sessions.',
    opencode: {
      tool_output: { max_lines: 60, max_bytes: 4096 },
      compaction: {
        auto: true,
        prune: true,
        tail_turns: 2,
        preserve_recent_tokens: 6000,
        reserved: 24000,
      },
      subagent_depth: 0,
      experimental: {
        disable_paste_summary: true,
        continue_loop_on_deny: false,
      },
      agent: {
        build: { steps: 25 },
        plan: { steps: 12 },
        explore: { steps: 8 },
        general: { steps: 15 },
      },
    },
    gemini: {
      context: {
        includeDirectoryTree: false,
        discoveryMaxDirs: 3,
        loadMemoryFromIncludeDirectories: false,
      },
      model: {
        maxSessionTurns: 30,
        compressionThreshold: 0.12,
        summarizeToolOutput: { run_shell_command: { tokenBudget: 400 } },
      },
      contextManagement: {
        historyWindow: { maxTokens: 16000, retainedTokens: 3000 },
        messageLimits: {
          normalMaxTokens: 400,
          retainedMaxTokens: 2000,
          normalizationHeadRatio: 0.1,
        },
        tools: {
          distillation: { maxOutputTokens: 800, summarizationThresholdTokens: 1500 },
        },
      },
    },
  },
}

export const PROFILE_NAMES = Object.keys(PROFILES)

// Keys the tool owns. `tur status` and `tur uninstall` touch only these, so an
// unrelated hand edit to the same config is never reported or reverted.
export const OWNED_KEYS = {
  opencode: [
    'tool_output',
    'compaction',
    'subagent_depth',
    'experimental.disable_paste_summary',
    'experimental.continue_loop_on_deny',
    'agent.build.steps',
    'agent.plan.steps',
    'agent.explore.steps',
    'agent.general.steps',
  ],
  gemini: [
    'context.includeDirectoryTree',
    'context.discoveryMaxDirs',
    'context.loadMemoryFromIncludeDirectories',
    'model.maxSessionTurns',
    'model.compressionThreshold',
    'model.summarizeToolOutput.run_shell_command.tokenBudget',
    'contextManagement.historyWindow.maxTokens',
    'contextManagement.historyWindow.retainedTokens',
    'contextManagement.messageLimits.normalMaxTokens',
    'contextManagement.messageLimits.retainedMaxTokens',
    'contextManagement.messageLimits.normalizationHeadRatio',
    'contextManagement.tools.distillation.maxOutputTokens',
    'contextManagement.tools.distillation.summarizationThresholdTokens',
  ],
}