export enum TaskType {
  LAUNCH_BROWSER              = "LAUNCH_BROWSER",
  PAGE_TO_HTML                = "PAGE_TO_HTML",
  EXTRACT_TEXT_FROM_ELEMENT   = "EXTRACT_TEXT_FROM_ELEMENT",

  SLACK_SOURCE                = "SLACK_SOURCE",
  NOTION_SOURCE               = "NOTION_SOURCE",
  GMAIL_SOURCE                = "GMAIL_SOURCE",
  DRIVE_SOURCE                = "DRIVE_SOURCE",
  JIRA_SOURCE                 = "JIRA_SOURCE",
  LINEAR_SOURCE               = "LINEAR_SOURCE",
  GITHUB_SOURCE               = "GITHUB_SOURCE",
  CONFLUENCE_SOURCE           = "CONFLUENCE_SOURCE",
  CUSTOM_API_SOURCE           = "CUSTOM_API_SOURCE",

  NORMALIZER                  = "NORMALIZER",
  PII_SCRUBBER                = "PII_SCRUBBER",
  CHUNKER                     = "CHUNKER",
  EMBEDDER                    = "EMBEDDER",
  DEDUPLICATOR                = "DEDUPLICATOR",
  VECTOR_STORE                = "VECTOR_STORE",

  RAG_ENGINE                  = "RAG_ENGINE",
  ANALYSIS_AGENT              = "ANALYSIS_AGENT",
  FORECAST_ENGINE             = "FORECAST_ENGINE",

  WEBHOOK_OUTPUT              = "WEBHOOK_OUTPUT",
  SLACK_OUTPUT                = "SLACK_OUTPUT",
}

export enum TaskParamType {
  STRING           = "STRING",
  BROWSER_INSTANCE = "BROWSER_INSTANCE",
  DATA_STREAM      = "DATA_STREAM",
  VECTOR_STREAM    = "VECTOR_STREAM",
  CREDENTIAL       = "CREDENTIAL",
  SELECT           = "SELECT",
  NUMBER           = "NUMBER",
  BOOLEAN          = "BOOLEAN", 
  GMAIL_CONNECT    = "GMAIL_CONNECT",
  NOTION_CONNECT   = "NOTION_CONNECT",
  GITHUB_CONNECT   = "GITHUB_CONNECT",
  CUSTOM_CONNECT   = "CUSTOM_CONNECT",
  SLACK_CONNECT    = "SLACK_CONNECT",
  DRIVE_CONNECT    = "DRIVE_CONNECT",
}

export interface TaskParam {
  name: string;
  type: TaskParamType;
  helperText?: string;
  required?: boolean;
  hideHandle?: boolean;
  value?: string;
  options?: { label: string; value: string }[];
  [key: string]: any;
}