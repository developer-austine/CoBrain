import React from "react";
import { ConnectorIconDefinition, ConnectorIconProps } from "./types";

export const SlackIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="#E01E5A"/>
    <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="#36C5F0"/>
    <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
    <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="#2EB67D"/>
    <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
    <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="#ECB22E"/>
    <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/>
  </svg>
);

export const NotionIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447z" fill="currentColor"/>
    <path d="M5.068 7.028v13.776c0 .747.373 1.027 1.214.98l14.523-.84c.841-.047.935-.56.935-1.167V5.921c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.887v.22z" fill="currentColor" fillOpacity=".1"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M5.068 7.028v13.776c0 .747.373 1.027 1.214.98l14.523-.84c.841-.047.935-.56.935-1.167V5.921c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.887v.22zM9.09 8.662c-.326.233-.747.28-1.074.093L6.655 7.635v-.607c0-.42.233-.7.7-.747l12.095-.7c.607-.047.887.14.887.653v.7c0 .28-.187.56-.513.607L9.09 8.662zm0 0v9.659c0 .42.14.7.607.747.466.047.84-.186.84-.7V8.942l1.727-.187v9.799c0 1.4-.793 1.96-2.1 2.007-1.26.046-2.007-.467-2.007-1.447V8.849L9.09 8.662z" fill="currentColor"/>
  </svg>
);

export const GmailIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.907 1.528-1.148C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/>
    <path d="M0 5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548V24H1.636A1.636 1.636 0 0 1 0 22.364V5.457z" fill="#34A853"/>
    <path d="M18.545 4.64 12 9.548v14.455h10.364A1.636 1.636 0 0 0 24 22.367V5.457c0-2.023-2.309-3.178-3.927-1.964L18.545 4.64z" fill="#4285F4"/>
    <path d="M0 5.457c0-2.023 2.309-3.178 3.927-1.964L12 9.548 20.073 3.493C21.691 2.28 24 3.434 24 5.457v.527L12 13.548 0 5.984v-.527z" fill="#FBBC05"/>
  </svg>
);

export const GoogleDriveIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M6.28 0L0 10.91l3.14 5.45L9.42 5.45 6.28 0z" fill="#0066DA"/>
    <path d="M17.72 0l-6.28 10.91H24L20.86 5.45 17.72 0z" fill="#00AC47"/>
    <path d="M0 10.91l3.14 5.45L9.42 5.45H6.28L0 10.91z" fill="#0066DA"/>
    <path d="M11.44 10.91L5.16 21.82h13.68l6.28-10.91H11.44z" fill="#00832D"/>
    <path d="M6.28 24h11.44l-6.28-10.91H0L6.28 24z" fill="#2684FC"/>
    <path d="M17.72 24l6.28-10.91-6.28-2.18-5.16 8.64L17.72 24z" fill="#FFBA00"/>
  </svg>
);

export const JiraIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M11.975 0C8.129 0 5 3.13 5 6.975c0 1.85.72 3.53 1.893 4.782L11.975 18l5.082-6.243A6.951 6.951 0 0 0 18.95 6.975C18.95 3.13 15.82 0 11.975 0zm0 9.808a2.833 2.833 0 1 1 0-5.666 2.833 2.833 0 0 1 0 5.666z" fill="#0052CC"/>
    <path d="M11.975 0v9.808a2.833 2.833 0 0 0 0-5.666V0z" fill="#2684FF"/>
  </svg>
);

export const LinearIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M.245 14.15 9.85 23.755a12 12 0 0 1-9.605-9.605zM0 11.14 12.86 24a12.042 12.042 0 0 1-1.21.06A12 12 0 0 1 0 12c0-.29.005-.578.015-.864L0 11.14zM2.055 5.31l16.635 16.635A12 12 0 0 1 2.055 5.31zM5.31 2.055 21.945 18.69A12 12 0 0 1 5.31 2.055zM11.14 0l.724.015L24 12.862A12 12 0 0 1 11.14 0zM14.15.245A12 12 0 0 1 23.755 9.85L14.15.245z" fill="#5E6AD2"/>
  </svg>
);

export const GitHubIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
);

export const ConfluenceIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M.887 17.606c-.234.373-.495.813-.696 1.12a.672.672 0 0 0 .218.94l3.837 2.356a.675.675 0 0 0 .944-.214c.18-.293.423-.695.688-1.12 1.84-2.938 3.694-2.58 7.026-.948l3.81 1.842c.356.173.776.02.95-.334l1.898-3.92a.675.675 0 0 0-.331-.905L15.4 14.6c-.95-.455-2.88-1.386-3.895-1.87C6.12 10.146 2.982 11.67.887 17.606z" fill="#2684FF"/>
    <path d="M23.113 6.394c.234-.373.495-.813.696-1.12a.672.672 0 0 0-.218-.94L19.754 1.98a.675.675 0 0 0-.944.214c-.18.293-.423.695-.688 1.12-1.84 2.938-3.694 2.58-7.026.948L7.286 2.42a.673.673 0 0 0-.95.334l-1.898 3.92a.675.675 0 0 0 .331.905L8.6 9.4c.95.455 2.88 1.386 3.895 1.87 5.385 2.584 8.523 1.06 10.618-4.876z" fill="#2684FF"/>
  </svg>
);

