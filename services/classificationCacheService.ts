import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import * as Crypto from "expo-crypto";

export interface CacheEntry {
    result: CachedPrediction;
    timestamp: number;
    hitCount: number;
    textHash: string;
    normalizedText: string;
}

export interface CachedPrediction {
    amount: number | null;
    categoryId: string;
    categoryName: string;
    io: "IN" | "OUT";
    confidence: number;
    note: string;
    date: string; // ISO date string
    isMultiple: boolean;
    transactions?: Array<{
        amount: number;
        categoryId: string;
        categoryName: string;
        io: "IN" | "OUT";
        confidence: number;
        note: string;
        date: string;
    }>;
    message: string;
    overallConfidence: number;
    source: "cache" | "llm";
}

// ==================== CACHE STORE ====================

interface ClassificationCacheState {
    cache: Record<string, CacheEntry>;
    maxEntries: number;
    ttlMs: number;
    
    // Actions
    get: (text: string) => CacheEntry | null;
    set: (text: string, result: CachedPrediction) => void;
    invalidate: (text?: string) => void;
    clear: () => void;
    getStats: () => CacheStats;
}

interface CacheStats {
    totalEntries: number;
    totalHits: number;
    hitRate: number;
    oldestEntry: number | null;
    newestEntry: number | null;
}

let totalHits = 0;
let totalRequests = 0;

export const useClassificationCache = create<ClassificationCacheState>()(
    persist(
        (set, get) => ({
            cache: {},
            maxEntries: 500,
            ttlMs: 24 * 60 * 60 * 1000, // 24 hours
            
            get: (text: string) => {
                const state = get();
                const hash = hashText(text);
                const entry = state.cache[hash];
                const now = Date.now();
                
                totalRequests++;
                
                if (!entry) {
                    return null;
                }
                
                // Check TTL
                if (now - entry.timestamp > state.ttlMs) {
                    // Entry expired, remove it
                    const { [hash]: _, ...rest } = state.cache;
                    set({ cache: rest });
                    return null;
                }
                
                // Increment hit count
                totalHits++;
                entry.hitCount++;
                entry.timestamp = now; // Update last access
                
                // Save updated entry
                set({
                    cache: {
                        ...state.cache,
                        [hash]: entry,
                    },
                });
                
                return entry;
            },
            
            set: (text: string, result: CachedPrediction) => {
                const state = get();
                const hash = hashText(text);
                const normalizedText = normalizeText(text);
                const now = Date.now();
                
                // Check if we need to evict entries (LRU)
                const entries = Object.entries(state.cache);
                if (entries.length >= state.maxEntries) {
                    // Find oldest accessed entries
                    const sorted = entries
                        .map(([key, entry]) => ({ key, entry }))
                        .sort((a, b) => a.entry.timestamp - b.entry.timestamp);
                    
                    // Remove oldest 20%
                    const toRemove = Math.ceil(state.maxEntries * 0.2);
                    const keysToRemove = sorted.slice(0, toRemove).map((s) => s.key);
                    
                    const newCache = { ...state.cache };
                    for (const key of keysToRemove) {
                        delete newCache[key];
                    }
                    
                    set({ cache: newCache });
                }
                
                // Set new entry
                set({
                    cache: {
                        ...state.cache,
                        [hash]: {
                            result,
                            timestamp: now,
                            hitCount: 0,
                            textHash: hash,
                            normalizedText,
                        },
                    },
                });
            },
            
            invalidate: (text?: string) => {
                const state = get();
                if (text) {
                    const hash = hashText(text);
                    const { [hash]: _, ...rest } = state.cache;
                    set({ cache: rest });
                } else {
                    set({ cache: {} });
                }
            },
            
            clear: () => {
                totalHits = 0;
                totalRequests = 0;
                set({ cache: {} });
            },
            
            getStats: () => {
                const state = get();
                const entries = Object.values(state.cache);
                const timestamps = entries.map((e) => e.timestamp);
                
                return {
                    totalEntries: entries.length,
                    totalHits,
                    hitRate: totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0,
                    oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
                    newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
                };
            },
        }),
        {
            name: "classification-cache",
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({ cache: state.cache }),
        }
    )
);

