import { TaskParamType, TaskType } from "@/types/task";
import { LucideProps } from "lucide-react";
import {
  SlackIcon, NotionIcon, GmailIcon, GoogleDriveIcon,
  JiraIcon, LinearIcon, GitHubIcon, ConfluenceIcon,
  NormalizerIcon, PIIScrubberIcon, ChunkerIcon,
  EmbedderIcon, VectorDBIcon, RAGIcon, AnalysisIcon,
  ForecastIcon,
} from "@/assets/connector-icons";

export const SlackSourceTask = {
  type: TaskType.SLACK_SOURCE,
  label: "Slack",
  description: "Ingest messages and threads from a Slack workspace.",
  icon: (props: LucideProps) => <SlackIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "OAuth Token", type: TaskParamType.SLACK_CONNECT, required: true,  hideHandle: true },
    { name: "Channel IDs", type: TaskParamType.STRING,     required: false, hideHandle: true,
      helperText: "Comma-separated, e.g. C01234,C05678. Leave blank for all." },
    { name: "Since Date",  type: TaskParamType.STRING,     required: false, hideHandle: true,
      helperText: "ISO 8601, e.g. 2020-01-01" },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const NotionSourceTask = {
  type: TaskType.NOTION_SOURCE,
  label: "Notion",
  description: "Ingest pages and databases from Notion.",
  icon: (props: LucideProps) => <NotionIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "API Key",         type: TaskParamType.NOTION_CONNECT, required: true,  hideHandle: true },
    { name: "Database / Page", type: TaskParamType.STRING,     required: false, hideHandle: true,
      helperText: "Leave blank to ingest entire workspace." },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const GmailSourceTask = {
  type: TaskType.GMAIL_SOURCE,
  label: "Gmail",
  description: "Ingest emails via Gmail API (OAuth2).",
  icon: (props: LucideProps) => <GmailIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "OAuth Token",  type: TaskParamType.GMAIL_CONNECT, required: true,  hideHandle: true },
    { name: "Label Filter", type: TaskParamType.STRING,     required: false, hideHandle: true,
      helperText: "e.g. INBOX, IMPORTANT" },
    { name: "Max Results",  type: TaskParamType.NUMBER,     required: false, hideHandle: true,
      value: "500" },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const DriveSourceTask = {
  type: TaskType.DRIVE_SOURCE,
  label: "Google Drive",
  description: "Ingest documents and spreadsheets from Google Drive.",
  icon: (props: LucideProps) => <GoogleDriveIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "OAuth Token", type: TaskParamType.DRIVE_CONNECT, required: true,  hideHandle: true },
    { name: "Folder ID",   type: TaskParamType.STRING,     required: false, hideHandle: true,
      helperText: "Leave blank for My Drive root." },
    { name: "File Types",  type: TaskParamType.SELECT,     required: false, hideHandle: true,
      options: [
        { label: "All",    value: "all" },
        { label: "Docs",   value: "docs" },
        { label: "Sheets", value: "sheets" },
        { label: "PDFs",   value: "pdf" },
      ],
      value: "all" },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const JiraSourceTask = {
  type: TaskType.JIRA_SOURCE,
  label: "Jira",
  description: "Ingest issues, comments, and sprint data from Jira.",
  icon: (props: LucideProps) => <JiraIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "API Token",   type: TaskParamType.CREDENTIAL, required: true,  hideHandle: true },
    { name: "Domain",      type: TaskParamType.STRING,     required: true,  hideHandle: true,
      helperText: "e.g. mycompany.atlassian.net" },
    { name: "Project Key", type: TaskParamType.STRING,     required: false, hideHandle: true },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const LinearSourceTask = {
  type: TaskType.LINEAR_SOURCE,
  label: "Linear",
  description: "Ingest issues and project data from Linear.",
  icon: (props: LucideProps) => <LinearIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "API Key",  type: TaskParamType.CREDENTIAL, required: true,  hideHandle: true },
    { name: "Team IDs", type: TaskParamType.STRING,     required: false, hideHandle: true },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const GitHubSourceTask = {
  type: TaskType.GITHUB_SOURCE,
  label: "GitHub",
  description: "Ingest issues, PRs, and discussions from GitHub.",
  icon: (props: LucideProps) => <GitHubIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "Personal Access Token", type: TaskParamType.GITHUB_CONNECT, required: true,  hideHandle: true },
    { name: "Repository",            type: TaskParamType.STRING,     required: true,  hideHandle: true,
      helperText: "owner/repo" },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const ConfluenceSourceTask = {
  type: TaskType.CONFLUENCE_SOURCE,
  label: "Confluence",
  description: "Ingest pages and spaces from Confluence.",
  icon: (props: LucideProps) => <ConfluenceIcon size={16} className={props.className} />,
  isEntryPoint: true,
  inputs: [
    { name: "API Token",  type: TaskParamType.CREDENTIAL, required: true,  hideHandle: true },
    { name: "Domain",     type: TaskParamType.STRING,     required: true,  hideHandle: true,
      helperText: "e.g. mycompany.atlassian.net" },
    { name: "Space Keys", type: TaskParamType.STRING,     required: false, hideHandle: true },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const CustomAPISourceTask = {
  type: TaskType.CUSTOM_API_SOURCE,
  label: "Custom API",
  description: "Ingest from any REST API with a custom schema.",
  icon: (props: LucideProps) => (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-sky-400" />
      <path d="M14 2v6h6M8 13h8M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="stroke-sky-400" />
    </svg>
  ),
  isEntryPoint: true,
  inputs: [
    { name: "Base URL",  type: TaskParamType.STRING,     required: true,  hideHandle: true },
    { name: "API Key",   type: TaskParamType.CUSTOM_CONNECT, required: false, hideHandle: true },
    { name: "JSON Path", type: TaskParamType.STRING,     required: true,  hideHandle: true,
      helperText: "JSONPath to the text array, e.g. $.items[*].body" },
  ],
  outputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const NormalizerTask = {
  type: TaskType.NORMALIZER,
  label: "Normalizer",
  description: "Clean encoding, fix OCR artefacts, normalise dates and whitespace.",
  icon: (props: LucideProps) => <NormalizerIcon size={16} className="stroke-amber-400" />,
  isEntryPoint: false,
  inputs: [
    { name: "Document Stream", type: TaskParamType.DATA_STREAM, required: true },
    { name: "Doc Era Year",    type: TaskParamType.NUMBER,      required: false, hideHandle: true,
      helperText: "Approximate year of oldest documents (e.g. 1950)", value: "2000" },
    { name: "Fix OCR",         type: TaskParamType.BOOLEAN,    required: false, hideHandle: true,
      value: "true" },
  ],
  outputs: [
    { name: "Clean Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const PIIScrubberTask = {
  type: TaskType.PII_SCRUBBER,
  label: "PII Scrubber",
  description: "Detect and pseudonymise PII using spaCy NER and Presidio patterns.",
  icon: (props: LucideProps) => <PIIScrubberIcon size={16} className={props.className} />,
  isEntryPoint: false,
  inputs: [
    { name: "Clean Stream",  type: TaskParamType.DATA_STREAM, required: true },
    { name: "Mask Strategy", type: TaskParamType.SELECT,      required: false, hideHandle: true,
      options: [
        { label: "Pseudonymise (reversible)", value: "pseudo" },
        { label: "Redact (irreversible)",     value: "redact" },
      ],
      value: "pseudo" },
  ],
  outputs: [
    { name: "Scrubbed Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const ChunkerTask = {
  type: TaskType.CHUNKER,
  label: "Chunker",
  description: "Split documents into overlapping token windows.",
  icon: (props: LucideProps) => <ChunkerIcon size={16} className="stroke-teal-400" />,
  isEntryPoint: false,
  inputs: [
    { name: "Scrubbed Stream", type: TaskParamType.DATA_STREAM, required: true },
    { name: "Chunk Size",      type: TaskParamType.NUMBER,      required: false, hideHandle: true,
      value: "512", helperText: "Tokens per chunk" },
    { name: "Overlap",         type: TaskParamType.NUMBER,      required: false, hideHandle: true,
      value: "102", helperText: "Overlap tokens (20% recommended)" },
  ],
  outputs: [
    { name: "Chunk Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const EmbedderTask = {
  type: TaskType.EMBEDDER,
  label: "Embedder",
  description: "Generate semantic vector embeddings for each chunk.",
  icon: (props: LucideProps) => <EmbedderIcon size={16} className="stroke-cyan-400" />,
  isEntryPoint: false,
  inputs: [
    { name: "Chunk Stream", type: TaskParamType.DATA_STREAM, required: true },
    { name: "Model",        type: TaskParamType.SELECT,      required: false, hideHandle: true,
      options: [
        { label: "all-MiniLM-L6-v2 (fast)",     value: "minilm" },
        { label: "all-mpnet-base-v2 (accurate)", value: "mpnet" },
      ],
      value: "minilm" },
  ],
  outputs: [
    { name: "Vector Stream", type: TaskParamType.VECTOR_STREAM },
  ],
};

export const VectorStoreTask = {
  type: TaskType.VECTOR_STORE,
  label: "Vector Store",
  description: "Upsert L2-normalised vectors into Qdrant with RBAC namespace.",
  icon: (props: LucideProps) => <VectorDBIcon size={16} className="stroke-purple-400" />,
  isEntryPoint: false,
  inputs: [
    { name: "Vector Stream", type: TaskParamType.VECTOR_STREAM, required: true },
    { name: "Collection",    type: TaskParamType.STRING,        required: true, hideHandle: true,
      value: "company_brain" },
    { name: "Namespace",     type: TaskParamType.STRING,        required: true, hideHandle: true,
      helperText: "RBAC scope, e.g. acme:engineering" },
  ],
  outputs: [
    { name: "Index Status", type: TaskParamType.STRING },
  ],
};

export const DeduplicatorTask = {
  type: TaskType.DEDUPLICATOR,
  label: "Deduplicator",
  description: "MinHash near-duplicate detection (Jaccard ≥ 0.85 = duplicate).",
  icon: (props: LucideProps) => (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3"  y="3"  width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" className="stroke-orange-400" />
      <rect x="13" y="3"  width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" className="stroke-orange-400" strokeDasharray="2 1" />
      <rect x="3"  y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" className="stroke-orange-400" strokeDasharray="2 1" />
      <path d="M13 17h8M17 13v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="stroke-orange-400" />
    </svg>
  ),
  isEntryPoint: false,
  inputs: [
    { name: "Chunk Stream", type: TaskParamType.DATA_STREAM, required: true },
    { name: "Threshold",    type: TaskParamType.NUMBER,      required: false, hideHandle: true,
      value: "0.85", helperText: "Jaccard similarity threshold (0–1)" },
  ],
  outputs: [
    { name: "Deduped Stream", type: TaskParamType.DATA_STREAM },
  ],
};

export const RAGEngineTask = {
  type: TaskType.RAG_ENGINE,
  label: "RAG Engine",
  description: "Semantic retrieval + cross-encoder rerank + LLM synthesis.",
  icon: (props: LucideProps) => <RAGIcon size={16} className="stroke-emerald-400" />,
  isEntryPoint: false,
  inputs: [
    { name: "Vector Stream", type: TaskParamType.VECTOR_STREAM, required: true },
    { name: "LLM Model",     type: TaskParamType.SELECT,        required: false, hideHandle: true,
      options: [
        { label: "GPT-4o",          value: "gpt-4o" },
        { label: "Claude Sonnet",   value: "claude-sonnet" },
        { label: "Mistral (local)", value: "mistral-local" },
      ],
      value: "gpt-4o" },
    { name: "Top-K",         type: TaskParamType.NUMBER,        required: false, hideHandle: true,
      value: "20" },
  ],
  outputs: [
    { name: "Answer Stream", type: TaskParamType.STRING },
  ],
};

export const AnalysisAgentTask = {
  type: TaskType.ANALYSIS_AGENT,
  label: "Analysis Agent",
  description: "BERTopic modelling + RoBERTa sentiment + LSTM anomaly detection.",
  icon: (props: LucideProps) => <AnalysisIcon size={16} className="stroke-yellow-400" />,
  isEntryPoint: false,
  inputs: [
    { name: "Vector Stream", type: TaskParamType.VECTOR_STREAM, required: true },
    { name: "Schedule",      type: TaskParamType.SELECT,        required: false, hideHandle: true,
      options: [
        { label: "Real-time", value: "realtime" },
        { label: "Daily",     value: "daily" },
        { label: "Weekly",    value: "weekly" },
      ],
      value: "daily" },
  ],
  outputs: [
    { name: "Insights",        type: TaskParamType.STRING },
    { name: "Anomaly Signals", type: TaskParamType.DATA_STREAM },
  ],
};

export const ForecastEngineTask = {
  type: TaskType.FORECAST_ENGINE,
  label: "Forecast Engine",
  description: "Temporal Fusion Transformer predictions with confidence intervals.",
  icon: (props: LucideProps) => <ForecastIcon size={16} className="stroke-rose-400" />,
  isEntryPoint: false,
  inputs: [
    { name: "Data Stream",     type: TaskParamType.DATA_STREAM, required: true },
    { name: "Horizon Weeks",   type: TaskParamType.NUMBER,      required: false, hideHandle: true,
      value: "13", helperText: "Forecast horizon in weeks" },
    { name: "External Trends", type: TaskParamType.BOOLEAN,     required: false, hideHandle: true,
      value: "true" },
  ],
  outputs: [
    { name: "Forecast",    type: TaskParamType.STRING },
    { name: "Risk Scores", type: TaskParamType.DATA_STREAM },
  ],
};