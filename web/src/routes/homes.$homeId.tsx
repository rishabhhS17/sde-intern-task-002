import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { type ReactNode, useRef, useState } from 'react'
import { ApiError, api, type Bill, type Member, type Share } from '../api'
import { formatCents, parseDollarsToCents } from '../money'

export const Route = createFileRoute('/homes/$homeId')({
  component: HomePage,
})

const homeQueryKey = (homeId: string) => ['home', homeId]
const billsQueryKey = (homeId: string) => ['bills', homeId]
const balancesQueryKey = (homeId: string) => ['balances', homeId]

function HomePage() {
  const { homeId } = Route.useParams()
  const homeQuery = useQuery({
    queryKey: homeQueryKey(homeId),
    queryFn: ({ signal }) => api.getHome(homeId, signal),
  })

  if (homeQuery.isPending) return <p className="muted">Loading home…</p>
  if (homeQuery.isError) {
    const isMissing = homeQuery.error instanceof ApiError && homeQuery.error.status === 404
    return isMissing ? (
      <p>
        This home does not exist. <Link to="/">Create a new home</Link>
      </p>
    ) : (
      <ErrorNotice
        message={homeQuery.error.message}
        onRetry={() => homeQuery.refetch()}
        isRetrying={homeQuery.isFetching}
      />
    )
  }

  const home = homeQuery.data
  return (
    <>
      <h1>{home.name}</h1>
      <div className="layout">
        <div className="column">
          <AddBillForm homeId={homeId} hasMembers={home.members.length > 0} />
          <BillList homeId={homeId} members={home.members} />
        </div>
        <div className="column">
          <MemberList homeId={homeId} members={home.members} />
          <BalanceList homeId={homeId} />
        </div>
      </div>
    </>
  )
}

function BillList({ homeId, members }: { homeId: string; members: Member[] }) {
  const billsQuery = useQuery({
    queryKey: billsQueryKey(homeId),
    queryFn: ({ signal }) => api.getBills(homeId, signal),
  })

  let content: ReactNode
  if (billsQuery.isPending) {
    content = <p className="muted">Loading bills…</p>
  } else if (billsQuery.isError) {
    content = (
      <ErrorNotice
        message={billsQuery.error.message}
        onRetry={() => billsQuery.refetch()}
        isRetrying={billsQuery.isFetching}
      />
    )
  } else if (billsQuery.data.bills.length === 0) {
    content = <p className="muted">No bills yet. Add the first one above.</p>
  } else {
    const memberNames = new Map(members.map((member) => [member.id, member.name]))
    content = billsQuery.data.bills.map((bill) => (
      <BillCard key={bill.id} homeId={homeId} bill={bill} memberNames={memberNames} />
    ))
  }

  return (
    <section className="card">
      <h2>Bills</h2>
      {content}
    </section>
  )
}

function BillCard(props: { homeId: string; bill: Bill; memberNames: Map<string, string> }) {
  const { homeId, bill, memberNames } = props
  return (
    <article className="bill">
      <header className="bill-header">
        <h3>{bill.title}</h3>
        <span>{formatCents(bill.totalCents)}</span>
      </header>
      <ul className="share-list">
        {bill.shares.map((share) => (
          <ShareRow
            key={share.id}
            homeId={homeId}
            billId={bill.id}
            share={share}
            memberName={memberNames.get(share.memberId) ?? 'Unknown member'}
          />
        ))}
      </ul>
    </article>
  )
}

function ShareRow(props: { homeId: string; billId: string; share: Share; memberName: string }) {
  const { homeId, billId, share, memberName } = props
  const queryClient = useQueryClient()
  // One key per payment attempt. A retry after a failure sends the same key, so if the
  // first request did reach the server, the retry gets the same answer and never pays twice.
  const idempotencyKey = useRef<string | null>(null)

  const payment = useMutation({
    mutationFn: () => {
      idempotencyKey.current ??= crypto.randomUUID()
      return api.payShare(billId, share.id, idempotencyKey.current)
    },
    onSuccess: () => {
      idempotencyKey.current = null
    },
    // Reload from the server either way. The share only shows as paid once the server says so.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: billsQueryKey(homeId) })
      queryClient.invalidateQueries({ queryKey: balancesQueryKey(homeId) })
    },
  })

  const isPaid = share.paidAt !== null
  return (
    <li className="share">
      <span className="share-member">{memberName}</span>
      <span className="share-amount">{formatCents(share.amountCents)}</span>
      {isPaid ? (
        <span className="share-action badge badge-paid">Paid</span>
      ) : (
        <button
          type="button"
          className="share-action"
          onClick={() => payment.mutate()}
          disabled={payment.isPending}
        >
          {payment.isPending ? 'Paying…' : payment.isError ? 'Try again' : 'Pay'}
        </button>
      )}
      {!isPaid && payment.isError && (
        <p className="error-text share-error" role="alert">
          Payment failed: {payment.error.message} The share is still unpaid.
        </p>
      )}
    </li>
  )
}

