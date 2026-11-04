export type Member = { id: string; homeId: string; name: string }
export type Home = { id: string; name: string; members: Member[] }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

// A request that takes longer than this is treated as failed, so the page never waits forever.
const REQUEST_TIMEOUT_MS = 10_000

export class ApiError extends Error {
  // null when the request never got an answer (offline or timed out).
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<Result>(path: string, options: RequestOptions = {}): Promise<Result> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    })
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new ApiError('The server took too long to answer. Please try again.', null)
    }
    // Cancelled by React Query (for example the user left the page): let it handle that.
    if (options.signal?.aborted) throw error
    throw new ApiError('Could not reach the server. Check your connection and try again.', null)
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      readErrorMessage(body) ?? `The server answered with an error (${response.status}).`
    throw new ApiError(message, response.status)
  }
  if (body === null) throw new ApiError('The server sent an answer we could not read.', null)
  return body as Result
}

function readErrorMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    return typeof body.error === 'string' ? body.error : null
  }
  return null
}

const homePath = (homeId: string) => `/homes/${encodeURIComponent(homeId)}`

export const api = {
  createHome: (name: string) =>
    request<{ id: string; name: string }>('/homes', { method: 'POST', body: { name } }),

  getHome: (homeId: string, signal?: AbortSignal) => request<Home>(homePath(homeId), { signal }),

  addMember: (homeId: string, name: string) =>
    request<Member>(`${homePath(homeId)}/members`, { method: 'POST', body: { name } }),

  getBills: (homeId: string, signal?: AbortSignal) =>
    request<{ bills: Bill[] }>(`${homePath(homeId)}/bills`, { signal }),

  createBill: (homeId: string, title: string, totalCents: number) =>
    request<Bill>(`${homePath(homeId)}/bills`, { method: 'POST', body: { title, totalCents } }),

  getBalances: (homeId: string, signal?: AbortSignal) =>
    request<{ balances: Balance[] }>(`${homePath(homeId)}/balances`, { signal }),

  payShare: (billId: string, shareId: string, idempotencyKey: string) =>
    request<Share>(
      `/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
    ),
}
