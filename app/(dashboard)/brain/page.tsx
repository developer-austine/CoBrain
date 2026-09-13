import { listBrainBlocks, listAgentConfigs } from "@/actions/brain/brainBlocks";
import BrainClient from "./_components/BrainClient";
import BrainTabs from "./_components/BrainTabs";

/**
 * The Brain — the AI's derived knowledge: meeting intelligence, forecasts,
 * learned facts, patterns, decisions and briefs. Human-readable, human-
 * editable, with the review queue and standing rules alongside.
 */
export default async function BrainPage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string }>;
}) {
  const [{ active, reviewQueue }, configs, { block }] = await Promise.all([
    listBrainBlocks(),
    listAgentConfigs(),
    searchParams,
  ]);

  return (
    <>
      <BrainTabs />
      <BrainClient
        initialActive={active}
        initialReviewQueue={reviewQueue}
        initialConfigs={configs}
        deepLinkBlockId={block ?? null}
      />
    </>
  );
}
