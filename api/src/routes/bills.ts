import { Hono } from 'hono'
import { homeExists } from '../db'
import { splitTotalCents } from '../split'
import { newBillSchema, parseJsonBody } from '../validation'

type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }

export const billRoutes = new Hono<{ Bindings: Env }>()

billRoutes.post('/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await parseJsonBody(c.req.raw, newBillSchema)
  if ('error' in body) return c.json({ error: body.error }, body.status)
  if (!(await homeExists(c.env.DB, homeId))) return c.json({ error: 'Home not found' }, 404)

  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) {
    return c.json({ error: 'The home has no members to split the bill between' }, 422)
  }

  const { title, totalCents } = body.data
  const billId = crypto.randomUUID()
  const shares: Share[] = splitTotalCents(totalCents, members).map(({ member, amountCents }) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents,
    paidAt: null,
  }))

  // batch() runs as one transaction: the bill and all of its shares are saved together or not at all.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents, new Date().toISOString()),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

billRoutes.get('/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) return c.json({ error: 'Home not found' }, 404)

  const { results: bills } = await c.env.DB.prepare(
    `SELECT id, home_id AS homeId, title, total_cents AS totalCents
     FROM bills WHERE home_id = ?
     ORDER BY created_at DESC, rowid DESC`,
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number }>()

  const { results: shareRows } = await c.env.DB.prepare(
    `SELECT shares.id, shares.bill_id AS billId, shares.member_id AS memberId,
            shares.amount_cents AS amountCents, shares.paid_at AS paidAt
     FROM shares
     JOIN bills ON bills.id = shares.bill_id
     JOIN members ON members.id = shares.member_id
     WHERE bills.home_id = ?
     ORDER BY members.position`,
  )
    .bind(homeId)
    .all<Share & { billId: string }>()

  const billsWithShares = bills.map((bill) => ({
    ...bill,
    shares: shareRows
      .filter((share) => share.billId === bill.id)
      .map((share) => ({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      })),
  }))
  return c.json({ bills: billsWithShares })
})
