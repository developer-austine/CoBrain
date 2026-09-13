import { TaskParamType } from "@/types/task";

export const colorForHandle: Record<TaskParamType, string> = {
  BROWSER_INSTANCE: "!bg-sky-400",
  STRING:           "!bg-amber-400",
  DATA_STREAM:      "!bg-teal-400",
  VECTOR_STREAM:    "!bg-purple-400",
  CREDENTIAL:       "!bg-rose-400",
  SELECT:           "!bg-orange-400",
  NUMBER:           "!bg-blue-400",
  BOOLEAN:          "!bg-green-400",
  GMAIL_CONNECT:    "!bg-red-400",
  NOTION_CONNECT:   "!bg-slate-400",
  GITHUB_CONNECT:   "!bg-gray-400",
  CUSTOM_CONNECT:   "!bg-pink-400",
  SLACK_CONNECT:    "!bg-violet-400",
  DRIVE_CONNECT:    "!bg-yellow-400"
};