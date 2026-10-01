// Pipeline orchestration.
//
// Stage order is load-bearing, not alphabetical:
//
//   1. secrets      - must precede everything, because later stages keep text
//   2. dedupe       - before any shrinking, so the cheap win is taken first
//   3. skeletonize  - only for code, before ranking, so ranking sees fewer lines
//   4. relevance    - needs the cheapest possible representation
//   5. budget       - last, because it only knows real costs after the above
//
// Every stage records tokens before and after, and the pipeline returns the
// full trace. A reduction claim that cannot show where the tokens went is not
// evidence of anything.

import { count, counterKind, truncateToTokens } from './tokenize.mjs'
import { redactSecrets } from './secrets.mjs'
import { findDuplicates } from './dedupe.mjs'
import { skeletonize } from './skeletonize.mjs'
import { selectByRelevance, setCounter as setRelevanceCounter } from './relevance.mjs'
import { allocateDocuments } from './budget.mjs'

setRelevanceCounter(count)

const CODE_EXTENSIONS = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|scala|sh|bash|zsh|sql|vue|svelte)$/i

function isCode(id) {
  return typeof id === 'string' && CODE_EXTENSIONS.test(id)
}

function trace(stage, before, after, extra = {}) {
  return {
    stage,
    tokensBefore: before,
    tokensAfter: after,
    saved: before - after,
    ...extra,
  }
}

// Redaction can lengthen text: `[REDACTED]` is longer than a short credential,
// and a connection string keeps its scheme and user. Reporting the resulting
// token growth as a negative saving made the trace look like the secrets stage
// cost tokens, which is noise rather than a measurement. The stage is recorded
// by how many findings it produced, which is what it actually did.
function secretsTrace(before, after, findings) {
  return {
    stage: 'secrets',
    tokensBefore: before,
    tokensAfter: after,
    saved: 0,
    findings: findings.length,
  }
}

// How many lines relevance selection retained in total, for the trace.
function it0Selected(ranked) {
  return ranked.reduce((sum, it) => sum + (it.relevanceSelected ?? 0), 0)
}

// Reduces a set of context items to a token budget.
//
// items: [{ id, text, priority? }]
// options:
//   budget      - total tokens to fit into (required)
//   query       - relevance query; without one, ranking is skipped
//   code        - force code mode; otherwise inferred from the id extension
//   skeletonize - keep declarations only (default true for code)
//   minTokens   - below this, an item is dropped as not worth including
export function reduceContext(items, options = {}) {
  const {
    budget,
    query = '',
    code,
    skeletonize: skeletonizeEnabled,
    minTokens = 1,
    ceiling,
  } = options

  if (!Number.isFinite(budget) || budget <= 0) {
    throw new RangeError('reduceContext requires a positive numeric budget')
  }

  const stages = []
  const startTotal = items.reduce((sum, it) => sum + count(it.text ?? ''), 0)
  const findings = []

  // 1. Secrets. Runs on raw input so the report points at the line the user
  // actually pasted, not the line after processing.
  const redacted = items.map((it) => {
    const result = redactSecrets(it.text ?? '')
    for (const f of result.findings) {
      findings.push({ id: it.id, ...f })
    }
    return { ...it, text: result.text }
  })

  const afterSecrets = redacted.reduce((sum, it) => sum + count(it.text ?? ''), 0)
  if (afterSecrets !== startTotal || findings.length > 0) {
    stages.push(secretsTrace(startTotal, afterSecrets, findings))
  }

  // 2. Dedupe.
  const { kept: keptIds, dropped: duplicates } = findDuplicates(redacted)
  const deduped = redacted.filter((it) => keptIds.includes(it.id))
  const afterDedupe = deduped.reduce((sum, it) => sum + count(it.text ?? ''), 0)
  if (deduped.length !== redacted.length) {
    stages.push(trace('dedupe', afterSecrets, afterDedupe, { removed: redacted.length - deduped.length }))
  }

  // 3. Skeletonize code only. Prose skeletonized by this scanner comes back
  // near-empty, so the stage is gated on the item actually being code.
  const shouldSkeletonize = skeletonizeEnabled
  const prepared = deduped.map((it) => {
    const asCode = code ?? isCode(it.id)
    if (!asCode || shouldSkeletonize === false) return { ...it, mode: 'full' }

    const skeleton = skeletonize(it.text ?? '')
    // A skeleton that is most of the file saved nothing; keep the original.
    if (skeleton.linesKept === 0 || skeleton.linesKept >= skeleton.linesTotal * 0.9) {
      return { ...it, mode: 'full' }
    }
    return { ...it, text: skeleton.text, mode: 'skeleton', symbols: skeleton.symbols }
  })

  const afterSkeleton = prepared.reduce((sum, it) => sum + count(it.text ?? ''), 0)
  if (afterSkeleton !== afterDedupe) {
    stages.push(trace('skeletonize', afterDedupe, afterSkeleton, {}))
  }

  // 4. Relevance. Only runs when there is something to be relevant to.
  let ranked = prepared
  if (query) {
    ranked = prepared.map((it) => {
      // Give relevance roughly half the budget per item, capped, so ranking
      // can never itself consume the whole allowance on one file.
      const allowance = Math.max(minTokens, Math.floor(budget * 0.5))
      const selection = selectByRelevance(it.text, query, { maxTokens: allowance, count })
      if (selection.text === '' && it.text !== '') {
        return { ...it, relevanceSelected: 0 }
      }
      return { ...it, text: selection.text, relevanceSelected: selection.selected.length }
    })

    const afterRank = ranked.reduce((sum, it) => sum + count(it.text ?? ''), 0)
    // Recorded whenever the stage ran, even if it saved nothing. A trace that
    // hides a stage which executed makes it impossible to tell "did not help"
    // from "did not run", and those need different fixes.
    stages.push(trace('relevance', afterSkeleton, afterRank, { selected: it0Selected(ranked) }))
  }

  // 5. Budget.
  const allocation = allocateDocuments(
    ranked.map((it) => ({
      id: it.id,
      text: it.text,
      tokens: count(it.text ?? ''),
      priority: it.priority ?? 0,
      mode: it.mode,
      symbols: it.symbols,
    })),
    budget,
    {
      count,
      minTokens,
      ceiling,
      truncate: (text, max) => truncateToTokens(text, max),
    },
  )

  const included = [...allocation.kept, ...allocation.truncated]
  const finalTotal = allocation.spent
  stages.push(trace('budget', finalTotal === 0 ? 0 : ranked.reduce((s, i) => s + count(i.text ?? ''), 0), finalTotal, {}))

  const savings = startTotal > 0 ? 1 - finalTotal / startTotal : 0

  return {
    items: included,
    output: included.map((it) => renderItem(it)).join('\n\n'),
    trace: stages,
    totals: {
      tokensIn: startTotal,
      tokensOut: finalTotal,
      saved: startTotal - finalTotal,
      reduction: savings,
      counter: counterKind(),
      budget,
      utilization: allocation.utilization,
    },
    dropped: [...duplicates.map((d) => ({ id: d.id, reason: `duplicate (${d.reason}) of ${d.duplicateOf}` })), ...allocation.dropped.map((d) => ({ id: d.id, reason: d.reason }))],
    findings,
  }
}

function renderItem(item) {
  const header = item.mode === 'skeleton' ? `${item.id} (declarations only)` : item.id
  const marker = item.truncated ? '\n… [truncated]' : ''
  return `${header}\n${item.text}${marker}`
}

// Convenience wrapper for the common case: reduce one string.
export function reduceText(text, { id = 'input', ...options } = {}) {
  return reduceContext([{ id, text }], options)
}