export const ZoomIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect width="24" height="24" rx="4" fill="#2D8CFF"/>
    <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h9A1.5 1.5 0 0 1 15 8.5v7A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-7zm12 1.25 3.6-2.7A.75.75 0 0 1 20 7.65v8.7a.75.75 0 0 1-1.4.39L15 14.25V9.75z" fill="white"/>
  </svg>
);

export const MicrosoftTeamsIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M20.625 5.25h-4.5a.75.75 0 0 0-.75.75v.75h4.5V24H24V6a.75.75 0 0 0-.75-.75h-2.625z" fill="#5059C9"/>
    <circle cx="17.25" cy="3" r="2.25" fill="#5059C9"/>
    <circle cx="9.75" cy="2.25" r="2.25" fill="#7B83EB"/>
    <path d="M14.25 6H5.25A.75.75 0 0 0 4.5 6.75V16.5a7.5 7.5 0 0 0 15 0V6.75a.75.75 0 0 0-.75-.75h-4.5z" fill="#7B83EB"/>
    <path d="M12 6v11.625A7.5 7.5 0 0 1 4.5 16.5V6.75A.75.75 0 0 1 5.25 6H12z" fill="#4B53BC" fillOpacity=".5"/>
    <path d="M12 13.5H6.75v1.5H12v-1.5zm0-3H6.75V12H12V10.5z" fill="white"/>
  </svg>
);

export const HubSpotIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M22.047 14.582a4.76 4.76 0 0 0-1.898-1.603V9.918a1.76 1.76 0 0 0 1.014-1.586V7.076a1.76 1.76 0 0 0-1.758-1.758h-1.258a1.76 1.76 0 0 0-1.758 1.758v1.256a1.76 1.76 0 0 0 1.015 1.587v3.057a4.741 4.741 0 0 0-2.004 1.367l-5.89-4.313a2.36 2.36 0 0 0 .08-.597 2.373 2.373 0 1 0-2.373 2.373c.332 0 .649-.07.937-.192l5.79 4.242a4.757 4.757 0 1 0 8.103-1.274z" fill="#FF7A59"/>
  </svg>
);

export const SalesforceIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9.833 6.75c.584-1.028 1.694-1.75 2.985-1.75 1.527 0 2.8.893 3.367 2.156A3.88 3.88 0 0 1 18.29 6.5c1.986 0 3.567 1.54 3.567 3.474 0 .23-.026.453-.075.668A3.093 3.093 0 0 1 24 13.558c0 1.704-1.33 3.067-2.984 3.067H4.567C2.597 16.625 1 15.04 1 13.083c0-1.426.82-2.655 2.025-3.254A3.844 3.844 0 0 1 3 9.042C3 7.372 4.397 6 6.118 6c1.318 0 2.462.73 3.02 1.79L9.833 6.75z" fill="#00A1E0"/>
  </svg>
);

export const NormalizerIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="2" y="5" width="20" height="2" rx="1" fill="currentColor" opacity=".6"/>
    <rect x="5" y="10" width="14" height="2" rx="1" fill="currentColor" opacity=".8"/>
    <rect x="8" y="15" width="8" height="2" rx="1" fill="currentColor"/>
    <path d="M12 18v4M10 20l2 2 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const PIIScrubberIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M18 4L6 18" stroke="#F87171" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="18" cy="4" r="2" fill="#F87171"/>
    <circle cx="6" cy="18" r="2" fill="#F87171"/>
  </svg>
);

export const ChunkerIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="4" width="18" height="3" rx="1" fill="currentColor" opacity=".5"/>
    <rect x="3" y="9" width="18" height="3" rx="1" fill="currentColor" opacity=".7"/>
    <rect x="3" y="14" width="18" height="3" rx="1" fill="currentColor"/>
    <path d="M21 8H3M21 13H3" stroke="currentColor" strokeWidth=".5" strokeDasharray="2 2"/>
    <path d="M21 17h-3v4l-2-2-2 2v-4H3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

export const EmbedderIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="5" cy="5" r="2" fill="currentColor" opacity=".5"/>
    <circle cx="12" cy="5" r="2" fill="currentColor" opacity=".7"/>
    <circle cx="19" cy="5" r="2" fill="currentColor"/>
    <circle cx="5" cy="12" r="2" fill="currentColor" opacity=".7"/>
    <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
    <circle cx="19" cy="12" r="2" fill="currentColor" opacity=".7"/>
    <circle cx="5" cy="19" r="2" fill="currentColor"/>
    <circle cx="12" cy="19" r="2" fill="currentColor" opacity=".7"/>
    <circle cx="19" cy="19" r="2" fill="currentColor" opacity=".5"/>
  </svg>
);

