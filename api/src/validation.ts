import { z } from 'zod'

export const nameSchema = z.object({
  name: z.string().trim().min(1, 'name must not be empty').max(100),
})

export const newBillSchema = z.object({
  title: z.string().trim().min(1, 'title must not be empty').max(200),
  // z.int() only accepts safe whole numbers: 10.5, "1000" and null are all rejected.
  totalCents: z
    .int('totalCents must be a whole number of cents')
    .positive('totalCents must be greater than zero'),
})

type ParsedBody<Data> = { data: Data } | { error: string; status: 400 | 422 }

// Reads the JSON body and checks it against the schema.
// Broken JSON is a 400, valid JSON with wrong fields is a 422.
export async function parseJsonBody<Data>(
  request: Request,
  schema: z.ZodType<Data>,
): Promise<ParsedBody<Data>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return { error: 'Request body must be valid JSON', status: 400 }
  }

  const result = schema.safeParse(json)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue?.path.join('.')
    const message = issue?.message ?? 'Invalid request body'
    return { error: field ? `${field}: ${message}` : message, status: 422 }
  }
  return { data: result.data }
}
