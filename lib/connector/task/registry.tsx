import { ExtractTexFromElementTask } from "./ExtractTextFromElement";
import { LaunchBrowserTask }         from "./LaunchBrowser";
import { PageToHtmlTask }            from "./PageToHtml";
import {
  SlackSourceTask, NotionSourceTask, GmailSourceTask, DriveSourceTask,
  JiraSourceTask, LinearSourceTask, GitHubSourceTask, ConfluenceSourceTask,
  CustomAPISourceTask,
  NormalizerTask, PIIScrubberTask, ChunkerTask, EmbedderTask,
  VectorStoreTask, DeduplicatorTask,
  RAGEngineTask, AnalysisAgentTask, ForecastEngineTask,
} from "./companyBrainTask";

export const TaskRegistry = {
  LAUNCH_BROWSER:            LaunchBrowserTask,
  PAGE_TO_HTML:              PageToHtmlTask,
  EXTRACT_TEXT_FROM_ELEMENT: ExtractTexFromElementTask,
  SLACK_SOURCE:              SlackSourceTask,
  NOTION_SOURCE:             NotionSourceTask,
  GMAIL_SOURCE:              GmailSourceTask,
  DRIVE_SOURCE:              DriveSourceTask,
  JIRA_SOURCE:               JiraSourceTask,
  LINEAR_SOURCE:             LinearSourceTask,
  GITHUB_SOURCE:             GitHubSourceTask,
  CONFLUENCE_SOURCE:         ConfluenceSourceTask,
  CUSTOM_API_SOURCE:         CustomAPISourceTask,
  NORMALIZER:                NormalizerTask,
  PII_SCRUBBER:              PIIScrubberTask,
  CHUNKER:                   ChunkerTask,
  EMBEDDER:                  EmbedderTask,
  DEDUPLICATOR:              DeduplicatorTask,
  VECTOR_STORE:              VectorStoreTask,
  RAG_ENGINE:                RAGEngineTask,
  ANALYSIS_AGENT:            AnalysisAgentTask,
  FORECAST_ENGINE:           ForecastEngineTask,
} as const;