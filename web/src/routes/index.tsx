import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api'

export const Route = createFileRoute('/')({
  component: StartPage,
})

function StartPage() {
  const navigate = useNavigate()
  const [homeName, setHomeName] = useState('')
  const createHome = useMutation({
    mutationFn: () => api.createHome(homeName.trim()),
    onSuccess: (home) => navigate({ to: '/homes/$homeId', params: { homeId: home.id } }),
  })

  return (
    <section className="card">
      <h1>Create a home</h1>
      <p className="muted">Add the people you live with, then split bills between them.</p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          createHome.mutate()
        }}
      >
        <input
          aria-label="Home name"
          placeholder="Flat 4B"
          value={homeName}
          onChange={(event) => setHomeName(event.target.value)}
        />
        <button type="submit" disabled={createHome.isPending || homeName.trim() === ''}>
          {createHome.isPending ? 'Creating…' : 'Create home'}
        </button>
      </form>
      {createHome.isError && (
        <p className="error-text" role="alert">
          {createHome.error.message}
        </p>
      )}
    </section>
  )
}
