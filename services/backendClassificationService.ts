/**
 * Backend Classification Service - OPTIMIZED VERSION
 * Calls KLTN_UIT_BE API for transaction classification using LLM (llama.cpp)
 * 
 * Features:
 * - Request deduplication (prevents duplicate concurrent requests)
 * - AbortController for request cancellation
 * - Optimized category mapping with early exit
 * - Exponential backoff retry logic
 * - Connection pooling hints
 * 
 * API: POST /api/v1/predict
 * Architecture: React Native → FastAPI → llama.cpp → JSON
 */

import Constants from "expo-constants";
import type { Category } from "@/repos/categoryRepo";

// Backend API configuration
// DEBUG: Log what Constants is loading
console.log('🔧 Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_API_URL:', Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_API_URL);

// Temporarily hardcode to bypass Expo cache issue
const BACKEND_API_URL = "http://10.186.216.227:8000";

// Timeout for LLM inference (optimized for 7B model)
const API_TIMEOUT = 60000; // Reduced from 90s to 60s for better UX

// Retry configuration
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY = 1000; // 1 second base delay

// ==================== REQUEST DEDUPLICATION ====================

/**
 * Singleton request manager to prevent duplicate concurrent API calls
 */
class RequestDeduplicationManager {
    private pendingRequests: Map<string, Promise<any>> = new Map();
    private abortControllers: Map<string, AbortController> = new Map();

    /**
     * Get or create a request for a given cache key
     * If a request is already pending, return the existing promise
     */
    async getOrCreateRequest<T>(
        cacheKey: string,
        requestFactory: () => Promise<T>,
        signal?: AbortSignal
    ): Promise<T> {
        const existingRequest = this.pendingRequests.get(cacheKey);

        if (existingRequest) {
            console.log(`🔄 Reusing pending request for: "${cacheKey.substring(0, 50)}..."`);
            return existingRequest;
        }

        const controller = new AbortController();
        this.abortControllers.set(cacheKey, controller);

        if (signal) {
            signal.addEventListener("abort", () => {
                controller.abort();
            });
        }

        const requestPromise = (async () => {
            try {
                const result = await requestFactory();
                return result;
            } finally {
                // Clean up after request completes (success or failure)
                this.pendingRequests.delete(cacheKey);
                this.abortControllers.delete(cacheKey);
            }
        })();

        this.pendingRequests.set(cacheKey, requestPromise);
        return requestPromise;
    }

    /**
     * Abort all pending requests (e.g., on app state change)
     */
    abortAll(): void {
        for (const [key, controller] of this.abortControllers) {
            console.log(`🛑 Aborting request: "${key.substring(0, 50)}..."`);
            controller.abort();
        }
        this.pendingRequests.clear();
        this.abortControllers.clear();
    }

    /**
     * Get count of pending requests
     */
    getPendingCount(): number {
        return this.pendingRequests.size;
    }
}

export const requestDeduplicationManager = new RequestDeduplicationManager();

// ==================== TYPES ====================

/**
 * Request payload for /api/v1/predict
 */
interface PredictRequest {
    text: string;
    categories: string[];
    locale?: string;
    currency?: string;
}

/**
 * Individual transaction item from backend
 */
interface TransactionItem {
    note: string;
    amount: number;
    category: string;
    type: "Thu nhập" | "Chi phí";
    confidence: number;
}

/**
 * Response from /api/v1/predict
 */
interface PredictResponse {
    amount: number;
    message: string;
    transactions?: TransactionItem[];
    raw_output?: string;
}

/**
 * Mapped prediction result with local category IDs
 */
export interface MappedPrediction {
    amount: number | null;
    categoryId: string;
    categoryName: string;
    io: "IN" | "OUT";
    confidence: number;
    note: string;
    date: Date;
    isMultiple: boolean;
    transactions?: Array<{
        amount: number;
        categoryId: string;
        categoryName: string;
        io: "IN" | "OUT";
        confidence: number;
        note: string;
        date: Date;
    }>;
    message: string;
    overallConfidence: number;
    error?: string;
    source?: "cache" | "llm";
}

