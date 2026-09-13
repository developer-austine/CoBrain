"use client";

import { useState, ChangeEvent, FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search as SearchIcon } from "lucide-react";

interface SearchResult {
  text: string;
  source: string;
  author: string;
  timestamp: string;
  chunk_index: number;
  total_chunks: number;
  parent_doc_id: string;
  content_hash: string;
  score: number;
}

export function SearchResults() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setHasSearched(true);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 10 }),
      });

      if (!res.ok) {
        console.error("[SearchResults] API error:", res.status);
        setResults([]);
        return;
      }

      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error("[SearchResults] Error:", err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case "gmail":
        return "bg-red-100 text-red-800";
      case "github":
        return "bg-gray-100 text-gray-800";
      case "notion":
        return "bg-purple-100 text-purple-800";
      case "custom":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Semantic Search</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            placeholder="Ask a question about your company data..."
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading} size="sm">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <SearchIcon className="w-4 h-4" />
            )}
          </Button>
        </form>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {hasSearched && !isLoading && results.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-8">
            No results found. Try a different query or ensure documents have been processed.
          </p>
        )}

        {!hasSearched && (
          <p className="text-center text-gray-500 text-sm py-8">
            Enter a query to search your documents
          </p>
        )}

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {results.map((result, idx) => (
            <div
              key={`${result.parent_doc_id}-${result.chunk_index}`}
              className="p-3 rounded border border-gray-200 hover:border-blue-300 transition"
            >
              <div className="flex items-start gap-2 mb-2">
                <span className={`text-xs font-medium px-2 py-1 rounded ${getSourceColor(result.source)}`}>
                  {result.source.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500">
                  Relevance: {(result.score * 100).toFixed(0)}%
                </span>
              </div>

              <p className="text-sm leading-relaxed text-gray-700 mb-2">
                {result.text.substring(0, 200)}
                {result.text.length > 200 ? "..." : ""}
              </p>

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{result.author || "Unknown"}</span>
                <span>{new Date(result.timestamp).toLocaleDateString()}</span>
              </div>

              {result.total_chunks > 1 && (
                <div className="text-xs text-gray-400 mt-1">
                  Chunk {result.chunk_index + 1} of {result.total_chunks}
                </div>
              )}
            </div>
          ))}
        </div>

        {results.length > 0 && (
          <p className="text-xs text-center text-gray-500">
            Showing {results.length} results
          </p>
        )}
      </CardContent>
    </Card>
  );
}
