/** A resolved source citation attached to an assistant answer. */
export type Citation = {
  source: string;
  title: string;
  url: string | null;
  author: string | null;
  snippet: string;
};

export type ChatRole = "user" | "assistant";

/** Message shape shared by the live chat and the chat logs viewer. */
export type ChatMessageDTO = {
  id: string;
  role: ChatRole;
  content: string;
  citations?: Citation[];
  createdAt: string; // ISO — serializable across the server/client boundary
};

/** List-pane summary of a conversation. */
export type ConversationSummary = {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Full conversation detail for the logs viewer. */
export type ConversationDetail = ConversationSummary & {
  messages: ChatMessageDTO[];
};