export const RAGIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="9" cy="10" r="1" fill="currentColor"/>
    <circle cx="12" cy="10" r="1" fill="currentColor"/>
    <circle cx="15" cy="10" r="1" fill="currentColor"/>
  </svg>
);

export const VectorDBIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M4 6v4c0 1.657 3.582 3 8 3s8-1.343 8-3V6" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M4 10v4c0 1.657 3.582 3 8 3s8-1.343 8-3v-4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M4 14v4c0 1.657 3.582 3 8 3s8-1.343 8-3v-4" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

export const AnalysisIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M7 16l4-5 4 3 4-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="7" cy="16" r="1.5" fill="currentColor"/>
    <circle cx="11" cy="11" r="1.5" fill="currentColor"/>
    <circle cx="15" cy="14" r="1.5" fill="currentColor"/>
    <circle cx="19" cy="8" r="1.5" fill="currentColor"/>
  </svg>
);

export const ForecastIcon: React.FC<ConnectorIconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 17l4-8 4 4 4-6 4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 7l4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 1"/>
    <path d="M3 21h18" stroke="currentColor" strokeWidth="1" strokeOpacity=".3"/>
    <path d="M19 10l2 2M19 10l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const CONNECTOR_ICONS: ConnectorIconDefinition[] = [
  { id: "slack",      label: "Slack",           category: "source",   icon: SlackIcon,         color: "text-pink-400",   bgColor: "bg-pink-400/10"   },
  { id: "notion",     label: "Notion",          category: "source",   icon: NotionIcon,        color: "text-neutral-300",bgColor: "bg-neutral-400/10" },
  { id: "gmail",      label: "Gmail",           category: "source",   icon: GmailIcon,         color: "text-red-400",    bgColor: "bg-red-400/10"    },
  { id: "drive",      label: "Google Drive",    category: "source",   icon: GoogleDriveIcon,   color: "text-green-400",  bgColor: "bg-green-400/10"  },
  { id: "jira",       label: "Jira",            category: "source",   icon: JiraIcon,          color: "text-blue-400",   bgColor: "bg-blue-400/10"   },
  { id: "linear",     label: "Linear",          category: "source",   icon: LinearIcon,        color: "text-violet-400", bgColor: "bg-violet-400/10" },
  { id: "github",     label: "GitHub",          category: "source",   icon: GitHubIcon,        color: "text-neutral-300",bgColor: "bg-neutral-400/10"},
  { id: "confluence", label: "Confluence",      category: "source",   icon: ConfluenceIcon,    color: "text-blue-300",   bgColor: "bg-blue-300/10"   },
  { id: "zoom",       label: "Zoom",            category: "source",   icon: ZoomIcon,          color: "text-blue-400",   bgColor: "bg-blue-400/10"   },
  { id: "teams",      label: "MS Teams",        category: "source",   icon: MicrosoftTeamsIcon,color: "text-indigo-400", bgColor: "bg-indigo-400/10" },
  { id: "hubspot",    label: "HubSpot",         category: "source",   icon: HubSpotIcon,       color: "text-orange-400", bgColor: "bg-orange-400/10" },
  { id: "salesforce", label: "Salesforce",      category: "source",   icon: SalesforceIcon,    color: "text-sky-400",    bgColor: "bg-sky-400/10"    },

  { id: "normalizer", label: "Normalizer",      category: "pipeline", icon: NormalizerIcon,    color: "text-amber-400",  bgColor: "bg-amber-400/10"  },
  { id: "pii",        label: "PII Scrubber",    category: "pipeline", icon: PIIScrubberIcon,   color: "text-red-400",    bgColor: "bg-red-400/10"    },
  { id: "chunker",    label: "Chunker",         category: "pipeline", icon: ChunkerIcon,       color: "text-teal-400",   bgColor: "bg-teal-400/10"   },
  { id: "embedder",   label: "Embedder",        category: "pipeline", icon: EmbedderIcon,      color: "text-cyan-400",   bgColor: "bg-cyan-400/10"   },
  { id: "vectordb",   label: "Vector Store",    category: "pipeline", icon: VectorDBIcon,      color: "text-purple-400", bgColor: "bg-purple-400/10" },

  { id: "rag",        label: "RAG Engine",      category: "ai",       icon: RAGIcon,           color: "text-emerald-400",bgColor: "bg-emerald-400/10"},
  { id: "analysis",   label: "Analysis Agent",  category: "ai",       icon: AnalysisIcon,      color: "text-yellow-400", bgColor: "bg-yellow-400/10" },
  { id: "forecast",   label: "Forecast Engine", category: "ai",       icon: ForecastIcon,      color: "text-rose-400",   bgColor: "bg-rose-400/10"   },
];

export const getConnectorIcon = (id: string): ConnectorIconDefinition | undefined =>
  CONNECTOR_ICONS.find((c) => c.id === id);