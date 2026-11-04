export async function homeExists(db: D1Database, homeId: string): Promise<boolean> {
  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  return home !== null
}
