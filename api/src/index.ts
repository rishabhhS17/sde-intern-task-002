import { Hono } from 'hono'
import { billRoutes } from './routes/bills'
import { homeRoutes } from './routes/homes'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.route('/api', homeRoutes)
app.route('/api', billRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Something went wrong on the server' }, 500)
})

export default app
