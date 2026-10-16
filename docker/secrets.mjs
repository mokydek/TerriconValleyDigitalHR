// Генерирует секреты локального стека при первом запуске.
// Они живут только в docker-томе `secrets` — в репозитории и образах их нет.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const dir = process.env.SECRETS_DIR ?? '/secrets'
const ensure = (name, make) => {
  const file = `${dir}/${name}`
  if (!existsSync(file)) writeFileSync(file, make(), { mode: 0o644 })
  return readFileSync(file, 'utf8')
}

ensure('jwt_secret', () => randomBytes(48).toString('base64url'))
const password = ensure('db_password', () => randomBytes(24).toString('hex'))
ensure('pgrst_db_uri', () => `postgres://authenticator:${password}@db:5432/postgres`)
console.log('secrets: ok')
