/**
 * Backend Classification Service
 * Calls KLTN_UIT_BE API for transaction classification using LLM (llama.cpp)
 * 
 * API: POST /api/v1/predict
 * Architecture: React Native → FastAPI → llama.cpp → JSON
 */

import Constants from "expo-constants";
import type { Category } from "@/repos/categoryRepo";

// Backend API configuration
// Uses environment variable from app.config.js or .env file
// For local development: set EXPO_PUBLIC_BACKEND_API_URL to your PC's IP
const BACKEND_API_URL =
    Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_API_URL ||
    "http://10.53.108.244:8000";

// Timeout for LLM inference (7B model can be slow)
const API_TIMEOUT = 90000;

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
    item: string;
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
    category: string;
    type: "Thu nhập" | "Chi phí";
    confidence: number;
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
}

/**
 * Health check response
 */
interface HealthCheckResponse {
    status: string;
    llm_available: boolean;
    version: string;
}

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
            setTimeout(() => reject(new Error("Health check timeout")), 10000);
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
 * Map backend category name to local category ID
 * Uses fuzzy matching to find the best match
 */
function mapCategoryToLocal(
    backendCategory: string,
    localCategories: Category[],
    transactionType: "Thu nhập" | "Chi phí"
): { categoryId: string; categoryName: string } | null {
    if (!backendCategory || !localCategories.length) return null;

    const normalizedBackend = backendCategory.toLowerCase().trim();
    const expectedType = transactionType === "Thu nhập" ? "income" : "expense";

    // Priority 1: Exact match with correct type
    const exactMatch = localCategories.find(
        (c) =>
            c.name.toLowerCase().trim() === normalizedBackend &&
            c.type === expectedType
    );
    if (exactMatch) {
        return { categoryId: exactMatch.id, categoryName: exactMatch.name };
    }

    // Priority 2: Exact match any type
    const exactMatchAnyType = localCategories.find(
        (c) => c.name.toLowerCase().trim() === normalizedBackend
    );
    if (exactMatchAnyType) {
        return {
            categoryId: exactMatchAnyType.id,
            categoryName: exactMatchAnyType.name,
        };
    }

    // Priority 3: Contains match with correct type
    const containsMatch = localCategories.find(
        (c) =>
            (c.name.toLowerCase().includes(normalizedBackend) ||
                normalizedBackend.includes(c.name.toLowerCase())) &&
            c.type === expectedType
    );
    if (containsMatch) {
        return { categoryId: containsMatch.id, categoryName: containsMatch.name };
    }

    // Priority 4: Contains match any type
    const containsMatchAnyType = localCategories.find(
        (c) =>
            c.name.toLowerCase().includes(normalizedBackend) ||
            normalizedBackend.includes(c.name.toLowerCase())
    );
    if (containsMatchAnyType) {
        return {
            categoryId: containsMatchAnyType.id,
            categoryName: containsMatchAnyType.name,
        };
    }

    // Priority 5: Vietnamese category name mapping
    const categoryMapping: Record<string, string[]> = {
        "ăn uống": ["food", "eating", "meal", "cafe", "coffee", "drink", "ăn", "uống", "café"],
        "di chuyển": ["transport", "travel", "grab", "taxi", "xe", "xăng", "bus"],
        "mua sắm": ["shopping", "buy", "mua", "shop", "market"],
        "giải trí": ["entertainment", "movie", "game", "music", "phim"],
        "hóa đơn": ["bill", "utility", "điện", "nước", "internet", "phone"],
        "sức khỏe": ["health", "medical", "doctor", "thuốc", "bệnh viện"],
        "giáo dục": ["education", "school", "course", "học", "sách"],
        "quà tặng": ["gift", "present", "quà", "tặng", "cho"],
        "lương": ["salary", "wage", "income", "lương", "thu nhập"],
        "khác": ["other", "misc", "khác"],
    };

    for (const [catName, aliases] of Object.entries(categoryMapping)) {
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

    // Fallback: Return first category of matching type
    const fallback = localCategories.find((c) => c.type === expectedType);
    if (fallback) {
        return { categoryId: fallback.id, categoryName: fallback.name };
    }

    return null;
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
        const items = prediction.transactions
            .map((t) => `${t.item} ${t.amount.toLocaleString("vi-VN")}đ`)
            .join(", ");
        return `Đã ghi ${count} giao dịch: ${items}. Tổng ${transactionType}: ${formattedAmount}đ ✓`;
    }

    const confidenceStr =
        prediction.confidence < 0.75
            ? ` (${(prediction.confidence * 100).toFixed(0)}% chắc chắn)`
            : " ✓";

    return `Đã ghi ${transactionType} ${formattedAmount}đ cho ${originalText}. Phân loại: ${prediction.category}${confidenceStr}`;
}

/**
 * Call backend API to classify transaction
 * Supports both single and multi-transaction parsing
 */
export async function classifyTransactionWithBackend(
    text: string,
    localCategories: Category[]
): Promise<MappedPrediction> {
    const date = parseDateFromText(text);

    try {
        const apiUrl = `${BACKEND_API_URL}/api/v1/predict`;
        const categoryNames = localCategories.map((c) => c.name);

        const requestBody: PredictRequest = {
            text: text,
            categories: categoryNames,
            locale: "vi-VN",
            currency: "VND",
        };

        // Use Promise.race for timeout (more reliable on React Native)
        const fetchPromise = fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        const timeoutPromise = new Promise<Response>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Request timeout after ${API_TIMEOUT}ms`));
            }, API_TIMEOUT);
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Backend API error: ${response.status}`, errorText);
            throw new Error(`API error: ${response.status}`);
        }

        const prediction: PredictResponse = await response.json();

        // Map backend category to local category
        const mappedCategory = mapCategoryToLocal(
            prediction.category,
            localCategories,
            prediction.type
        );

        const io: "IN" | "OUT" = prediction.type === "Thu nhập" ? "IN" : "OUT";
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
                    io: tx.type === "Thu nhập" ? "IN" as const : "OUT" as const,
                    confidence: tx.confidence,
                    note: tx.item,
                    date: date,
                };
            });
        }

        const message = generateMessage(prediction, isMultiple || false, text);

        return {
            amount: prediction.amount || null,
            categoryId: mappedCategory?.categoryId || "",
            categoryName: mappedCategory?.categoryName || prediction.category,
            io,
            confidence: prediction.confidence,
            note: text,
            date,
            isMultiple: isMultiple || false,
            transactions: mappedTransactions,
            message,
            overallConfidence: prediction.confidence,
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
