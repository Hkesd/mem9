import type {
  Memory,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

/**
 * MemoryBackend — abstraction for both direct and server modes.
 * All tools and hooks call through this interface.
 */
export interface MemoryBackend {
  store(input: CreateMemoryInput): Promise<Memory>;
  search(input: SearchInput): Promise<SearchResult>;
  get(id: string): Promise<Memory | null>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory | null>;
  remove(id: string): Promise<boolean>;
  listRecent(limit: number): Promise<Memory[]>;
}
