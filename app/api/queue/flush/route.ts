import { NextResponse } from 'next/server';
import { publishPendingDocuments } from '@/lib/queue/publisher';

export async function POST() {
  try {
    const result = await publishPendingDocuments();
    return NextResponse.json({
      success: true,
      message: `Successfully moved data objects down the pipeline.`,
      queuedCount: result.queuedCount,
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Pipeline flush execution failure',
    }, { status: 500 });
  }
}

// setting up revalidation to prevent caching of this endpoint