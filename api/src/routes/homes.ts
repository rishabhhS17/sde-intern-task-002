import { Hono } from 'hono'
import { homeExists } from '../db'
import { nameSchema, parseJsonBody } from '../validation'

export const homeRoutes = new Hono<{ Bindings: Env }>()

homeRoutes.post('/homes', async (c) => {
  const body = await parseJsonBody(c.req.raw, nameSchema)
  if ('error' in body) return c.json({ error: body.error }, body.status)

  const home = { id: crypto.randomUUID(), name: body.data.name }
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
    .bind(home.id, home.name)
    .run()
  return c.json(home, 201)
})

homeRoutes.get('/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()
  if (!home) return c.json({ error: 'Home not found' }, 404)

  const { results: members } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, name FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string }>()
  return c.json({ ...home, members })
})

homeRoutes.post('/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await parseJsonBody(c.req.raw, nameSchema)
  if ('error' in body) return c.json({ error: body.error }, body.status)

  // One statement finds the home and takes the next position, so two members
  // added at the same time can never get the same place in the order.
  // If the home does not exist, the SELECT finds no row and nothing is inserted.
  const member = { id: crypto.randomUUID(), homeId, name: body.data.name }
  const inserted = await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position)
     SELECT ?, homes.id, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM members WHERE home_id = homes.id)
     FROM homes WHERE homes.id = ?`,
  )
    .bind(member.id, member.name, homeId)
    .run()
  if (inserted.meta.changes === 0) return c.json({ error: 'Home not found' }, 404)

  return c.json(member, 201)
})

homeRoutes.get('/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) return c.json({ error: 'Home not found' }, 404)

  const { results: balances } = await c.env.DB.prepare(
    `SELECT members.id AS memberId,
            members.name AS name,
            COALESCE(SUM(CASE WHEN shares.paid_at IS NULL THEN shares.amount_cents ELSE 0 END), 0)
              AS outstandingCents
     FROM members
     LEFT JOIN shares ON shares.member_id = members.id
     WHERE members.home_id = ?
     GROUP BY members.id
     ORDER BY members.position`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()
  return c.json({ balances })
})
