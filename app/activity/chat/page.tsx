import ChatClient from "./_components/ChatClient";
import { getConversation } from "@/actions/chats/chatHistory";

/**
 * Live chat. Pass ?c=<conversationId> to resume a saved conversation —
 * the Chat Logs page links here for "Continue in chat".
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const initialConversation = c ? await getConversation(c).catch(() => null) : null;

  return <ChatClient initialConversation={initialConversation} />;
}
