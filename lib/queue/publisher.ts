import Redis from 'ioredis';
import prisma from '../prisma';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379/0';
export const redis = new Redis(redisUrl);

// Uniform payload contract expected by Python/Celery worker
interface QueuePayload {
  id: string;
  source: 'SLACK' | 'NOTION' | 'GMAIL' | 'GITHUB' | 'CUSTOM';
  content: string;
  metadata: {
    title?: string;
    author?: string;
    url?: string;
    timestamp?: string;
  };
}

export async function publishPendingDocuments(): Promise<{ queuedCount: number }> {
  let totalQueued = 0;
  const targetStatus = 'PENDING';
  const queuedStatus = 'QUEUED';
  const queueName = 'company_brain:ingest'; // Match Redis dataflow queue name

  // --- 1. PROCESS CUSTOM DOCUMENTS ---
  const pendingCustomDocs = await prisma.customDocument.findMany({
    where: { status: targetStatus },
    take: 50, // Batch limit to preserve memory
  });

  for (const doc of pendingCustomDocs) {
    const payload: QueuePayload = {
      id: doc.id,
      source: 'CUSTOM',
      content: JSON.stringify(doc.rawPayload),
      metadata: {
        title: `Custom Doc ${doc.externalId}`,
        timestamp: doc.createdAt.toISOString(),
      },
    };

    // Atomic transaction: Push to Redis + Update Postgres Status
    await redis.lpush(queueName, JSON.stringify(payload));
    await prisma.customDocument.update({
      where: { id: doc.id },
      data: { status: queuedStatus, queuedAt: new Date() },
    });
    totalQueued++;
  }

  // --- 2. PROCESS NOTION PAGES ---
  const pendingNotionPages = await prisma.notionPage.findMany({
    where: { status: targetStatus },
    take: 50,
  });

  for (const page of pendingNotionPages) {
    const payload: QueuePayload = {
      id: page.id,
      source: 'NOTION',
      content: page.plainText || '',
      metadata: {
        title: page.title || undefined,
        author: page.createdByName || undefined,
        url: page.url || undefined,
        timestamp: page.syncedAt.toISOString(),
      },
    };

    await redis.lpush(queueName, JSON.stringify(payload));
    await prisma.notionPage.update({
      where: { id: page.id },
      data: { status: queuedStatus, queuedAt: new Date() },
    });
    totalQueued++;
  }

  return { queuedCount: totalQueued };
}