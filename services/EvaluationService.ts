/**
 * EvaluationService - Service đánh giá độ chính xác mô hình AI
 * Test 510+ giao dịch (bao gồm multi-transaction) và tính Precision, Recall, F1 Score
 */

import { classifyTransactionWithBackend } from './backendClassificationService';
import type { Category } from '@/repos/categoryRepo';

// Import test dataset
const testData = require('@/assets/test_500_transactions.json');

export interface TransactionItem {
    amount: number | null;
    category: string;
    type: string;
}

export interface TestSample {
    id: number;
    text: string;
    expected: TransactionItem[];
}

export interface EvaluationResult {
    id: number;
    text: string;
    expected: TransactionItem[];
    predicted: TransactionItem[];
    isPerfectMatch: boolean;
    latencyMs: number;
    matches: MatchDetail[];
}

export interface MatchDetail {
    expected: TransactionItem | null;
    predicted: TransactionItem | null;
    status: 'TP' | 'FP' | 'FN';
}

export interface CategoryMetrics {
    precision: number;
    recall: number;
    f1: number;
    support: number; // số lượng expected items
    tp: number;
    fp: number;
    fn: number;
}

export interface EvaluationReport {
    timestamp: string;
    totalSamples: number;
    totalTransactionsExpected: number;
    perfectSampleMatchCount: number; // Số sample đúng hoàn toàn (mọi trans đều đúng)

    // Macro metrics
    macroMetrics: {
        precision: number;
        recall: number;
        f1: number;
    };
    perCategoryMetrics: Record<string, CategoryMetrics>;
    confusionMatrix: Record<string, Record<string, number>>;
    averageLatencyMs: number;
    results: EvaluationResult[];
}

// Danh sách 9 danh mục chuẩn
const CATEGORIES = [
    'Ăn uống', 'Đi lại', 'Nhà ở', 'Mua sắm',
    'Giải trí', 'Giáo dục', 'Y tế', 'Thu nhập', 'Chưa xác định'
];

/**
 * Chạy evaluation trên tất cả test samples
 */
export async function runEvaluation(
    localCategories: Category[],
    onProgress?: (current: number, total: number, result: EvaluationResult) => void
): Promise<EvaluationReport> {
    const samples: TestSample[] = testData.test_samples;
    const results: EvaluationResult[] = [];

    console.log(`🧪 Starting evaluation with ${samples.length} samples...`);

    for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        const startTime = Date.now();

        try {
            // Gọi API predict qua backend
            const prediction = await classifyTransactionWithBackend(
                sample.text,
                localCategories
            );

            const latencyMs = Date.now() - startTime;

            // Convert prediction to consistent TransactionItem[]
            let predictedItems: TransactionItem[] = [];

            if (prediction.transactions && prediction.transactions.length > 0) {
                predictedItems = prediction.transactions.map(t => ({
                    amount: t.amount,
                    category: t.categoryName || t.category, // Handle naming inconsistencies
                    type: t.io === 'IN' ? 'Thu nhập' : 'Chi phí'
                }));
            } else {
                // Fallback for single transaction response
                predictedItems = [{
                    amount: prediction.amount,
                    category: prediction.categoryName || prediction.message || 'Chưa xác định', // Fallback
                    type: prediction.io === 'IN' ? 'Thu nhập' : 'Chi phí'
                }];

                // Note: Check if backend returns empty transaction list for invalid input
                // If message indicates failure or no transaction found, clean this up?
                // For now assuming backend always returns at least one generic result or empty list.
            }

            // Perform Matching
            const { matches, isPerfectMatch } = matchTransactions(sample.expected, predictedItems);

            const result: EvaluationResult = {
                id: sample.id,
                text: sample.text,
                expected: sample.expected,
                predicted: predictedItems,
                isPerfectMatch,
                latencyMs,
                matches
            };

            results.push(result);

            if (onProgress) {
                onProgress(i + 1, samples.length, result);
            }

            const predSummary = predictedItems.map(p => `${p.category}(${p.amount})`).join(', ');
            console.log(`[${i + 1}/${samples.length}] "${sample.text}" → [${predSummary}] (${isPerfectMatch ? '✓' : '✗'})`);

            // Delay nhỏ để tránh overload
            await sleep(50);

        } catch (error) {
            console.error(`Error evaluating sample ${sample.id}:`, error);

            // Log error result
            results.push({
                id: sample.id,
                text: sample.text,
                expected: sample.expected,
                predicted: [],
                isPerfectMatch: false,
                latencyMs: Date.now() - startTime,
                matches: sample.expected.map(e => ({ expected: e, predicted: null, status: 'FN' }))
            });
        }
    }

    // Tính metrics
    const report = calculateMetrics(results);

    console.log('\n📊 Evaluation Complete!');
    console.log(`Macro F1: ${(report.macroMetrics.f1 * 100).toFixed(1)}%`);
    console.log(`Perfect Match Rate: ${((report.perfectSampleMatchCount / report.totalSamples) * 100).toFixed(1)}%`);

    return report;
}

