import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const now = new Date()
const pad = n => String(n).padStart(2, '0')
const version = `v${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}.${pad(now.getHours())}${pad(now.getMinutes())}`

writeFileSync(
  resolve(root, 'public/app-version.json'),
  JSON.stringify({ version }, null, 2) + '\n'
)

writeFileSync(
  resolve(root, 'src/lib/version.js'),
  `export const APP_VERSION = '${version}'\nexport const APP_VERSION_LABEL = \`\${APP_VERSION}\`\n`
)

console.log(`Version bumped to ${version}`)
