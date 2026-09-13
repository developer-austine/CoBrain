import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'

interface IngestBody {
  externalId: string
  source: string
  data: Record<string, any>
  timestamp?: string
}

function verifyApiKey(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer custom_')) return null
  const [, clientId, secret] = authHeader.split('_') // Bearer custom_clxxx_secret
  return { clientId, secret }
}

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req.headers.get('authorization'))
  if (!auth) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const conn = await prisma.customConnection.findUnique({
    where: { clientId: auth.clientId }
  })

  if (!conn || conn.clientSecret!== `cs_${auth.secret}`)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 403 })

  const body: IngestBody = await req.json()
  const contentHash = createHash('sha256').update(JSON.stringify(body.data)).digest('hex')

  // Dedupe: skip if hash matches existing doc
  const existing = await prisma.customDocument.findUnique({
    where: { connectionId_externalId: { connectionId: conn.id, externalId: body.externalId } }
  })

  if (existing?.contentHash === contentHash) {
    return NextResponse.json({ status: 'skipped', reason: 'unchanged' })
  }

  const doc = await prisma.customDocument.upsert({
    where: { connectionId_externalId: { connectionId: conn.id, externalId: body.externalId } },
    create: {
      connectionId: conn.id,
      externalId: body.externalId,
      source: body.source,
      contentHash,
      rawPayload: body.data,
      status: 'PENDING'
    },
    update: {
      contentHash,
      rawPayload: body.data,
      status: 'PENDING',
      updatedAt: new Date()
    }
  })

  // Push to Redis - same shape as Gmail/Notion
  const queuePayload = {
    documentId: doc.id,
    connectionId: conn.id,
    provider: 'custom',
    source: body.source,
    externalId: body.externalId,
    payload: body.data,
    metadata: {
      workflowId: conn.workflowId,
      nodeId: conn.nodeId,
      userId: conn.userId
    }
  }

  // await redis.lpush('company_brain:ingest', JSON.stringify(queuePayload))
  await prisma.customDocument.update({ where: { id: doc.id }, data: { status: 'QUEUED', queuedAt: new Date() } })
  await prisma.customConnection.update({
    where: { id: conn.id },
    data: { status: 'CONNECTED', lastSyncAt: new Date() }
  })

  return NextResponse.json({ status: 'queued', documentId: doc.id })
}