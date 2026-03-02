import type { Hooks } from "@opencode-ai/plugin";
import type { MemoryBackend } from "./backend.js";
import type { Memory } from "./types.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECENT = 10;
const AUTO_CAPTURE_SOURCE = "opencode-auto";

/** Simple in-memory cache for recent memories. */
interface CacheEntry {
  memories: Memory[];
  ts: number;
}

/**
 * Format memories into a system prompt block.
 * Matches the ccplugin SessionStart format.
 */
function formatMemoriesBlock(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m, i) => {
    const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
    const date = m.updated_at ? ` (${m.updated_at})` : "";
    return `${i + 1}. ${m.content.slice(0, 500)}${tags}${date}`;
  });

  return [
    "",
    "---",
    "[mnemo] Shared agent memory — recent entries:",
    ...lines,
    "",
    "Use memory_store/memory_search/memory_update/memory_delete tools to manage shared memories.",
    "---",
    "",
  ].join("\n");
}

/**
 * Build hooks for the OpenCode plugin.
 *
 * - `experimental.chat.system.transform`: Inject recent memories into system prompt.
 * - `event`: Listen for `session.idle` to auto-capture the last assistant response.
 *
 * Cache is scoped inside this closure to prevent leaking across plugin instances.
 */
export function buildHooks(backend: MemoryBackend): Pick<
  Hooks,
  "event" | "experimental.chat.system.transform"
> {
  // Cache scoped to this plugin instance — not module-level.
  let memoryCache: CacheEntry | null = null;

  function getCached(): Memory[] | null {
    if (!memoryCache) return null;
    if (Date.now() - memoryCache.ts > CACHE_TTL_MS) {
      memoryCache = null;
      return null;
    }
    return memoryCache.memories;
  }

  function setCache(memories: Memory[]): void {
    memoryCache = { memories, ts: Date.now() };
  }

  function invalidateCache(): void {
    memoryCache = null;
  }

  return {
    /**
     * Inject memories into the system prompt.
     * Uses a 5-minute TTL cache to avoid DB queries on every turn.
     */
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        let memories = getCached();
        if (!memories) {
          memories = await backend.listRecent(MAX_RECENT);
          setCache(memories);
        }
        const block = formatMemoriesBlock(memories);
        if (block) {
          output.system.push(block);
        }
      } catch {
        // Graceful degradation — if memory fetch fails, continue without it.
      }
    },

    /**
     * Listen for session.idle events to auto-capture important context.
     * Since the plugin SDK doesn't expose session messages directly,
     * we store a marker to indicate the session ended.
     * The actual auto-capture is best-effort.
     */
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;

      try {
        const sessionID = event.properties.sessionID;
        // Store a lightweight session-end marker so we know this session happened.
        // The real value comes from the agent explicitly using memory_store during the session.
        // This auto-capture is a safety net.
        await backend.store({
          content: `[auto] Session ${sessionID} completed.`,
          key: `session:${sessionID}`,
          source: AUTO_CAPTURE_SOURCE,
          tags: ["auto-capture", "session-end"],
        });

        // Invalidate cache so next session gets fresh data
        invalidateCache();
      } catch {
        // Best-effort — don't fail the session on memory save errors.
      }
    },
  };
}
