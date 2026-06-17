// Run from terminal (outside Claude Code): node test-cli.mjs
import { spawnSync } from 'child_process'

const input = `SYSTEM:\nYou are a helpful assistant.\n\nUSER:\nReply with exactly this JSON and nothing else: {"ok": true}`

const result = spawnSync(
  'claude',
  ['-p', '--output-format', 'json', '--no-session-persistence', '--model', 'sonnet'],
  {
    input,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: undefined },
  },
)

if (result.error) {
  console.error('FAIL — could not spawn claude CLI:', result.error.message)
  process.exit(1)
}

if (result.status !== 0) {
  console.error('FAIL — claude CLI exited with status', result.status)
  console.error('stderr:', result.stderr)
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(result.stdout)
} catch {
  console.error('FAIL — stdout was not JSON:', result.stdout.slice(0, 300))
  process.exit(1)
}

console.log('CLI raw output:', JSON.stringify(parsed, null, 2))
console.log('\nResponse text:', parsed.result)
console.log('\nSUCCESS — CLI routing is working.')
