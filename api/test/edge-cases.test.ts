import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Balance, type Bill, call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

async function outstandingCents(homeId: string) {
  const response = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
  return response.body.balances.map((balance) => balance.outstandingCents)
}

async function setupBill(totalCents: number) {
  const { homeId, members } = await createHome(['Asha', 'Ben'])
  const bill = await createBill(homeId, totalCents)
  const firstShare = bill.body.shares[0]
  if (!firstShare) throw new Error('bill has no shares')
  return { homeId, members, bill: bill.body, firstShare }
}

describe('paying the same share at the same time', () => {
  it('lets only one of two different keys win', async () => {
    const { homeId, bill, firstShare } = await setupBill(1000)

    const results = await Promise.all([
      pay(bill.id, firstShare.id, crypto.randomUUID()),
      pay(bill.id, firstShare.id, crypto.randomUUID()),
      pay(bill.id, firstShare.id, crypto.randomUUID()),
    ])

    const statuses = results.map((result) => result.status).sort()
    expect(statuses).toEqual([200, 409, 409])
    expect(await outstandingCents(homeId)).toEqual([0, 500])
  })

  it('answers the same key sent at the same time with one result', async () => {
    const { homeId, bill, firstShare } = await setupBill(1000)
    const key = crypto.randomUUID()

    const [first, second] = await Promise.all([
      pay(bill.id, firstShare.id, key),
      pay(bill.id, firstShare.id, key),
    ])

    expect(first?.status).toBe(200)
    expect(second?.status).toBe(200)
    expect(second?.body.paidAt).toBe(first?.body.paidAt)
    expect(await outstandingCents(homeId)).toEqual([0, 500])
  })
})

describe('paying a share', () => {
  it('returns 404 for a share that belongs to another bill', async () => {
    const { bill } = await setupBill(1000)
    const other = await setupBill(2000)

    const paid = await pay(bill.id, other.firstShare.id, crypto.randomUUID())

    expect(paid.status).toBe(404)
    expect(paid.body).toEqual({ error: expect.any(String) })
  })

  it('rejects a blank Idempotency-Key', async () => {
    const { bill, firstShare } = await setupBill(1000)

    const paid = await pay(bill.id, firstShare.id, '   ')

    expect(paid.status).toBe(400)
  })

  it('keeps the original paidAt on a retry', async () => {
    const { bill, firstShare } = await setupBill(1000)
    const key = crypto.randomUUID()

    const first = await pay(bill.id, firstShare.id, key)
    const retry = await pay(bill.id, firstShare.id, key)

    expect(retry.body).toEqual(first.body)
  })
})

describe('splitting amounts that do not divide evenly', () => {
  it.each([
    [100, 3, [34, 33, 33]],
    [2, 3, [1, 1, 0]],
    [7, 4, [2, 2, 2, 1]],
  ])('splits %i cents between %i members', async (totalCents, memberCount, expected) => {
    const names = Array.from({ length: memberCount }, (_, index) => `Member ${index + 1}`)
    const { homeId } = await createHome(names)

    const bill = await createBill(homeId, totalCents)

    expect(bill.body.shares.map((share) => share.amountCents)).toEqual(expected)
  })
})

describe('validating input', () => {
  it.each([Number.MAX_SAFE_INTEGER + 1, '', true, [], {}])(
    'rejects the amount %j',
    async (totalCents) => {
      const { homeId } = await createHome(['Asha'])

      const bill = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Rent', totalCents },
      })

      expect(bill.status).toBe(422)
      expect(bill.body).toEqual({ error: expect.any(String) })
    },
  )

  it('rejects a bill without a title', async () => {
    const { homeId } = await createHome(['Asha'])

    const bill = await call('POST', `/api/homes/${homeId}/bills`, { body: { totalCents: 100 } })

    expect(bill.status).toBe(422)
  })

  it.each([{}, { name: '' }, { name: '   ' }, { name: 42 }])(
    'rejects the home body %j',
    async (body) => {
      const home = await call('POST', '/api/homes', { body })

      expect(home.status).toBe(422)
      expect(home.body).toEqual({ error: expect.any(String) })
    },
  )

  it('rejects a body that is not JSON', async () => {
    const response = await exports.default.fetch(
      new Request('http://localhost/api/homes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expect.any(String) })
  })
})

describe('homes and bills', () => {
  it('does not charge a member for bills from before they joined', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 1000)
    await call('POST', `/api/homes/${homeId}/members`, { body: { name: 'Chitra' } })

    expect(await outstandingCents(homeId)).toEqual([500, 500, 0])
  })

  it('lists the bills of a home with their shares', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 1001)

    const bills = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(bills.status).toBe(200)
    expect(bills.body.bills).toHaveLength(1)
    expect(bills.body.bills[0]?.shares).toEqual([
      { id: expect.any(String), memberId: members[0]?.id, amountCents: 501, paidAt: null },
      { id: expect.any(String), memberId: members[1]?.id, amountCents: 500, paidAt: null },
    ])
  })

  it('returns 404 for the bills of a home that does not exist', async () => {
    const bills = await call('GET', '/api/homes/does-not-exist/bills')

    expect(bills.status).toBe(404)
  })

  it('answers an unknown route with a JSON error', async () => {
    const response = await call('GET', '/api/nothing-here')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })
})