function AddBillForm({ homeId, hasMembers }: { homeId: string; hasMembers: boolean }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const createBill = useMutation({
    mutationFn: (totalCents: number) => api.createBill(homeId, title.trim(), totalCents),
    onSuccess: () => {
      setTitle('')
      setAmount('')
      queryClient.invalidateQueries({ queryKey: billsQueryKey(homeId) })
      queryClient.invalidateQueries({ queryKey: balancesQueryKey(homeId) })
    },
    onError: (error) => setFormError(error.message),
  })

  return (
    <section className="card">
      <h2>Add a bill</h2>
      {!hasMembers && <p className="muted">Add a member first. A bill is split between members.</p>}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          const totalCents = parseDollarsToCents(amount)
          if (totalCents === null) {
            setFormError('Enter an amount above zero, like 12 or 12.50.')
            return
          }
          setFormError(null)
          createBill.mutate(totalCents)
        }}
      >
        <input
          aria-label="Bill title"
          placeholder="Electricity"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          aria-label="Amount in dollars"
          placeholder="120.00"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <button
          type="submit"
          disabled={!hasMembers || createBill.isPending || title.trim() === '' || amount === ''}
        >
          {createBill.isPending ? 'Adding…' : 'Add bill'}
        </button>
      </form>
      {formError && (
        <p className="error-text" role="alert">
          {formError}
        </p>
      )}
    </section>
  )
}

function MemberList({ homeId, members }: { homeId: string; members: Member[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const addMember = useMutation({
    mutationFn: () => api.addMember(homeId, name.trim()),
    onSuccess: () => {
      setName('')
      queryClient.invalidateQueries({ queryKey: homeQueryKey(homeId) })
      queryClient.invalidateQueries({ queryKey: balancesQueryKey(homeId) })
    },
  })

  return (
    <section className="card">
      <h2>Members</h2>
      {members.length === 0 ? (
        <p className="muted">No members yet.</p>
      ) : (
        <ol className="plain-list">
          {members.map((member) => (
            <li key={member.id}>{member.name}</li>
          ))}
        </ol>
      )}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          addMember.mutate()
        }}
      >
        <input
          aria-label="Member name"
          placeholder="Asha"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={addMember.isPending || name.trim() === ''}>
          {addMember.isPending ? 'Adding…' : 'Add member'}
        </button>
      </form>
      {addMember.isError && (
        <p className="error-text" role="alert">
          {addMember.error.message}
        </p>
      )}
    </section>
  )
}

function BalanceList({ homeId }: { homeId: string }) {
  const balancesQuery = useQuery({
    queryKey: balancesQueryKey(homeId),
    queryFn: ({ signal }) => api.getBalances(homeId, signal),
  })

  let content: ReactNode
  if (balancesQuery.isPending) {
    content = <p className="muted">Loading balances…</p>
  } else if (balancesQuery.isError) {
    content = (
      <ErrorNotice
        message={balancesQuery.error.message}
        onRetry={() => balancesQuery.refetch()}
        isRetrying={balancesQuery.isFetching}
      />
    )
  } else if (balancesQuery.data.balances.length === 0) {
    content = <p className="muted">Nobody owes anything yet.</p>
  } else {
    content = (
      <ul className="plain-list">
        {balancesQuery.data.balances.map((balance) => (
          <li key={balance.memberId} className="balance">
            <span>{balance.name}</span>
            <span>{formatCents(balance.outstandingCents)}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="card">
      <h2>Still owed</h2>
      {content}
    </section>
  )
}

function ErrorNotice(props: { message: string; onRetry: () => void; isRetrying: boolean }) {
  return (
    <div className="notice notice-error" role="alert">
      <p>{props.message}</p>
      <button type="button" onClick={props.onRetry} disabled={props.isRetrying}>
        {props.isRetrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  )
}
