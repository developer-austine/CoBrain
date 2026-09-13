import { listUploadedSources, getStorageStatus } from "@/actions/sources/sources";
import SourcesClient from "./_components/SourcesClient";

/**
 * Sources — upload external documents into the Brain.
 *
 * Scope is deliberately narrow: this page is for FILES you upload directly.
 * Live connectors (Gmail, Notion, GitHub, ...) are managed in Connectors and
 * surfaced on the Home workflow canvas — showing their document counts here
 * only added noise. Uploads still flow through the identical ingestion
 * pipeline (extract → normalize → PII scrub → chunk → embed → Qdrant), so a
 * file dropped here is searchable and citable in chat like any other source.
 */
export default async function SourcesPage() {
  const [uploaded, storage] = await Promise.all([
    listUploadedSources(),
    getStorageStatus(),
  ]);

  return (
    <SourcesClient initialUploaded={uploaded} storageReachable={storage.reachable} />
  );
}
