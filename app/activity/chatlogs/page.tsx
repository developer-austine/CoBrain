import { listConversations } from "@/actions/chats/chatHistory";
import ChatLogsClient from "./_components/ChatLogsClient";

/** Chat history browser: conversation list · thread viewer · details panel. */
export default async function ChatLogsPage() {
  const conversations = await listConversations();
  return <ChatLogsClient initialConversations={conversations} />;
}
