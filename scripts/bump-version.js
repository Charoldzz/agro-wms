import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const versionFile = resolve(root, 'public/app-version.json')
const boliviaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date()).replaceAll('-', '.')

function readCurrentVersion() {
  try {
    const data = JSON.parse(readFileSync(versionFile, 'utf8'))
    return String(data.version || '')
  } catch {
    return ''
  }
}

const currentVersion = readCurrentVersion()
const currentMatch = currentVersion.match(/^v(\d{4}\.\d{2}\.\d{2})-r(\d+)$/)
const nextRevision = currentMatch?.[1] === boliviaDate ? Number(currentMatch[2]) + 1 : 1
const version = `v${boliviaDate}-r${nextRevision}`

writeFileSync(
  versionFile,
  JSON.stringify({ version }, null, 2) + '\n'
)

writeFileSync(
  resolve(root, 'src/lib/version.js'),
  `export const APP_VERSION = '${version}'\nexport const APP_VERSION_LABEL = \`\${APP_VERSION}\`\n`
)

console.log(`Version bumped to ${version}`)
