// Budget allocation.
//
// Truncating each file independently to fit a shared budget is the obvious
// approach and the wrong one: it spends the whole budget on the largest file
// and starves everything else, then leaves the reader with an unbalanced set of
// arbitrarily-cut files.
//
// This allocator works per item with a per-item ceiling and a global budget, in
// priority order. An item that fits keeps its full content; an item that does
// not is truncated to its ceiling; an item that still does not fit is dropped
// with a recorded reason. Every drop is recorded, because a silently dropped
// file is the failure mode that makes a reducer untrustworthy.

const DEFAULT_ITEM_CEILING = 0.25

// Splits a budget across items, giving the remainder to the items that are
// closest to being truncated anyway. Even division would push several items just
// over a shared boundary when a single remainder unit could have kept them all
// under.
//
// The per-item ceiling bounds the *bonus* an item receives from the remainder,
// not its even share. Applying the ceiling to the share as well silently
// shrank every allocation (a 30-token budget over 3 items yielded 21) and made
// priority meaningless, because a high-priority item was capped below the size
// it actually needed and then dropped.
export function splitBudget(items, budget, { ceiling = DEFAULT_ITEM_CEILING } = {}) {
  const n = items.length
  if (n === 0) return []

  const perItem = Math.max(1, Math.floor(budget / n))
  const bonusCap = Math.max(0, Math.floor(budget * ceiling))
  const alloc = new Array(n).fill(perItem)

  let remaining = budget - perItem * n
  const sorted = items
    .map((item, i) => ({ i, need: item.tokens - perItem }))
    .filter((x) => x.need > 0)
    .sort((a, b) => a.need - b.need)

  for (const { i } of sorted) {
    if (remaining <= 0) break
    const room = bonusCap - (alloc[i] - perItem)
    if (room <= 0) continue
    const grant = Math.min(1, room)
    alloc[i] += grant
    remaining -= grant
  }

  return alloc.map((amount) => Math.max(1, amount))
}

// Fits items into a budget, in priority order.
//
// Each item is allowed its need, or the whole remaining budget if it fits, minus
// a reservation held back for the items still to come. The reservation is what
// stops the first item from consuming everything, so a low-priority file
// cannot starve a high-priority one.
//
// This replaced an even budget/n split, which had two defects that only showed
// up once several items were in play: it truncated an item that would have fit
// whole, and it capped each item below its own need so priority had no effect
// and high-priority items were dropped outright.
export function allocate(items, budget, options = {}) {
  const { truncate, ceiling = DEFAULT_ITEM_CEILING, minTokens = 1 } = options

  const ordered = [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  const kept = []
  const truncatedItems = []
  const dropped = []
  let spent = 0

  ordered.forEach((item, i) => {
    const leftCount = ordered.length - i - 1
    const remaining = budget - spent

    if (remaining < minTokens) {
      dropped.push({ id: item.id, tokens: item.tokens, reason: 'out of budget' })
      return
    }

    // An item that cannot be truncated is all-or-nothing, so reserving budget
    // against it would only cause a drop. Reservation applies to items that can
    // be trimmed.
    const trimmable = typeof truncate === 'function' && typeof item.text === 'string'
    // Reserve what the items still to come are entitled to. `ceiling` is the
    // largest share of the remaining budget a single item may take, so the
    // reserve is its complement. Reserving the ceiling itself would invert the
    // meaning: a wider ceiling would reserve more and starve the first item
    // rather than protect the rest.
    const reserve = leftCount > 0 && trimmable ? remaining * (1 - ceiling) : 0
    const allowance = Math.max(minTokens, Math.min(remaining - reserve, item.tokens))

    // Fits whole within its own allowance: keep it intact.
    if (item.tokens <= allowance) {
      kept.push({ ...item, allocated: item.tokens, truncated: false })
      spent += item.tokens
      return
    }

    if (typeof truncate === 'function' && typeof item.text === 'string') {
      const usable = Math.min(allowance, remaining)
      if (usable < minTokens) {
        dropped.push({ id: item.id, tokens: item.tokens, reason: 'out of budget' })
        return
      }

      const result = truncate(item.text, usable)
      const cost = item.tokensOf ? item.tokensOf(result.text) : usable

      if (cost < minTokens) {
        dropped.push({ id: item.id, tokens: item.tokens, reason: 'truncation too small to be useful' })
        return
      }

      truncatedItems.push({ ...item, allocated: cost, truncated: true, text: result.text })
      spent += cost
      return
    }

    dropped.push({ id: item.id, tokens: item.tokens, reason: 'does not fit and is not truncatable' })
  })

  // Restore caller order so the output reads in the order it was supplied.
  const order = new Map(items.map((it, i) => [it.id, i]))
  kept.sort((a, b) => order.get(a.id) - order.get(b.id))
  truncatedItems.sort((a, b) => order.get(a.id) - order.get(b.id))

  return {
    kept,
    truncated: truncatedItems,
    dropped,
    spent,
    budget,
    // Underspend is normal and worth reporting: it means the items simply did
    // not need the rest of the budget, not that allocation failed.
    utilization: budget > 0 ? spent / budget : 0,
  }
}

// Distributes a total budget across documents given to a model, as opposed to
// files read from disk. Different problem: documents are already selected, and
// the job is deciding how much of each survives.
//
// Extra fields on an input document are carried through to the result. The
// pipeline attaches provenance this way, and rebuilding items from a fixed
// field list silently discarded it, which made the reducer's own output
// impossible to explain.
export function allocateDocuments(documents, budget, options = {}) {
  const { count = (t) => Math.ceil(t.length / 4), minTokens = 1 } = options

  const items = documents.map((d) => ({
    ...d,
    id: d.id,
    text: d.text,
    tokens: d.tokens ?? count(d.text ?? ''),
    priority: d.priority ?? 0,
    tokensOf: count,
  }))

  return allocate(items, budget, options)
}
