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

const MAX_IDEMPOTENCY_KEY_LENGTH = 255

billRoutes.post('/bills/:billId/shares/:shareId/pay', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
  if (!idempotencyKey) return c.json({ error: 'The Idempotency-Key header is required' }, 400)
  if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return c.json({ error: 'The Idempotency-Key header is too long' }, 400)
  }
  const { billId, shareId } = c.req.param()

  // Compare-and-set: the share is only marked paid if it is still unpaid.
  // SQLite runs writes one at a time, so when two requests race, exactly one of them
  // changes the row and the other one finds it already paid.
  const justPaid = await c.env.DB.prepare(
    `UPDATE shares SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL
     RETURNING id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt`,
  )
    .bind(new Date().toISOString(), idempotencyKey, shareId, billId)
    .first<Share>()
  if (justPaid) return c.json(justPaid, 200)

  // Nothing changed: the share does not exist on this bill, or it was already paid.
  const existing = await c.env.DB.prepare(
    `SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt,
            idempotency_key AS idempotencyKey
     FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<Share & { idempotencyKey: string | null }>()
  if (!existing) return c.json({ error: 'Bill or share not found' }, 404)

  // The same key again is a retry of the request that paid it: answer with the same result.
  if (existing.idempotencyKey !== idempotencyKey) {
    return c.json({ error: 'This share has already been paid' }, 409)
  }
  return c.json(
    {
      id: existing.id,
      memberId: existing.memberId,
      amountCents: existing.amountCents,
      paidAt: existing.paidAt,
    },
    200,
  )
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
