import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Passing a directory to `node --test` is not portable across Node 20/22/24
// (Node 22 tries to load it as a module). Enumerate the test files ourselves
// so `npm test` behaves the same on every supported Node version and on Windows.
const directory = 'test'
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(directory, name))

if (files.length === 0) {
  console.error('No test files found.')
  process.exitCode = 1
} else {
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}