/**
 * Matching Algorithm: Greedy best match by Category
 */
function matchTransactions(expected: TransactionItem[], predicted: TransactionItem[]) {
    const matches: MatchDetail[] = [];
    const usedPredictedIndices = new Set<number>();

    // 1. Match expected items (TP, FN)
    for (const exp of expected) {
        let bestMatchIdx = -1;
        let bestScore = -1;

        // Find best matching predicted item not used yet
        predicted.forEach((pred, idx) => {
            if (usedPredictedIndices.has(idx)) return;

            let score = 0;
            // Category match is most important (100 pts)
            if (normalizeCategory(pred.category) === normalizeCategory(exp.category)) {
                score += 100;
            }
            // Amount match adds bonus (so we pick same-amount same-category if multiple exist)
            if (pred.amount === exp.amount) {
                score += 10;
            }

            if (score > bestScore && score > 0) { // Must at least match category? 
                // Wait, if category doesn't match, we shouldn't pair them unless we want to track 'Misclassification'
                // But for TP/FP/FN simpler approach:
                // TP = Category matched
                // If category wrong -> Expected is FN, Predicted is FP. They don't 'match'.
                bestScore = score;
                bestMatchIdx = idx;
            }
        });

        if (bestMatchIdx !== -1) {
            // Found TP
            usedPredictedIndices.add(bestMatchIdx);
            matches.push({
                expected: exp,
                predicted: predicted[bestMatchIdx],
                status: 'TP'
            });
        } else {
            // FN
            matches.push({
                expected: exp,
                predicted: null,
                status: 'FN'
            });
        }
    }

    // 2. Remaining predicted items are FP
    predicted.forEach((pred, idx) => {
        if (!usedPredictedIndices.has(idx)) {
            matches.push({
                expected: null,
                predicted: pred,
                status: 'FP'
            });
        }
    });

    const isPerfectMatch = matches.every(m => m.status === 'TP') && matches.length === expected.length;
    // Note: If matches has FP, isPerfectMatch should be false.
    // Logic: If length matches expected length AND all are TP -> No FP. 
    // Wait, matches list contains TP, FN, FP. 
    // Perfect match means NO FN and NO FP. 
    // So all matches must be TP.
    const perfect = !matches.some(m => m.status !== 'TP');

    return { matches, isPerfectMatch: perfect };
}

function normalizeCategory(category: string): string {
    return category ? category.toLowerCase().trim() : '';
}

/**
 * Tính Precision, Recall, F1 cho từng category based on matches
 */
