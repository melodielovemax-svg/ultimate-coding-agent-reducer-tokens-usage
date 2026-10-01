// Public surface of the reducer engine.
export {
  estimateTokens,
  count,
  counterKind,
  setExactCounter,
  hasExactCounter,
  truncateToTokens,
  chunkToTokens,
  CHARS_PER_TOKEN,
} from './tokenize.mjs'

export { redactSecrets, findSecrets, PLACEHOLDER } from './secrets.mjs'

export { simhash, hamming, findDuplicates, isExactDuplicate, DEFAULT_NEAR_DUP_DISTANCE } from './dedupe.mjs'

export { skeletonize, extractSymbol, summarizeImports } from './skeletonize.mjs'

export { rankLines, selectByRelevance, tokenizeQuery } from './relevance.mjs'

export { allocate, allocateDocuments, splitBudget } from './budget.mjs'

export { reduceContext, reduceText } from './pipeline.mjs'
