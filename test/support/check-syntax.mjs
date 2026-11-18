/** Syntax gate for the no-build plugin: parse every shipped JavaScript file. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots = ['index.js', 'client.js']
for (const directory of ['src', 'test']) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of readdirSync(join(directory, entry.name), { withFileTypes: true })) {
        if (nested.isFile() && /\.(?:js|mjs)$/.test(nested.name)) {
          roots.push(join(directory, entry.name, nested.name))
        }
      }
    } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
      roots.push(join(directory, entry.name))
    }
  }
}

let failed = 0
for (const file of roots) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) failed += 1
}
if (failed > 0) {
  console.error(`Syntax check failed for ${failed} file(s).`)
  process.exitCode = 1
} else {
  console.log(`Syntax check passed for ${roots.length} file(s).`)
}