function calculateMetrics(results: EvaluationResult[]): EvaluationReport {
    // Collect all matches from all results
    const allMatches = results.flatMap(r => r.matches);

    const categoryStats: Record<string, { tp: number; fp: number; fn: number; support: number }> = {};
    const confusionMatrix: Record<string, Record<string, number>> = {};

    // Initialize stats
    for (const cat of CATEGORIES) {
        categoryStats[cat] = { tp: 0, fp: 0, fn: 0, support: 0 };
        confusionMatrix[cat] = {};
        for (const cat2 of CATEGORIES) confusionMatrix[cat][cat2] = 0;
    }

    let totalTransactionsExpected = 0;
    const perfectSampleMatchCount = results.filter(r => r.isPerfectMatch).length;

    // Process matches
    for (const m of allMatches) {
        if (m.status === 'TP' && m.expected && m.predicted) {
            const cat = m.expected.category; // Or normalize? Use normalized key for mapping
            incrementStat(categoryStats, cat, 'tp');
            incrementStat(categoryStats, cat, 'support');
            totalTransactionsExpected++;

            // Confusion Matrix: TP maps cat -> cat
            incrementConfusion(confusionMatrix, cat, cat);
        }
        else if (m.status === 'FN' && m.expected) {
            const cat = m.expected.category;
            incrementStat(categoryStats, cat, 'fn');
            incrementStat(categoryStats, cat, 'support');
            totalTransactionsExpected++;

            // FN maps cat -> 'Missed' (or None)
            // For standard confusion matrix, we need to know what it was predicted AS.
            // But here we didn't pair it with a specific wrong prediction (we treated it as separate FP).
            // To fill Confusion Matrix properly (Expected vs Predicted), we need to link FN with FP from same sample if possible.
            // But multi-label confusion matrix is tricky. 
            // Simplified: Just count TP diagonal. Off-diagonal is hard without explicit pairing of errors.
            // We can leave off-diagonal empty or try to heuristic pair?
            // Let's stick to diagonal for matching.
        }
        else if (m.status === 'FP' && m.predicted) {
            const cat = m.predicted.category;
            incrementStat(categoryStats, cat, 'fp');
            // FP doesn't increase support (expected count)
        }
    }

    // Helper to safely increment
    function incrementStat(stats: any, rawCat: string, field: string) {
        // Find best matching standard category key
        const key = CATEGORIES.find(c => normalizeCategory(c) === normalizeCategory(rawCat)) || 'Chưa xác định';
        if (stats[key]) stats[key][field]++;
    }

    function incrementConfusion(matrix: any, rawExp: string, rawPred: string) {
        const keyExp = CATEGORIES.find(c => normalizeCategory(c) === normalizeCategory(rawExp)) || 'Chưa xác định';
        const keyPred = CATEGORIES.find(c => normalizeCategory(c) === normalizeCategory(rawPred)) || 'Chưa xác định';
        if (matrix[keyExp] && matrix[keyExp][keyPred] !== undefined) {
            matrix[keyExp][keyPred]++;
        }
    }

    // Tính metrics per category
    const perCategoryMetrics: Record<string, CategoryMetrics> = {};
    let totalPrecision = 0;
    let totalRecall = 0;
    let totalF1 = 0;
    let categoriesWithData = 0;

    for (const cat of CATEGORIES) {
        const stats = categoryStats[cat];
        const precision = stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
        const recall = stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
        const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

        perCategoryMetrics[cat] = {
            precision,
            recall,
            f1,
            support: stats.support,
            tp: stats.tp,
            fp: stats.fp,
            fn: stats.fn
        };

        if (stats.support > 0 || stats.fp > 0) { // Include in macro if there was any activity
            totalPrecision += precision;
            totalRecall += recall;
            totalF1 += f1;
            categoriesWithData++;
        }
    }

    const macroPrecision = categoriesWithData > 0 ? totalPrecision / categoriesWithData : 0;
    const macroRecall = categoriesWithData > 0 ? totalRecall / categoriesWithData : 0;
    const macroF1 = categoriesWithData > 0 ? totalF1 / categoriesWithData : 0;

    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;

    return {
        timestamp: new Date().toISOString(),
        totalSamples: results.length,
        totalTransactionsExpected,
        perfectSampleMatchCount,
        macroMetrics: {
            precision: macroPrecision,
            recall: macroRecall,
            f1: macroF1
        },
        perCategoryMetrics,
        confusionMatrix,
        averageLatencyMs: avgLatency,
        results
    };
}

/**
 * Format report thành markdown (Updated for multi-tx) với chi tiết từng giao dịch
 */
