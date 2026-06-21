import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const versionFile = resolve(root, 'public/app-version.json')
const libFile = resolve(root, 'src/lib/version.js')

const todayBolivia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

let stored = {}
try { stored = JSON.parse(readFileSync(versionFile, 'utf8')) } catch {}

const count = stored.date === todayBolivia ? (stored.count || 0) + 1 : 1
const version = `v${count}`

writeFileSync(versionFile, JSON.stringify({ version, date: todayBolivia, count }, null, 2) + '\n')
writeFileSync(libFile, `export const APP_VERSION = '${version}'\nexport const APP_VERSION_LABEL = \`\${APP_VERSION}\`\n`)

console.log(`Version: ${version} (${todayBolivia}, actualización #${count} del día)`)