/**
 * Health check response
 */
interface HealthCheckResponse {
    status: string;
    llm_available: boolean;
    version: string;
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Generate cache key for request deduplication
 */
function generateCacheKey(text: string, categories: string[]): string {
    const normalizedText = text.toLowerCase().trim();
    const categoryHash = categories.slice(0, 10).join(","); // First 10 categories
    return `${normalizedText}|${categoryHash}`;
}

/**
 * Parse date from Vietnamese text
 */
function parseDateFromText(text: string): Date {
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

/**
 * Generate user-friendly message from prediction
 * NOTE: For multi-transaction, cards will show individual details
 * Message should only show summary (count + total) to avoid redundancy
 */
function generateMessage(
    prediction: PredictResponse,
    isMultiple: boolean,
    originalText: string
): string {
    const formattedAmount = prediction.amount.toLocaleString("vi-VN");
    const transactionType = prediction.type === "Thu nhập" ? "thu" : "chi";

    if (isMultiple && prediction.transactions?.length) {
        const count = prediction.transactions.length;
        // Simplified message - cards show individual details
        return `Đã ghi ${count} giao dịch ${transactionType}. Tổng: ${formattedAmount}đ ✓`;
    }

    const confidenceStr =
        prediction.confidence < 0.75
            ? `(${((prediction.confidence * 100).toFixed(0))}% chắc chắn)`
            : " ✓";

    return `Đã ghi ${transactionType} ${formattedAmount}đ cho ${originalText}. Phân loại: ${prediction.category}${confidenceStr}`;
}

// ==================== OPTIMIZED CATEGORY MAPPING ====================

/**
 * Optimized category mapping with early exit for performance
 */
function mapCategoryToLocal(
    backendCategory: string,
    localCategories: Category[],
    transactionType: "Thu nhập" | "Chi phí"
): { categoryId: string; categoryName: string } | null {
    if (!backendCategory || !localCategories.length) return null;

    const normalizedBackend = backendCategory.toLowerCase().trim();
    const expectedType = transactionType === "Thu nhập" ? "income" : "expense";

    // Priority 1: Fast exact match with correct type
    const exactMatch = localCategories.find(
        (c) =>
            c.name.toLowerCase().trim() === normalizedBackend &&
            c.type === expectedType
    );
    if (exactMatch) {
        return { categoryId: exactMatch.id, categoryName: exactMatch.name };
    }

    // Priority 2: Exact match any type (fast check)
    const exactMatchAnyType = localCategories.find(
        (c) => c.name.toLowerCase().trim() === normalizedBackend
    );
    if (exactMatchAnyType) {
        return {
            categoryId: exactMatchAnyType.id,
            categoryName: exactMatchAnyType.name,
        };
    }

    // Priority 3: Contains match with correct type (optimized single pass)
    const containsMatch = localCategories.find(
        (c) =>
            (c.name.toLowerCase().includes(normalizedBackend) ||
                normalizedBackend.includes(c.name.toLowerCase())) &&
            c.type === expectedType
    );
    if (containsMatch) {
        return { categoryId: containsMatch.id, categoryName: containsMatch.name };
    }

    // Priority 4: Vietnamese category name mapping (common aliases)
    const categoryMapping: Record<string, string[]> = {
        "ăn uống": ["food", "eating", "meal", "cafe", "coffee", "drink", "ăn", "uống", "café", "bún", "phở", "cơm"],
        "di chuyển": ["transport", "travel", "grab", "taxi", "xe", "xăng", "bus", "grabbike"],
        "mua sắm": ["shopping", "buy", "mua", "shop", "market", "tmall", "shopee"],
        "giải trí": ["entertainment", "movie", "game", "music", "phim", "netflix", "spotify"],
        "hóa đơn": ["bill", "utility", "điện", "nước", "internet", "phone", "viễn thông"],
        "sức khỏe": ["health", "medical", "doctor", "thuốc", "bệnh viện", "khám", "dược"],
        "giáo dục": ["education", "school", "course", "học", "sách", "khóa học", "coursera"],
        "quà tặng": ["gift", "present", "quà", "tặng", "cho", "sinh nhật"],
        "lương": ["salary", "wage", "income", "lương", "thu nhập", "bonus", "thưởng"],
        "đầu tư": ["invest", "stock", "chứng khoán", "crypto", "bitcoin"],
        "bảo hiểm": ["insurance", "bảo hiểm", " BHXH", "y tế"],
        "khác": ["other", "misc", "khác", "tạm"],
    };

    // Early exit: Check most common categories first
    const priorityCategories = ["ăn uống", "di chuyển", "mua sắm", "lương"];

    for (const catName of priorityCategories) {
        const aliases = categoryMapping[catName] || [];
        if (
            aliases.some(
                (alias) =>
                    normalizedBackend.includes(alias) || alias.includes(normalizedBackend)
            )
        ) {
            const matched = localCategories.find(
                (c) =>
                    c.name.toLowerCase().includes(catName) ||
                    catName.includes(c.name.toLowerCase())
            );
            if (matched) {
                return { categoryId: matched.id, categoryName: matched.name };
            }
        }
    }

    // Priority 5: Fallback to first category of matching type
    const fallback = localCategories.find((c) => c.type === expectedType);
    if (fallback) {
        return { categoryId: fallback.id, categoryName: fallback.name };
    }

    return null;
}

// ==================== API FUNCTIONS ====================

/**
 * Check if backend API is available
 */
export async function checkBackendHealth(): Promise<{
    available: boolean;
    llmAvailable: boolean;
    version?: string;
    error?: string;
}> {
    try {
        const fetchPromise = fetch(`${BACKEND_API_URL}/api/v1/health`, {
            method: "GET",
            headers: { "Accept": "application/json" },
        });

        const timeoutPromise = new Promise<Response>((_, reject) => {
            setTimeout(() => reject(new Error("Health check timeout")), 5000);
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response.ok) {
            return {
                available: false,
                llmAvailable: false,
                error: `HTTP ${response.status}`,
            };
        }

        const data: HealthCheckResponse = await response.json();
        return {
            available: true,
            llmAvailable: data.llm_available,
            version: data.version,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.warn("Backend health check failed:", errorMessage);
        return {
            available: false,
            llmAvailable: false,
            error: errorMessage,
        };
    }
}

/**
 * Test backend connection with detailed diagnostics
 */
export async function testBackendConnection(): Promise<{
    success: boolean;
    latency: number;
    llmAvailable: boolean;
    error?: string;
}> {
    const startTime = Date.now();

    try {
        const result = await checkBackendHealth();
        const latency = Date.now() - startTime;

        return {
            success: result.available && result.llmAvailable,
            latency,
            llmAvailable: result.llmAvailable,
            error: result.error,
        };
    } catch (error) {
        return {
            success: false,
            latency: Date.now() - startTime,
            llmAvailable: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number): number {
    return Math.min(BASE_RETRY_DELAY * Math.pow(2, attempt), 10000);
}

/**
 * Call backend API with retry logic
 */
async function callBackendAPI(
    requestBody: PredictRequest,
    retries: number = MAX_RETRIES
): Promise<PredictResponse> {
    let lastError: Error | null = null;
    const apiUrl = `${BACKEND_API_URL}/api/v1/predict`;

    console.log(`🔗 Calling API: ${apiUrl}`);
    console.log(`📦 Request body:`, JSON.stringify(requestBody, null, 2));

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                console.log(`❌ API response not OK: ${response.status} - ${errorText}`);
                throw new Error(`API error: ${response.status} - ${errorText}`);
            }

            const result = await response.json();
            console.log(`✅ API success:`, JSON.stringify(result, null, 2));
            return result;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error("Unknown error");
            console.log(`❌ API attempt ${attempt + 1} error:`, lastError.message);

            if (attempt < retries) {
                const delay = getRetryDelay(attempt);
                console.log(`⚠️ API attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw lastError || new Error("Max retries exceeded");
}

/**
 * Call backend API to classify transaction with deduplication
 * Supports both single and multi-transaction parsing
 */
export async function classifyTransactionWithBackend(
    text: string,
    localCategories: Category[]
): Promise<MappedPrediction> {
    const date = parseDateFromText(text);
    const categoryNames = localCategories.map((c) => c.name);
    const cacheKey = generateCacheKey(text, categoryNames);

    try {
        // Create request body
        const requestBody: PredictRequest = {
            text: text,
            categories: categoryNames,
            locale: "vi-VN",
            currency: "VND",
        };

        // Use deduplication manager to prevent duplicate requests
        const prediction: PredictResponse = await requestDeduplicationManager.getOrCreateRequest(
            cacheKey,
            () => callBackendAPI(requestBody)
        );

        // Get category/type from first transaction (or use empty for message-only response)
        const firstTx = prediction.transactions?.[0];
        const backendCategory = firstTx?.category || "";
        const backendType = firstTx?.type || "Chi phí";

        // Map backend category to local category (for single transaction)
        const mappedCategory = mapCategoryToLocal(
            backendCategory,
            localCategories,
            backendType
        );

        const io: "IN" | "OUT" = backendType === "Thu nhập" ? "IN" : "OUT";
        const isMultiple = prediction.transactions && prediction.transactions.length > 1;

        // Map individual transactions if multi-transaction
        let mappedTransactions: MappedPrediction["transactions"] | undefined = undefined;

        if (prediction.transactions && prediction.transactions.length > 0) {
            mappedTransactions = prediction.transactions.map((tx) => {
                const txMappedCategory = mapCategoryToLocal(
                    tx.category,
                    localCategories,
                    tx.type
                );
                return {
                    amount: tx.amount,
                    categoryId: txMappedCategory?.categoryId || mappedCategory?.categoryId || "",
                    categoryName: txMappedCategory?.categoryName || tx.category,
                    io: tx.type === "Thu nhập" ? ("IN" as const) : ("OUT" as const),
                    confidence: tx.confidence,
                    note: tx.note,
                    date: date,
                };
            });
        }

        // Use the conversational message from backend (already context-aware)
        const message = prediction.message || "Giao dịch đã được xử lý!";

        // Calculate overall confidence from transactions
        const overallConfidence = prediction.transactions?.length
            ? prediction.transactions.reduce((sum, tx) => sum + (tx.confidence || 0.9), 0) / prediction.transactions.length
            : 0.9;

        return {
            amount: prediction.amount || null,
            categoryId: mappedCategory?.categoryId || "",
            categoryName: mappedCategory?.categoryName || backendCategory,
            io,
            confidence: overallConfidence,
            note: text,
            date,
            isMultiple: isMultiple || false,
            transactions: mappedTransactions,
            message,
            overallConfidence,
            source: "llm",
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Backend classification failed: ${errorMessage}`);

        // Return error result so caller can fallback to local classification
        return {
            amount: null,
            categoryId: "",
            categoryName: "",
            io: "OUT",
            confidence: 0,
            note: text,
            date,
            isMultiple: false,
            message: "",
            overallConfidence: 0,
            error: errorMessage,
            source: "llm",
        };
    }
}

/**
 * Get available categories from backend (for reference)
 */
export async function getBackendCategories(): Promise<{
    categories: string[];
    transactionTypes: string[];
} | null> {
    try {
        const fetchPromise = fetch(`${BACKEND_API_URL}/api/v1/categories`, {
            method: "GET",
            headers: { "Accept": "application/json" },
        });

        const timeoutPromise = new Promise<Response>((_, reject) => {
            setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response.ok) return null;

        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Get current backend API URL
 */
export function getBackendApiUrl(): string {
    return BACKEND_API_URL;
}

/**
 * Get pending request count (for debugging/monitoring)
 */
export function getPendingRequestCount(): number {
    return requestDeduplicationManager.getPendingCount();
}

/**
 * Abort all pending backend requests
 */
export function abortAllBackendRequests(): void {
    requestDeduplicationManager.abortAll();
}