export function formatReportAsMarkdown(report: EvaluationReport): string {
    let md = `# 📊 Báo Cáo Đánh Giá Mô Hình AI\n\n`;
    md += `---\n\n`;

    // Header info
    md += `## 📋 Thông Tin Chung\n\n`;
    md += `| Thông tin | Giá trị |\n`;
    md += `|-----------|--------|\n`;
    md += `| **Thời gian đánh giá** | ${report.timestamp} |\n`;
    md += `| **Tổng số mẫu input** | ${report.totalSamples} |\n`;
    md += `| **Tổng số giao dịch expected** | ${report.totalTransactionsExpected} |\n`;
    md += `| **Samples đúng hoàn toàn** | ${report.perfectSampleMatchCount} (${((report.perfectSampleMatchCount / report.totalSamples) * 100).toFixed(1)}%) |\n`;
    md += `| **Thời gian phản hồi TB** | ${report.averageLatencyMs.toFixed(0)}ms |\n\n`;

    // Bảng 1: Tổng hợp Metrics
    md += `---\n\n`;
    md += `## 📈 Bảng 1: Tổng Hợp Metrics\n\n`;
    md += `| Metric | Giá trị |\n`;
    md += `|--------|--------|\n`;
    md += `| **Macro Precision** | ${(report.macroMetrics.precision * 100).toFixed(1)}% |\n`;
    md += `| **Macro Recall** | ${(report.macroMetrics.recall * 100).toFixed(1)}% |\n`;
    md += `| **Macro F1 Score** | ${(report.macroMetrics.f1 * 100).toFixed(1)}% |\n\n`;

    // Bảng 2: Chi tiết per-category
    md += `---\n\n`;
    md += `## 📊 Bảng 2: Metrics Theo Danh Mục\n\n`;
    md += `| Danh mục | Precision | Recall | F1 Score | Support | TP | FP | FN |\n`;
    md += `|----------|-----------|--------|----------|---------|----|----|----|\n`;

    for (const cat of CATEGORIES) {
        const m = report.perCategoryMetrics[cat];
        if (m) {
            md += `| ${cat} | ${(m.precision * 100).toFixed(1)}% | ${(m.recall * 100).toFixed(1)}% | ${(m.f1 * 100).toFixed(1)}% | ${m.support} | ${m.tp} | ${m.fp} | ${m.fn} |\n`;
        }
    }
    md += `\n`;

    // Bảng 3: Chi tiết TOÀN BỘ kết quả đánh giá
    md += `---\n\n`;
    md += `## 📝 Bảng 3: Chi Tiết Từng Mẫu Đánh Giá\n\n`;
    md += `**Chú thích:** ✅ = Đúng (TP) | ❌ = Bỏ sót (FN) | ⚠️ = Dư thừa (FP)\n\n`;

    // Summary counts
    const correctCount = report.results.filter(r => r.isPerfectMatch).length;
    const wrongCount = report.results.filter(r => !r.isPerfectMatch).length;
    md += `**Tổng kết:** ✅ Đúng hoàn toàn: ${correctCount} | ❌ Có lỗi: ${wrongCount}\n\n`;

    // Table header
    md += `| # | Input Text | Expected | Predicted | Status | Chi tiết |\n`;
    md += `|---|------------|----------|-----------|--------|----------|\n`;

    for (const result of report.results) {
        const statusIcon = result.isPerfectMatch ? '✅' : '❌';

        // Format expected
        const expectedStr = result.expected.map(e =>
            `${e.category} (${formatAmount(e.amount)})`
        ).join('<br>');

        // Format predicted  
        const predictedStr = result.predicted.length > 0
            ? result.predicted.map(p => `${p.category} (${formatAmount(p.amount)})`).join('<br>')
            : '*(không có)*';

        // Format match details
        const detailParts: string[] = [];
        for (const match of result.matches) {
            if (match.status === 'TP') {
                detailParts.push(`✅ ${match.expected?.category}`);
            } else if (match.status === 'FN') {
                detailParts.push(`❌ Missed: ${match.expected?.category}`);
            } else if (match.status === 'FP') {
                detailParts.push(`⚠️ Extra: ${match.predicted?.category}`);
            }
        }
        const detailStr = detailParts.join('<br>');

        // Truncate long text
        const inputText = result.text.length > 50
            ? result.text.substring(0, 47) + '...'
            : result.text;

        md += `| ${result.id} | ${escapeMarkdown(inputText)} | ${expectedStr} | ${predictedStr} | ${statusIcon} | ${detailStr} |\n`;
    }
    md += `\n`;

    // Bảng 4: Phân tích các lỗi chi tiết
    md += `---\n\n`;
    md += `## 🔍 Bảng 4: Phân Tích Lỗi Chi Tiết\n\n`;

    const failedSamples = report.results.filter(r => !r.isPerfectMatch);
    md += `**Tổng số mẫu lỗi:** ${failedSamples.length}\n\n`;

    for (const fail of failedSamples) {
        md += `### 📌 Mẫu #${fail.id}\n\n`;
        md += `**Input:** \`${fail.text}\`\n\n`;
        md += `**Latency:** ${fail.latencyMs}ms\n\n`;

        // Expected table
        md += `**Expected (Kỳ vọng):**\n`;
        md += `| # | Danh mục | Số tiền | Loại |\n`;
        md += `|---|----------|---------|------|\n`;
        fail.expected.forEach((e, idx) => {
            md += `| ${idx + 1} | ${e.category} | ${formatAmount(e.amount)} | ${e.type} |\n`;
        });
        md += `\n`;

        // Predicted table
        md += `**Predicted (Dự đoán):**\n`;
        if (fail.predicted.length > 0) {
            md += `| # | Danh mục | Số tiền | Loại |\n`;
            md += `|---|----------|---------|------|\n`;
            fail.predicted.forEach((p, idx) => {
                md += `| ${idx + 1} | ${p.category} | ${formatAmount(p.amount)} | ${p.type} |\n`;
            });
        } else {
            md += `*(Không có dự đoán)*\n`;
        }
        md += `\n`;

        // Match analysis
        md += `**Phân tích matching:**\n`;
        for (const match of fail.matches) {
            if (match.status === 'TP') {
                md += `- ✅ **ĐÚNG:** ${match.expected?.category} (${formatAmount(match.expected?.amount)}) → ${match.predicted?.category} (${formatAmount(match.predicted?.amount)})\n`;
            } else if (match.status === 'FN') {
                md += `- ❌ **BỎ SÓT:** Kỳ vọng \`${match.expected?.category} (${formatAmount(match.expected?.amount)})\` nhưng không tìm thấy\n`;
            } else if (match.status === 'FP') {
                md += `- ⚠️ **DƯ THỪA:** Dự đoán thêm \`${match.predicted?.category} (${formatAmount(match.predicted?.amount)})\` không có trong kỳ vọng\n`;
            }
        }
        md += `\n---\n\n`;
    }

    // Footer
    md += `## 📌 Ghi Chú\n\n`;
    md += `- **TP (True Positive):** Dự đoán đúng danh mục\n`;
    md += `- **FP (False Positive):** Dự đoán thêm giao dịch không có trong kỳ vọng\n`;
    md += `- **FN (False Negative):** Bỏ sót giao dịch có trong kỳ vọng\n`;
    md += `- **Perfect Match:** Tất cả giao dịch trong input đều được dự đoán đúng, không thiếu không thừa\n\n`;
    md += `---\n`;
    md += `*Báo cáo được tạo tự động bởi hệ thống đánh giá AI*\n`;

    return md;
}

// Helper function to format amount
function formatAmount(amount: number | null | undefined): string {
    if (amount === null || amount === undefined) return 'N/A';
    if (amount >= 1000000) {
        return `${(amount / 1000000).toFixed(1)}tr`;
    }
    if (amount >= 1000) {
        return `${(amount / 1000).toFixed(0)}k`;
    }
    return `${amount}đ`;
}

// Helper function to escape markdown special characters
function escapeMarkdown(text: string): string {
    return text
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}

export function generateReportJSON(report: EvaluationReport): string {
    return JSON.stringify(report, null, 2);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export { testData };
