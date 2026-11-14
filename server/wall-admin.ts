// Takes junk off the hall wall by hand. Nothing is deleted: a hidden guest stays in the database with hidden = 1.
//   bun wall-admin.ts list             the newest 40 hall guests: id, name, origin, source tag, pings
//   bun wall-admin.ts hide <id|name>   take one guest (or everyone with that nickname) off the wall
//   bun wall-admin.ts hide-src <tag>   take everyone from one source address off the wall (a flood)
//   bun wall-admin.ts show <id|name>   put them back
// Uses VIRE_DB like the server (default ./vire.sqlite). The wall follows within a few seconds.
import { db } from './db'

const [cmd, arg] = process.argv.slice(2)
const set = (where: string, on: number) => db.query(`UPDATE users SET hidden = ? WHERE visitor = 1 AND ${where}`).run(on, arg ?? '', arg ?? '').changes

if (cmd === 'list') {
  const rows = db
    .query(
      `SELECT u.id, u.name, u.via, u.src, u.hidden, u.created_at, COUNT(p.id) AS pings FROM users u LEFT JOIN pings p ON p.user_id = u.id
       WHERE u.visitor = 1 GROUP BY u.id ORDER BY u.created_at DESC LIMIT 40`,
    )
    .all() as { id: string; name: string; via: string | null; src: string | null; hidden: number; created_at: string; pings: number }[]
  for (const r of rows) console.log(`${r.id}  ${r.created_at.slice(5, 16)}  ${(r.via ?? '-').padEnd(6)}  ${(r.src ?? '-').padEnd(8)}  ${r.pings} ping(s)  ${r.hidden ? '[hidden] ' : ''}${r.name}`)
  console.log(`${rows.length} shown`)
} else if (cmd === 'hide' && arg) {
  console.log(`${set('(id = ? OR name = ?)', 1)} hidden`)
} else if (cmd === 'show' && arg) {
  console.log(`${set('(id = ? OR name = ?)', 0)} shown again`)
} else if (cmd === 'hide-src' && arg) {
  console.log(`${set('(src = ? OR src = ?)', 1)} hidden`)
} else {
  console.error('usage: bun wall-admin.ts list | hide <id|name> | show <id|name> | hide-src <tag>')
  process.exit(1)
}