// ==================== UTILITY FUNCTIONS ====================

/**
 * Generate consistent hash for text input
 */
export async function hashText(text: string): Promise<string> {
    const normalized = normalizeText(text);
    const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        normalized
    );
    return digest.substring(0, 16);
}

/**
 * Normalize text for consistent caching
 */
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
        .replace(/[^\w\s]/g, "") // Remove special characters
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();
}

/**
 * Parse date from text for cache key consistency
 */
export function parseDateFromText(text: string): Date {
    const today = new Date();
    const lowerText = text.toLowerCase();

    // Check for DD/MM/YYYY format
    const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
    if (dateMatch) {
        const day = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]) - 1;
        const year = dateMatch[3] ? parseInt(dateMatch[3]) : today.getFullYear();
        return new Date(year, month, day);
    }

    // Vietnamese relative dates
    if (lowerText.includes("hôm qua")) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday;
    }

    if (lowerText.includes("hôm kia")) {
        const dayBeforeYesterday = new Date(today);
        dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
        return dayBeforeYesterday;
    }

    if (lowerText.includes("tuần trước")) {
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);
        return lastWeek;
    }

    // N days ago
    const daysAgoMatch = lowerText.match(/(\d+)\s*ngày\s*trước/);
    if (daysAgoMatch) {
        const daysAgo = parseInt(daysAgoMatch[1]);
        const date = new Date(today);
        date.setDate(date.getDate() - daysAgo);
        return date;
    }

    return today;
}

// ==================== CLASSIFICATION CACHE SERVICE ====================

class ClassificationCacheService {
    /**
     * Check if text is cached and return result if valid
     */
    async getCachedResult(text: string): Promise<CachedPrediction | null> {
        try {
            const entry = useClassificationCache.getState().get(text);
            
            if (entry) {
                console.log(`🎯 Cache HIT for: "${text.substring(0, 50)}..."`);
                return entry.result;
            }
            
            console.log(`❌ Cache MISS for: "${text.substring(0, 50)}..."`);
            return null;
        } catch (error) {
            console.warn("Cache get error:", error);
            return null;
        }
    }

    /**
     * Cache a classification result
     */
    async cacheResult(text: string, result: CachedPrediction): Promise<void> {
        try {
            useClassificationCache.getState().set(text, {
                ...result,
                source: "cache",
            });
            console.log(`💾 Cached result for: "${text.substring(0, 50)}..."`);
        } catch (error) {
            console.warn("Cache set error:", error);
        }
    }

    /**
     * Invalidate a specific cache entry
     */
    async invalidate(text: string): Promise<void> {
        try {
            useClassificationCache.getState().invalidate(text);
            console.log(`🗑️ Invalidated cache for: "${text.substring(0, 50)}..."`);
        } catch (error) {
            console.warn("Cache invalidate error:", error);
        }
    }

    /**
     * Clear all cache
     */
    async clearCache(): Promise<void> {
        try {
            useClassificationCache.getState().clear();
            console.log("🗑️ Cleared all classification cache");
        } catch (error) {
            console.warn("Cache clear error:", error);
        }
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<CacheStats> {
        return useClassificationCache.getState().getStats();
    }

    /**
     * Prefetch common patterns (can be called on app start)
     */
    async warmUpCache(commonPatterns: string[]): Promise<void> {
        console.log(`🚀 Warming up cache with ${commonPatterns.length} common patterns...`);
        
        for (const pattern of commonPatterns) {
            const entry = useClassificationCache.getState().get(pattern);
            if (!entry) {
                // This is just a warmup - actual classification will happen on first use
                console.log(`  📝 Added to cache (pending classification): "${pattern}"`);
            }
        }
    }
}

export const classificationCacheService = new ClassificationCacheService();

// ==================== TYPE EXPORTS ====================

export type { CacheStats };
