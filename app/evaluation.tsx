/**
 * Màn hình đánh giá mô hình AI
 * Test 510+ giao dịch và tính Precision, Recall, F1 Score
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    Alert,
    Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/app/providers/ThemeProvider';
import { listCategories, type Category } from '@/repos/categoryRepo';
import {
    runEvaluation,
    formatReportAsMarkdown,
    generateReportJSON,
    testData,
    type EvaluationReport,
    type EvaluationResult,
} from '@/services/EvaluationService';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getBackendApiUrl } from '@/services/backendClassificationService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function EvaluationScreen() {
    const { colors } = useTheme();
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [totalSamples, setTotalSamples] = useState(testData.test_samples.length);
    const [currentResult, setCurrentResult] = useState<EvaluationResult | null>(null);
    const [report, setReport] = useState<EvaluationReport | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const abortRef = useRef(false);

    useEffect(() => {
        loadCategories();
        // Load default sample count
        setTotalSamples(testData.test_samples.length);
    }, []);

    const loadCategories = async () => {
        try {
            const cats = await listCategories();
            setCategories(cats);
            console.log(`Loaded ${cats.length} categories`);
        } catch (error) {
            console.error('Failed to load categories:', error);
            Alert.alert('Lỗi', 'Không thể tải danh mục');
        }
    };

    // API Health Check
    const [apiStatus, setApiStatus] = useState<'unknown' | 'checking' | 'healthy' | 'error'>('unknown');
    const [apiDetails, setApiDetails] = useState<string>('');

    const checkApiHealth = async () => {
        setApiStatus('checking');
        setApiDetails('Đang kiểm tra...');

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${getBackendApiUrl()}/api/v1/health`, {
                method: 'GET',
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.ok) {
                const data = await response.json();
                setApiStatus('healthy');
                setApiDetails(`✅ Backend: ${data.status}\n✅ LLM: ${data.llm_available ? 'Available' : 'Not available'}\n📌 Version: ${data.version || 'N/A'}`);
                Alert.alert('API Health', `Status: ${data.status}\nLLM Available: ${data.llm_available}\nVersion: ${data.version || 'N/A'}`);
            } else {
                setApiStatus('error');
                setApiDetails(`❌ HTTP ${response.status}`);
                Alert.alert('API Error', `HTTP Status: ${response.status}`);
            }
        } catch (error: any) {
            setApiStatus('error');
            const errorMsg = error.name === 'AbortError' ? 'Timeout (10s)' : error.message;
            setApiDetails(`❌ ${errorMsg}`);
            Alert.alert('API Error', `Không thể kết nối backend:\n${errorMsg}\n\nHãy đảm bảo:\n1. Backend đang chạy (port 8000)\n2. IP address đúng\n3. Cùng mạng WiFi`);
        }
    };

    const handleStartEvaluation = async () => {
        if (categories.length === 0) {
            Alert.alert('Lỗi', 'Chưa có danh mục. Vui lòng tạo danh mục trước.');
            return;
        }

        Alert.alert(
            'Bắt đầu đánh giá',
            `Đánh giá mô hình với ${totalSamples} giao dịch test (hỗ trợ đa giao dịch).\n\nDanh mục: ${categories.map(c => c.name).join(', ')}\n\nQuá trình có thể mất 10-15 phút.`,
            [
                { text: 'Hủy', style: 'cancel' },
                {
                    text: 'Bắt đầu',
                    onPress: runTest,
                },
            ]
        );
    };

    const runTest = async () => {
        setIsRunning(true);
        setProgress(0);
        setReport(null);
        abortRef.current = false;

        try {
            const result = await runEvaluation(categories, (current, total, res) => {
                setProgress(current);
                setTotalSamples(total);
                setCurrentResult(res);
            });

            setReport(result);
            Alert.alert(
                'Hoàn thành!',
                `Macro F1: ${(result.macroMetrics.f1 * 100).toFixed(1)}%\nPerfect Samples: ${((result.perfectSampleMatchCount / result.totalSamples) * 100).toFixed(1)}%`
            );
        } catch (error) {
            console.error('Evaluation failed:', error);
            Alert.alert('Lỗi', 'Đánh giá thất bại: ' + String(error));
        } finally {
            setIsRunning(false);
        }
    };

    const handleExportReport = async () => {
        if (!report) return;

        try {
            const markdown = formatReportAsMarkdown(report);
            const json = generateReportJSON(report);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const docDir = FileSystem.cacheDirectory || '';
            const mdPath = `${docDir}evaluation_report_${timestamp}.md`;
            const jsonPath = `${docDir}evaluation_report_${timestamp}.json`;

            await FileSystem.writeAsStringAsync(mdPath, markdown);
            await FileSystem.writeAsStringAsync(jsonPath, json);

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(mdPath);
            } else {
                Alert.alert('Thành công', `Đã lưu báo cáo tại:\n${mdPath}`);
            }
        } catch (error) {
            Alert.alert('Lỗi', 'Không thể xuất báo cáo');
        }
    };

    const renderProgressCard = () => (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
                🧪 Đang đánh giá...
            </Text>

            <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { backgroundColor: colors.divider }]}>
                    <View
                        style={[
                            styles.progressFill,
                            {
                                backgroundColor: '#4CAF50',
                                width: `${(progress / totalSamples) * 100}%`,
                            },
                        ]}
                    />
                </View>
                <Text style={[styles.progressText, { color: colors.subText }]}>
                    {progress} / {totalSamples}
                </Text>
            </View>

            {currentResult && (
                <View style={styles.currentTest}>
                    <Text style={[styles.testText, { color: colors.text }]} numberOfLines={2}>
                        "{currentResult.text}"
                    </Text>
                    <View style={styles.testResultContainer}>
                        {currentResult.matches.map((match, idx) => (
                            <View key={idx} style={styles.matchRow}>
                                {match.status === 'TP' && (
                                    <Text style={{ color: '#4CAF50', fontSize: 13 }}>✓ {match.predicted?.category} (Correct)</Text>
                                )}
                                {match.status === 'FN' && (
                                    <Text style={{ color: '#F44336', fontSize: 13 }}>✗ Missed: {match.expected?.category}</Text>
                                )}
                                {match.status === 'FP' && (
                                    <Text style={{ color: '#FF9800', fontSize: 13 }}>⚠️ Extra: {match.predicted?.category}</Text>
                                )}
                            </View>
                        ))}
                    </View>
                </View>
            )}
        </View>
    );

    const renderReportCard = () => {
        if (!report) return null;

        return (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                    📊 Kết Quả Đánh Giá
                </Text>

                {/* Bảng 1: Tổng hợp */}
                <View style={styles.metricsSection}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                        Bảng 1: Tổng Hợp Metrics
                    </Text>

                    <View style={styles.metricsGrid}>
                        <View style={[styles.metricBox, { backgroundColor: '#E3F2FD' }]}>
                            <Text style={styles.metricValue}>
                                {(report.macroMetrics.precision * 100).toFixed(1)}%
                            </Text>
                            <Text style={styles.metricLabel}>Precision</Text>
                        </View>
                        <View style={[styles.metricBox, { backgroundColor: '#E8F5E9' }]}>
                            <Text style={styles.metricValue}>
                                {(report.macroMetrics.recall * 100).toFixed(1)}%
                            </Text>
                            <Text style={styles.metricLabel}>Recall</Text>
                        </View>
                        <View style={[styles.metricBox, { backgroundColor: '#FFF3E0' }]}>
                            <Text style={styles.metricValue}>
                                {(report.macroMetrics.f1 * 100).toFixed(1)}%
                            </Text>
                            <Text style={styles.metricLabel}>F1 Score</Text>
                        </View>
                    </View>

                    <View style={styles.accuracyRow}>
                        <Text style={{ color: colors.subText }}>
                            Perfect Samples: {((report.perfectSampleMatchCount / report.totalSamples) * 100).toFixed(1)}%
                        </Text>
                        <Text style={{ color: colors.subText }}>
                            Latency: {report.averageLatencyMs.toFixed(0)}ms
                        </Text>
                    </View>
                </View>

                {/* Bảng 2: Chi tiết per-category */}
                <View style={styles.metricsSection}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                        Bảng 2: Metrics Theo Danh Mục
                    </Text>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View>
                            <View style={[styles.tableRow, styles.tableHeader]}>
                                <Text style={[styles.tableCell, styles.categoryCell, { fontWeight: 'bold' }]}>Danh mục</Text>
                                <Text style={[styles.tableCell, { fontWeight: 'bold' }]}>P</Text>
                                <Text style={[styles.tableCell, { fontWeight: 'bold' }]}>R</Text>
                                <Text style={[styles.tableCell, { fontWeight: 'bold' }]}>F1</Text>
                                <Text style={[styles.tableCell, { fontWeight: 'bold' }]}>Support</Text>
                            </View>

                            {Object.entries(report.perCategoryMetrics).map(([cat, m]) => (
                                <View key={cat} style={styles.tableRow}>
                                    <Text style={[styles.tableCell, styles.categoryCell, { color: colors.text }]}>
                                        {cat}
                                    </Text>
                                    <Text style={[styles.tableCell, { color: getScoreColor(m.precision) }]}>
                                        {(m.precision * 100).toFixed(0)}%
                                    </Text>
                                    <Text style={[styles.tableCell, { color: getScoreColor(m.recall) }]}>
                                        {(m.recall * 100).toFixed(0)}%
                                    </Text>
                                    <Text style={[styles.tableCell, { color: getScoreColor(m.f1) }]}>
                                        {(m.f1 * 100).toFixed(0)}%
                                    </Text>
                                    <Text style={[styles.tableCell, { color: colors.subText }]}>
                                        {m.support}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </ScrollView>
                </View>

                {/* Export button */}
                <TouchableOpacity
                    style={[styles.exportButton, { backgroundColor: '#3B82F6' }]}
                    onPress={handleExportReport}
                >
                    <MaterialCommunityIcons name="export" size={20} color="#fff" />
                    <Text style={styles.exportButtonText}>Xuất Báo Cáo</Text>
                </TouchableOpacity>
            </View>
        );
    };

    const getScoreColor = (score: number) => {
        if (score >= 0.9) return '#4CAF50';
        if (score >= 0.7) return '#FFC107';
        if (score >= 0.5) return '#FF9800';
        return '#F44336';
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.divider }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    🧪 Đánh Giá Mô Hình
                </Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
                {/* Info card */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>
                        ℹ️ Thông Tin
                    </Text>
                    <Text style={[styles.infoText, { color: colors.subText }]}>
                        Đánh giá độ chính xác của mô hình AI qwen2.5-7b (Backend) trong việc phân loại giao dịch tài chính.
                    </Text>
                    <Text style={[styles.infoText, { color: colors.subText }]}>
                        • {totalSamples} giao dịch test{'\n'}
                        • Hỗ trợ đa giao dịch (Multi-transaction){'\n'}
                        • Tính Precision, Recall, F1 Score
                    </Text>

                    <Text style={[styles.categoryList, { color: colors.text }]}>
                        Danh mục: {categories.map(c => c.name).join(', ') || 'Đang tải...'}
                    </Text>
                </View>

                {/* API Health Check Card */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>
                        🔌 Kiểm Tra API
                    </Text>

                    <View style={styles.apiStatusRow}>
                        <View style={styles.apiStatusInfo}>
                            <View style={[
                                styles.statusDot,
                                {
                                    backgroundColor: apiStatus === 'healthy' ? '#4CAF50' :
                                        apiStatus === 'error' ? '#F44336' :
                                            apiStatus === 'checking' ? '#FFC107' : '#9E9E9E'
                                }
                            ]} />
                            <Text style={{ color: colors.text, fontWeight: '500' }}>
                                {apiStatus === 'healthy' ? 'Connected' :
                                    apiStatus === 'error' ? 'Error' :
                                        apiStatus === 'checking' ? 'Checking...' : 'Not checked'}
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={[styles.checkApiButton, { opacity: apiStatus === 'checking' ? 0.5 : 1 }]}
                            onPress={checkApiHealth}
                            disabled={apiStatus === 'checking'}
                        >
                            <MaterialCommunityIcons
                                name={apiStatus === 'checking' ? 'loading' : 'refresh'}
                                size={18}
                                color="#fff"
                            />
                            <Text style={styles.checkApiButtonText}>
                                Check API
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {apiDetails ? (
                        <Text style={[styles.apiDetails, { color: colors.subText }]}>
                            {apiDetails}
                        </Text>
                    ) : null}
                </View>

                {/* Progress or Results */}
                {isRunning && renderProgressCard()}
                {report && renderReportCard()}

                {/* Start button */}
                {!isRunning && !report && (
                    <TouchableOpacity
                        style={[styles.startButton, { backgroundColor: '#4CAF50' }]}
                        onPress={handleStartEvaluation}
                        disabled={categories.length === 0}
                    >
                        <MaterialCommunityIcons name="play" size={24} color="#fff" />
                        <Text style={styles.startButtonText}>Bắt Đầu Đánh Giá</Text>
                    </TouchableOpacity>
                )}

                {/* Run again button */}
                {report && !isRunning && (
                    <TouchableOpacity
                        style={[styles.startButton, { backgroundColor: '#3B82F6' }]}
                        onPress={handleStartEvaluation}
                    >
                        <MaterialCommunityIcons name="refresh" size={24} color="#fff" />
                        <Text style={styles.startButtonText}>Chạy Lại</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        gap: 16,
    },
    card: {
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 12,
    },
    infoText: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 8,
    },
    categoryList: {
        fontSize: 12,
        marginTop: 8,
        fontStyle: 'italic',
    },
    progressContainer: {
        marginTop: 8,
    },
    progressBar: {
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 4,
    },
    progressText: {
        textAlign: 'center',
        marginTop: 8,
        fontSize: 14,
    },
    currentTest: {
        marginTop: 16,
        padding: 12,
        backgroundColor: 'rgba(0,0,0,0.05)',
        borderRadius: 8,
    },
    testText: {
        fontSize: 14,
        marginBottom: 8,
        fontStyle: 'italic',
    },
    testResultContainer: {
        marginTop: 4,
        gap: 2,
    },
    matchRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    metricsSection: {
        marginTop: 16,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 12,
    },
    metricsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
    },
    metricBox: {
        flex: 1,
        padding: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    metricValue: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
    },
    metricLabel: {
        fontSize: 12,
        color: '#666',
        marginTop: 4,
    },
    accuracyRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 12,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    tableHeader: {
        backgroundColor: '#F5F5F5',
    },
    tableCell: {
        width: 50,
        padding: 8,
        textAlign: 'center',
        fontSize: 12,
    },
    categoryCell: {
        width: 100,
        textAlign: 'left',
    },
    exportButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderRadius: 8,
        marginTop: 16,
        gap: 8,
    },
    exportButtonText: {
        color: '#fff',
        fontWeight: '600',
    },
    startButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        borderRadius: 12,
        gap: 8,
    },
    startButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    // API Health Check styles
    apiStatusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    apiStatusInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    checkApiButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#3B82F6',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    checkApiButtonText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    apiDetails: {
        marginTop: 12,
        fontSize: 12,
        lineHeight: 18,
    },
});
