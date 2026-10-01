// Fabricated credential shapes for testing the secret detector.
//
// GitHub push protection rejects any commit containing a string that matches a
// real credential format, fabricated or not, so these values are assembled from
// fragments at run time. Nothing here is a credential and none of it authenticates
// anything; the detector is regex-based and only the shape is under test.

const build = (...parts) => parts.join('')

export const ANTHROPIC = build('sk-ant-', 'api03-', 'A'.repeat(48))
export const OPENAI = build('sk-', 'proj-', 'T'.repeat(20), '-', 'a'.repeat(48))

export const AWS_ACCESS_KEY = build('AKIA', 'IOSFODNN7EXAMPLE')
export const GITHUB_TOKEN = build('gh', 'p_', '0123456789', 'abcdef', '0123456789', 'abcdef0123')
export const SLACK_TOKEN = build('xox', 'b-', '1234567890', '-', 'abcdefghij', 'klmnop')
export const GOOGLE_API_KEY = build('AIza', 'Sy0123456789', '0123456789012345678901234567890')
export const STRIPE_KEY = build('sk_', 'live_', '0123456789', 'abcdefghij')

export const JWT = build(
  'eyJhbGciOiJIUzI1NiIs',
  'InR5cCI6IkpXVCJ9',
  '.',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  '.',
  'dozjgNryP4J3jVmNHl0w5N',
  'XgL0n3I9PlFUP0THsR8U',
)

export const PEM_LINES = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEow',
  'IBAAKC',
  '-----END RSA PRIVATE KEY-----',
]

// No recognisable provider format: only the key name gives it away. Kept in
// this file for the same reason as the rest.
export const ASSIGNED_SECRET = build('zQ8vN2pL4wR6tY0uI9oP3aS5dF7gH', '1jK')

// Every value above, for loops that need the whole set.
export const ALL = [
  ANTHROPIC,
  OPENAI,
  AWS_ACCESS_KEY,
  GITHUB_TOKEN,
  SLACK_TOKEN,
  GOOGLE_API_KEY,
  STRIPE_KEY,
  JWT,
  ASSIGNED_SECRET,
]
