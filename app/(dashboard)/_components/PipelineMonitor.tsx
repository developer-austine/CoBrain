"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Clock, Loader2 } from "lucide-react";

interface DocumentStatus {
  id: string;
  source: string;
  status: "PENDING" | "QUEUED" | "PROCESSING" | "PROCESSED" | "FAILED";
  errorMessage?: string;
  processedAt?: string;
  queuedAt?: string;
  subject?: string;
  author?: string;
}

interface PipelineMonitorProps {
  documentIds: string[];
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function PipelineMonitor({
  documentIds,
  autoRefresh = true,
  refreshInterval = 2000,
}: PipelineMonitorProps) {
  const [statuses, setStatuses] = useState<Record<string, DocumentStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Fetch status for all documents
  const fetchStatuses = async () => {
    try {
      const results = await Promise.all(
        documentIds.map(async (docId) => {
          const res = await fetch(`/api/document/${docId}/status`);
          if (!res.ok) return null;
          return res.json();
        })
      );

      const newStatuses: Record<string, DocumentStatus> = {};
      results.forEach((doc) => {
        if (doc) newStatuses[doc.id] = doc;
      });

      setStatuses(newStatuses);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("[PipelineMonitor] Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatuses();

    if (!autoRefresh) return;

    const interval = setInterval(fetchStatuses, refreshInterval);
    return () => clearInterval(interval);
  }, [documentIds, autoRefresh, refreshInterval]);

  const statusCounts = {
    pending: Object.values(statuses).filter((s) => s.status === "PENDING").length,
    queued: Object.values(statuses).filter((s) => s.status === "QUEUED").length,
    processing: Object.values(statuses).filter((s) => s.status === "PROCESSING").length,
    processed: Object.values(statuses).filter((s) => s.status === "PROCESSED").length,
    failed: Object.values(statuses).filter((s) => s.status === "FAILED").length,
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PROCESSED":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "QUEUED":
      case "PROCESSING":
        return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
      case "FAILED":
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PROCESSED":
        return "bg-green-100 text-green-800";
      case "QUEUED":
      case "PROCESSING":
        return "bg-blue-100 text-blue-800";
      case "FAILED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading && documentIds.length > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Processing Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg">Processing Pipeline</CardTitle>
          <span className="text-xs text-gray-500">
            Last update: {lastUpdate.toLocaleTimeString()}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-5 gap-2 text-center text-sm">
          <div className="p-2 bg-gray-50 rounded">
            <div className="font-semibold">{statusCounts.pending}</div>
            <div className="text-xs text-gray-600">Pending</div>
          </div>
          <div className="p-2 bg-blue-50 rounded">
            <div className="font-semibold text-blue-600">{statusCounts.queued}</div>
            <div className="text-xs text-gray-600">Queued</div>
          </div>
          <div className="p-2 bg-blue-50 rounded">
            <div className="font-semibold text-blue-600">{statusCounts.processing}</div>
            <div className="text-xs text-gray-600">Processing</div>
          </div>
          <div className="p-2 bg-green-50 rounded">
            <div className="font-semibold text-green-600">{statusCounts.processed}</div>
            <div className="text-xs text-gray-600">Processed</div>
          </div>
          <div className="p-2 bg-red-50 rounded">
            <div className="font-semibold text-red-600">{statusCounts.failed}</div>
            <div className="text-xs text-gray-600">Failed</div>
          </div>
        </div>

        {/* Document List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {Object.values(statuses).map((doc) => (
            <div
              key={doc.id}
              className="flex items-start gap-3 p-2 rounded border border-gray-200"
            >
              <div className="pt-1">{getStatusIcon(doc.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">
                    {doc.subject || doc.author || `${doc.source} document`}
                  </span>
                  <Badge className={getStatusColor(doc.status)}>
                    {doc.status}
                  </Badge>
                </div>
                {doc.errorMessage && (
                  <p className="text-xs text-red-600 mt-1">{doc.errorMessage}</p>
                )}
                {doc.processedAt && (
                  <p className="text-xs text-gray-500 mt-1">
                    ✓ Processed at {new Date(doc.processedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {documentIds.length === 0 && (
          <p className="text-center text-gray-500 text-sm">No documents to monitor</p>
        )}
      </CardContent>
    </Card>
  );
}
