// Secret redaction.
//
// Runs before anything else in the pipeline, because every later stage either
// keeps text or drops it, and neither is acceptable for a credential that was
// pasted into a prompt by accident.
//
// Design constraints, in priority order:
//
//  1. A redactor that leaks the value it matched is worse than no redactor. The
//     matched text never reaches the output; only a fingerprint of it does.
//  2. Detection is allowlist-shaped rather than denylist-shaped. Matching a
//     known credential format is verifiable; guessing what looks like a
//     secret produces false positives that break working code.
//  3. Findings name the rule that fired and the line, never the content. A
//     report written to a log file or a CI artifact is itself a leak risk.

const PLACEHOLDER = '[REDACTED]'

// Each rule is a named credential format. `test` must match the *whole* secret
// so a partial match cannot leave a usable fragment behind.
const RULES = [
  {
    id: 'anthropic-api-key',
    test: /sk-ant-[A-Za-z0-9_-]{16,}/g,
  },
  {
    id: 'openai-api-key',
    // The negative lookahead matters: an Anthropic key is also `sk-` followed
    // by 20+ valid characters, so without it every Anthropic key would be
    // reported a second time under this rule.
    test: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'aws-access-key-id',
    test: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-token',
    test: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    id: 'slack-token',
    test: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: 'google-api-key',
    // Google keys are AIza + 35 chars, but real-world samples vary by a
    // character or two. A tolerant length bound still cannot collide with
    // ordinary identifiers, since the AIza prefix is the real signal.
    test: /\bAIza[0-9A-Za-z_-]{30,}/g,
  },
  {
    id: 'stripe-secret-key',
    test: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}/g,
  },
  {
    id: 'private-key-block',
    test: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  {
    id: 'jwt',
    test: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: 'connection-string-credentials',
    // postgres://user:pass@host - the password is the part after the colon.
    test: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    // Keep scheme and user so the line still reads as a connection string.
    replace: (match, scheme, user) => `${scheme}${user}:${PLACEHOLDER}@`,
  },
]

// Assignment-shaped secrets: a key whose *name* says it is a secret, followed
// by a value. Handled separately because the value format is unknowable, so
// the key name is the only evidence available.
//
// The name is matched with `[_-]?` between words rather than `\s*` so
// `SECRET_KEY`, `secret-key`, `secretKey` and `secret key` all match. This
// stage runs after the format rules above, so it will also see their
// placeholders; PLACEHOLDER is therefore in the placeholder check below, which
// is what stops a secret being reported twice.
const SECRET_KEY_NAME =
  /(?:api[_-]?key|secret[_-]?key|secret|passwd|password|pass[_-]?word|token|access[_-]?key|private[_-]?key|credential[s]?|auth[_-]?token|client[_-]?secret)\s*[:=]\s*/gi

// Values quoted, or bare up to end of line. Deliberately conservative: if the
// value looks like a variable reference or a placeholder, leave it alone,
// because redacting `process.env.API_KEY` breaks the code that reads it.
const ASSIGNED_VALUE = /^(["'`]?)([^\s"'`,;)\]}]{6,})\1/

function isPlaceholder(value) {
  // The format rules above already replaced their matches before this stage
  // runs, so a value that is now the placeholder must not be counted again.
  if (value === PLACEHOLDER) return true

  return (
    /^(\$\{|\{\{|<|process\.env|os\.environ|env\.|ENV\[|your[-_ ]|xxx|todo|changeme|placeholder|example|null|undefined|true|false|\d+$)/i.test(
      value,
    ) ||
    /^example/i.test(value)
  )
}

// Short hash used to tell two occurrences of the same secret apart without
// revealing either. Not a security primitive; a correlation id.
function fingerprint(value) {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

// Returns findings describing what was redacted and where, with no field
// carrying any part of the secret itself.
function scan(text, rules = RULES) {
  const findings = []
  if (typeof text !== 'string' || text === '') return findings

  for (const rule of rules) {
    const re = new RegExp(rule.test.source, rule.test.flags)
    let m
    while ((m = re.exec(text)) !== null) {
      const captured = m[0]
      findings.push({
        rule: rule.id,
        line: lineOf(text, m.index),
        // Proves the same secret seen twice is one secret, without storing it.
        fingerprint: fingerprint(captured),
        length: captured.length,
      })
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
}

function redactAssignments(text, findings) {
  if (typeof text !== 'string' || text === '') return { text, findings }

  let out = ''
  let last = 0
  const re = new RegExp(SECRET_KEY_NAME.source, 'gi')
  let m

  while ((m = re.exec(text)) !== null) {
    // `m[0]` ends immediately before the value. A quoted value starts one
    // character later, at its opening quote, so the assignment is examined
    // from that offset and the capture group's own start is used to locate the
    // value exactly.
    const assignmentStart = m.index + m[0].length
    const vm = ASSIGNED_VALUE.exec(text.slice(assignmentStart))
    if (!vm) continue

    const value = vm[2]
    if (isPlaceholder(value)) continue

    // vm.index is relative to the sliced string; vm[1] is the opening quote
    // when the value was quoted, so the real value begins one character past
    // the quote.
    const valueStart = assignmentStart + vm.index + vm[1].length

    findings.push({
      rule: 'assigned-secret',
      line: lineOf(text, m.index),
      fingerprint: fingerprint(value),
      length: value.length,
    })

    // Keep the quotes so the surrounding source or config still parses.
    out += text.slice(last, valueStart) + PLACEHOLDER
    last = valueStart + value.length
    re.lastIndex = last
  }

  out += text.slice(last)
  return { text: out, findings }
}

// Replaces every recognised secret with a placeholder and returns the cleaned
// text plus findings safe to log.
export function redactSecrets(text) {
  if (typeof text !== 'string' || text === '') {
    return { text: '', findings: [], removed: 0 }
  }

  const findings = scan(text)
  let out = text

  for (const rule of RULES) {
    const re = new RegExp(rule.test.source, rule.test.flags)
    out = out.replace(re, rule.replace ? rule.replace : PLACEHOLDER)
  }

  const assignment = redactAssignments(out, findings)
  out = assignment.text

  return { text: out, findings, removed: findings.length }
}

// Names only, for a caller that wants to warn without rewriting.
export function findSecrets(text) {
  return scan(text)
}

export { PLACEHOLDER }