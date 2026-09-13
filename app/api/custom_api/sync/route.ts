import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

// This route is called by Vercel Cron or manually from UI
// It hits the in-house system's API using stored creds
export async function POST(req: NextRequest) {
  const headersList = await headers()
  const cookie = headersList.get('cookie')

  const session = await auth.api.getSession({
    headers: { cookie: cookie || '' },
  })

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const { workflowId, nodeId } = await req.json()
  // 1. Get CustomConnection + cursor
  // 2. Call in-house API: GET https://internal.corp/api/data?since=cursor
  // with Header: Authorization: Bearer <their API key to us>
  // 3. For each record, POST to /api/custom/ingest internally
  // 4. Update CustomSyncCursor
  return NextResponse.json({ synced: 42 })
}