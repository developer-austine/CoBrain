"use server";

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { deriveConversationTitle, truncateWords, cleanForDisplay } from "@/lib/chat/format";
import type {
  ChatMessageDTO,
  Citation,
  ConversationDetail,
  ConversationSummary,
} from "@/lib/chat/types";

/**
 * Chat history CRUD. Every operation is scoped to the signed-in user — a
 * conversation id from another user 404s (returns null) rather than leaking.
 */

async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");
  return userId;
}

/** Start a new conversation titled after the user's first question. */
export async function createConversation(firstQuestion: string): Promise<{ id: string }> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const conversation = await prisma.chatConversation.create({
      data: { userId, title: deriveConversationTitle(firstQuestion) },
      select: { id: true },
    });
    return conversation;
  });
}

/** Append a message; bumps the conversation's updatedAt for list ordering. */
export async function appendChatMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  citations?: Citation[]
): Promise<{ id: string } | null> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {

    // Ownership check — never write into someone else's conversation.
    const owned = await prisma.chatConversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!owned) return null;

    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          conversationId,
          role,
          content,
          citations: citations && citations.length ? (citations as object[]) : undefined,
        },
        select: { id: true },
      }),
      prisma.chatConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return message;
  });
}

/** Conversation list for the logs page, newest activity first. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {

    const conversations = await prisma.chatConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true, content: true },
        },
      },
    });

    return conversations.map((c) => {
      const last = c.messages[0];
      const prefix = last?.role === "user" ? "User: " : last ? "AI: " : "";
      return {
        id: c.id,
        title: c.title,
        preview: last ? prefix + truncateWords(cleanForDisplay(last.content), 90) : "No messages",
        messageCount: c._count.messages,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  });
}

/** Full conversation with messages + citations for the logs viewer / resume. */
export async function getConversation(id: string): Promise<ConversationDetail | null> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {

    const c = await prisma.chatConversation.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, role: true, content: true, citations: true, createdAt: true },
        },
      },
    });
    if (!c) return null;

    const messages: ChatMessageDTO[] = c.messages.map((m) => ({
      id: m.id,
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      citations: (m.citations as Citation[] | null) ?? undefined,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      id: c.id,
      title: c.title,
      preview: "",
      messageCount: messages.length,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messages,
    };
  });
}

/** Delete a conversation (cascades to its messages). */
export async function deleteConversation(id: string): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const result = await prisma.chatConversation.deleteMany({ where: { id, userId } });
    return result.count > 0;
  });
}
