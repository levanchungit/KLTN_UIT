import { useTheme } from "@/app/providers/ThemeProvider";
import { useAppTour } from "@/context/appTourContext";
import { db } from "@/db";
// logPrediction/logCorrection removed — TF training disabled
import { useI18n } from "@/i18n/I18nProvider";
import {
  listCategories,
  seedCategoryDefaults,
  type Category,
} from "@/repos/categoryRepo";

import {
  addExpense,
  addIncome,
  deleteTx,
  updateTransaction,
  getTxById,
} from "@/repos/transactionRepo";
import { listAccounts } from "@/repos/accountRepo";

// transactionClassifier removed — background TF training disabled
import {
  classifyTransactionWithBackend,
  checkBackendHealth,
  getBackendApiUrl,
  testBackendConnection,
  type MappedPrediction,
} from "@/services/backendClassificationService";
import useAudioMeter from "@/services/useAudioMeter";
import { getCurrentUserId } from "@/utils/auth";
import { fixIconName } from "@/utils/iconMapper";
import { parseAmountVN, parseTransactionText } from "@/utils/textPreprocessing";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { useFocusEffect } from "@react-navigation/native";
import Tooltip from "react-native-walkthrough-tooltip";
// Waveform visualization will use a lightweight animated view instead of capturing audio
// useModelTraining removed — TF training disabled
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Dimensions,
  FlatList,
  Image,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
// tfTransactionParser removed — TF training disabled (backend LLM is PRIORITY 1)

function tryPickJson(text: string) {
  if (!text) return null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : JSON.parse(text);
  } catch {
    return null;
  }
}


// Parse date from AI response or user input
function parseDateFromAI(aiResponse: string, originalNote: string): Date {
  const today = new Date();
  const combined = (aiResponse + " " + originalNote).toLowerCase();

  // Priority 1: Check for specific date formats

  // Format 1: DD/MM/YYYY or DD-MM-YYYY (full date with year)
  const ddmmyyyyMatch = originalNote.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/
  );
  if (ddmmyyyyMatch) {
    const day = parseInt(ddmmyyyyMatch[1]);
    const month = parseInt(ddmmyyyyMatch[2]) - 1; // Month is 0-indexed
    const year = parseInt(ddmmyyyyMatch[3]);
    const parsedDate = new Date(year, month, day);
    return parsedDate;
  }

  // Format 2: DD/MM or DD-MM (no year - use current year or infer intelligently)
  const ddmmMatch = originalNote.match(
    /(?:ngày\s+)?(\d{1,2})[\/\-](\d{1,2})(?!\d)/
  );
  if (ddmmMatch) {
    const day = parseInt(ddmmMatch[1]);
    const month = parseInt(ddmmMatch[2]) - 1; // Month is 0-indexed
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    // Smart year inference: if month is in the future, use current year; otherwise check if it makes sense
    let year = currentYear;
    const parsedDate = new Date(year, month, day);

    // If the date is more than 1 month in the future, assume user meant last year
    const diffDays =
      (parsedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 31) {
      year = currentYear - 1;
    }

    const finalDate = new Date(year, month, day);
    return finalDate;
  }

  // Format 3: YYYY-MM-DD
  const yyyymmddMatch = originalNote.match(
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/
  );
  if (yyyymmddMatch) {
    const year = parseInt(yyyymmddMatch[1]);
    const month = parseInt(yyyymmddMatch[2]) - 1;
    const day = parseInt(yyyymmddMatch[3]);
    const parsedDate = new Date(year, month, day);
    return parsedDate;
  }

  // Priority 2: Vietnamese relative date expressions
  if (originalNote.toLowerCase().includes("hôm qua")) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  if (originalNote.toLowerCase().includes("hôm nay")) {
    return today;
  }

  // Check for "N ngày trước" pattern
  const vnDaysMatch = originalNote.match(/(\d+)\s*ngày\s*trước/i);
  if (vnDaysMatch) {
    const daysAgo = parseInt(vnDaysMatch[1]);
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    return date;
  }

  if (originalNote.toLowerCase().includes("tuần trước")) {
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    return lastWeek;
  }

  if (originalNote.toLowerCase().includes("tháng trước")) {
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    return lastMonth;
  }

  // Priority 3: Check AI response for keywords
  if (combined.includes("yesterday")) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  // Check for N_days_ago pattern in AI response
  const daysAgoMatch = combined.match(/(\d+)_days?_ago/);
  if (daysAgoMatch) {
    const daysAgo = parseInt(daysAgoMatch[1]);
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    return date;
  }

  return today;
}

type Msg = {
  role: "user" | "bot" | "card" | "typing";
  text?: string;
  imageUri?: string;
  transactionId?: string;
  accountId?: string;
  amount?: number | null;
  io?: "IN" | "OUT";
  categoryId?: string;
  categoryName?: string;
  categoryIcon?: string;
  categoryColor?: string;
  note?: string;
  when?: string;
  date?: Date;
  cacheStatus?: "checking" | "cache_hit" | "cache_miss";
};


/* ---------------- Back only (no header) ---------------- */
function BackBar() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View
      style={{
        padding: 12,
        borderBottomWidth: 1,
        borderColor: colors.divider,
        backgroundColor: colors.card,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MaterialCommunityIcons
          name="chevron-left"
          size={28}
          color={colors.text}
        />
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
          {t("back")}
        </Text>
      </TouchableOpacity>

      {/* Nút đánh giá mô hình */}
      <TouchableOpacity
        onPress={() => router.push("/evaluation")}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          backgroundColor: "#4CAF50",
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 16,
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={{ fontSize: 14, color: "#fff" }}>🧪</Text>
        <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>
          Test
        </Text>
      </TouchableOpacity>
    </View>
  );
}

async function processReceiptImage(imageUri: string): Promise<{
  amount: number | null;
  text: string;
  merchantName?: string;
  category?: string;
  message?: string;
}> {
  try {
    // Step 1: ML Kit Text Recognition — extract text from image on-device
    const result = await TextRecognition.recognize(imageUri);

    console.log("=== ML Kit Text Recognition Results ===");
    console.log("Total blocks found:", result?.blocks?.length || 0);

    if (!result || !result.text || result.text.trim().length === 0) {
      return {
        amount: null,
        text: "❌ Không đọc được text từ hóa đơn.\n\nVui lòng thử ảnh rõ hơn.",
        merchantName: "",
      };
    }

    const blocks = result.blocks || [];

    // Log blocks for debug
    blocks.forEach((block: any, index: number) => {
      console.log(`Block ${index + 1}: "${block.text}" (top=${block.frame?.top})`);
    });

    const ocrText = result.text;

    // Step 2: Send OCR text + block positions to backend LLM for intelligent analysis
    try {
      const apiUrl = `${getBackendApiUrl()}/api/v1/predict-receipt`;
      console.log(`🧾 Calling receipt AI (NO TIMEOUT - DEMO MODE): ${apiUrl}`);

      // Get user categories for context-aware classification
      const categories = await listCategories();
      const userCategoryNames = categories.map((c) => c.name);

      const ocrBlocks = blocks.map((b: any) => ({
        text: b.text || "",
        top: b.frame?.top || 0,
        left: b.frame?.left || 0,
        width: b.frame?.width || 0,
        height: b.frame?.height || 0,
      }));

      // REMOVE TIMEOUT: Let it wait for backend as long as needed
      // const controller = new AbortController();
      // const timeoutId = setTimeout(() => controller.abort(), 60000);

      console.log("=== Receipt AI Request Body ===");
      console.log("OCR Text ocrText.substring(0, 3000):", ocrText.substring(0, 3000));
      // console.log("blocks: ocrBlocks:", ocrBlocks);
      console.log("User Categories:", userCategoryNames);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocr_text: ocrText.substring(0, 3000),
          blocks: ocrBlocks,
          user_categories: userCategoryNames,
        }),
        // signal: controller.signal, // No signal to allow long processing
      });

      console.log("=== Receipt AI Response ===");
      console.log("Status:", response.status);

      // clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log(`🎯 AI Receipt Result:`, data);

        if (data.total_amount && data.total_amount > 0) {
          return {
            amount: data.total_amount,
            text: ocrText.substring(0, 500),
            merchantName: data.merchant_name || "Hoá đơn",
            category: data.category || undefined,
            message: data.message,
          };
        }

        // Backend replied 200 OK but no amount found
        return {
          amount: null,
          text: `⚠️ AI đã xử lý nhưng không tìm thấy số tiền.\n\nPhản hồi từ Server:\n${JSON.stringify(data)}`,
          merchantName: "",
        };

      } else {
        throw new Error(`Server status: ${response.status}`);
      }
    } catch (aiError: any) {
      console.error("❌ Receipt AI failed (DEMO MODE - NO FALLBACK):", aiError);

      // Step 3: NO FALLBACK - Return error directly
      // This ensures we don't get wrong "Food" categories from local extraction.
      return {
        amount: null,
        text: `❌ Lỗi kết nối Server AI.\n\nChi tiết: ${aiError.message || "Unknown Error"}\n\n(Chế độ Demo: Đã tắt Fallback để tránh đoán sai)`,
        merchantName: "",
      };
    }
  } catch (error) {
    console.error("ML Kit Text Recognition error:", error);
    const errorMsg = error instanceof Error ? error.message : "Lỗi nhận diện text";
    return {
      amount: null,
      text: `❌ ${errorMsg}\n\nVui lòng thử lại với ảnh rõ hơn.`,
      merchantName: "",
    };
  }
}


const parseTransactionWithAI = async (
  text: string,
  userCategories: Category[]
): Promise<{
  action:
  | "CREATE_TRANSACTION"
  | "CREATE_MULTIPLE_TRANSACTIONS"
  | "VIEW_STATS"
  | "EDIT_TRANSACTION"
  | "DELETE_TRANSACTION";
  amount: number | null;
  note: string;
  categoryId: string;
  categoryName: string;
  io: "IN" | "OUT";
  date: Date;
  message: string;
  transactions?: Array<{
    amount: number;
    note: string;
    categoryId: string;
    categoryName: string;
    confidence: number;
    io?: "IN" | "OUT";
    date?: Date;
    alternatives?: Array<{
      categoryId: string;
      categoryName: string;
      confidence: number;
    }>;
  }>;
  confidence?: number;
  mlFailed?: boolean;
  alternatives?: Array<{
    categoryId: string;
    categoryName: string;
    confidence: number;
  }>;
  fromCache?: boolean;
  cacheLatency?: number;
} | null> => {
  const startTime = Date.now();

  try {
    // =========================================
    // Always call Backend API (LLM-based classification)
    // =========================================
    console.log("🌐 Calling backend API...");
    const backendStartTime = Date.now();
    const backendResult = await classifyTransactionWithBackend(text, userCategories);
    const backendLatency = Date.now() - backendStartTime;

    console.log(`🌐 Backend API completed in ${backendLatency}ms`);

    if (!backendResult.error && backendResult.categoryId && backendResult.confidence > 0) {
      console.log(`✅ Backend API success: ${backendResult.categoryName} (${(backendResult.confidence * 100).toFixed(1)}%)`);

      // Handle multi-transaction response
      if (backendResult.isMultiple && backendResult.transactions?.length) {
        console.log(`🎯 Multi-transaction detected: ${backendResult.transactions.length} items`);
        return {
          action: "CREATE_MULTIPLE_TRANSACTIONS",
          amount: backendResult.amount,
          note: backendResult.note,
          categoryId: backendResult.categoryId,
          categoryName: backendResult.categoryName,
          io: backendResult.io,
          date: backendResult.date,
          message: backendResult.message,
          transactions: backendResult.transactions.map(tx => ({
            amount: tx.amount,
            note: tx.note,
            categoryId: tx.categoryId,
            categoryName: tx.categoryName,
            confidence: tx.confidence,
            io: tx.io,
            date: tx.date,
          })),
          confidence: backendResult.confidence,
          mlFailed: false,
          fromCache: false,
        };
      }

      // Single transaction from backend
      return {
        action: "CREATE_TRANSACTION",
        amount: backendResult.amount,
        note: text,
        categoryId: backendResult.categoryId,
        categoryName: backendResult.categoryName,
        io: backendResult.io,
        date: backendResult.date,
        message: backendResult.message,
        confidence: backendResult.confidence,
        mlFailed: false,
        alternatives: [],
        fromCache: false,
      };
    }

    // Backend API failed — return null so caller falls back to regex-only path
    // (TF/PhoBERT local fallback disabled to prevent ANR crash)
    if (backendResult.error) {
      console.warn(`⚠️ Backend API failed: ${backendResult.error}. No local TF fallback (disabled).`);
    }
    return null;
  } catch (error) {
    console.error("❌ Transaction parser error:", error);
    return null;
  }
};

// IO is derived from the resolved category type (income/expense)

/* ---------------- Small NLP utils (for mapping ML → user's categories) ---------------- */
const normalizeVN = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => normalizeVN(s).split(" ").filter(Boolean);
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter++;
  });
  const unionSize = (() => {
    const U: Record<string, 1> = {};
    a.forEach((x) => (U[x] = 1));
    b.forEach((x) => (U[x] = 1));
    return Object.keys(U).length;
  })();
  return unionSize ? inter / unionSize : 0;
};
const ngramSet = (s: string, n = 3) => {
  const t = normalizeVN(s);
  const out = new Set<string>();
  for (let i = 0; i <= Math.max(0, t.length - n); i++)
    out.add(t.slice(i, i + n));
  return out;
};
const ngramOverlap = (a: string, b: string, n = 3) => {
  const A = ngramSet(a, n);
  const B = ngramSet(b, n);
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter++;
  });
  return A.size + B.size ? (2 * inter) / (A.size + B.size) : 0;
};

/* ---------------- Heuristic scorer (fallback if ML missing) ---------------- */
const defaultKeywordsByName = (name: string): string[] => {
  const s = normalizeVN(name);

  // Ăn uống
  if (/(an|uong|uống|cafe|ca phe|coffee|food|nha hang)/.test(s))
    return [
      "an",
      "uong",
      "tra sua",
      "cafe",
      "ca phe",
      "nha hang",
      "foody",
      "com",
      "bun",
      "pho",
      "buffet",
      "lau",
    ];

  // Di chuyển
  if (/(di chuyen|xang|transport|grab|be|taxi|xe)/.test(s))
    return [
      "grab",
      "taxi",
      "be",
      "xang",
      "bus",
      "tau",
      "xe om",
      "goi xe",
      "ve may bay",
    ];

  // Mua sắm
  if (/(mua sam|shopping|quan ao|giay|thoi trang)/.test(s))
    return [
      "shopee",
      "tiki",
      "lazada",
      "quan ao",
      "giay",
      "mall",
      "mua",
      "order",
      "thoi trang",
    ];

  // Hóa đơn / Tiện ích
  if (/(hoa don|dien|nuoc|internet|wifi|tien ich)/.test(s))
    return [
      "dien",
      "nuoc",
      "internet",
      "wifi",
      "viettel",
      "vnpt",
      "fpt",
      "tien dien",
      "tien nuoc",
      "hoa don",
    ];

  // Nhà cửa
  if (/(nha cua|thue nha|chung cu|coc nha)/.test(s))
    return ["tien nha", "thue nha", "coc nha", "chung cu", "phong tro"];

  // Thú cưng
  if (/(thu cung|pet|cho|meo|cat|dog)/.test(s))
    return [
      "cho",
      "meo",
      "thu cung",
      "pet",
      "thu y",
      "do an cho cho",
      "do an meo",
      "vaccine",
      "kham cho",
    ];

  // Y tế / Sức khỏe
  if (/(y te|benh vien|kham benh|thuoc|suc khoe)/.test(s))
    return [
      "benh vien",
      "kham benh",
      "thuoc",
      "bac si",
      "phong kham",
      "nha khoa",
    ];

  // Giáo dục
  if (/(giao duc|hoc phi|sach|khoa hoc)/.test(s))
    return ["hoc phi", "sach", "khoa hoc", "truong", "day them"];

  // Giải trí
  if (/(giai tri|phim|game|du lich|travel)/.test(s))
    return ["phim", "rap", "game", "du lich", "khach san", "tour"];

  // Thu nhập
  if (/(thu nhap|luong|income)/.test(s))
    return [
      "luong",
      "thu nhap",
      "bonus",
      "thuong",
      "chuyen vao",
      "tien thuong",
    ];

  // Fallback: use category name tokens
  return tokens(name);
};
const heuristicScore = (text: string, cat: Category, io: "IN" | "OUT") => {
  const normalizedText = normalizeVN(text.toLowerCase());
  const normalizedCatName = normalizeVN(cat.name.toLowerCase());

  // Exact category name match (very high priority)
  const exactMatch = normalizedText.includes(normalizedCatName);
  if (exactMatch) {
    return 0.95; // Very high score for exact name match
  }

  // Token-based matching (smart keyword detection)
  const textTokens = tokens(text);
  const categoryTokens = tokens(cat.name);

  // Build comprehensive keyword list
  const kw = [
    ...((cat as any).keywords || []),
    ...((cat as any).aliases || []),
    ...((cat as any).tags || []),
    ...defaultKeywordsByName(cat.name || ""),
  ].map(normalizeVN);

  // Enhanced keyword matching with context
  // Check if any important keywords from the category appear in text
  const keywordMatch = kw.some((k) => normalizedText.includes(k));

  // Token overlap (how many words from category name appear in text)
  const tokenOverlap =
    categoryTokens.filter((tok) =>
      textTokens.some((t) => t.includes(tok) || tok.includes(t))
    ).length / Math.max(categoryTokens.length, 1);

  // Jaccard similarity
  const B = jaccard(textTokens, categoryTokens);

  // N-gram overlap
  const C = ngramOverlap(text, cat.name, 3);

  // Category-specific boost based on common patterns
  const D =
    io === "IN" && /thu nhap|luong/.test(normalizedCatName)
      ? 0.2
      : io === "OUT" &&
        /(hoa don|dien|nuoc|internet|wifi|mua sam|an uong|di chuyen|xang|thu cung|y te|giao duc)/.test(
          normalizedCatName
        )
        ? 0.1
        : 0;

  // Weighted scoring:
  // - Token overlap: 40% (most important for multi-word matching)
  // - Keyword match: 30%
  // - Jaccard: 15%
  // - N-gram: 10%
  // - Category boost: 5%
  const A = keywordMatch ? 1 : 0;
  return 0.3 * A + 0.4 * tokenOverlap + 0.15 * B + 0.1 * C + 0.05 * D;
};


/* ---------------- Create transaction (plug your API) ---------------- */
// ⬇️ Thay thế hoàn toàn hàm createTransaction cũ:
async function createTransaction(draft: {
  amount: number | null;
  io: "IN" | "OUT";
  categoryId?: string; // cần có để tạo; nếu chưa có hãy dùng pendingPick
  note: string;
  date?: Date; // Optional date from AI extraction
  allowZeroAmount?: boolean; // Allow creating transaction with 0 amount (for image receipts)
}) {
  if (!draft.allowZeroAmount && (!draft.amount || draft.amount <= 0)) {
    throw new Error("Không xác định được số tiền: " + draft.amount);
  }
  if (!draft.categoryId) {
    throw new Error("Missing categoryId for transaction creation.");
  }

  // Validate date: prevent future dates
  const transactionDate = draft.date || new Date();
  const today = new Date();
  today.setHours(23, 59, 59, 999); // Set to end of today for comparison

  if (transactionDate > today) {
    throw new Error(
      "Không thể tạo giao dịch cho ngày tương lai. Vui lòng chọn ngày hôm nay hoặc quá khứ."
    );
  }

  // chọn account mặc định: ưu tiên include_in_total=1 rồi đến account đầu tiên
  // Use cached default account for better performance
  const { getCachedDefaultAccount } = await import("@/services/cacheService");
  const acc = await getCachedDefaultAccount();
  if (!acc?.id) throw new Error("Chưa có tài khoản để ghi giao dịch.");

  const common = {
    accountId: acc.id as string,
    categoryId: draft.categoryId as string,
    amount: draft.amount || 0, // Use 0 if amount is null
    note: draft.note,
    when: transactionDate,
    updatedAt: new Date(),
  };

  const id =
    draft.io === "OUT"
      ? await addExpense(common as any)
      : await addIncome(common as any);

  return { id, ...draft, accountId: acc.id };
}

/* ---------------- Typing Indicator Component ---------------- */
function TypingIndicator({ colors, cacheStatus }: { colors: any; cacheStatus?: string }) {
  const [animations] = useState([
    new Animated.Value(0.3),
    new Animated.Value(0.3),
    new Animated.Value(0.3),
  ]);

  useEffect(() => {
    const animateDots = () => {
      const sequence = animations.map((anim, index) =>
        Animated.sequence([
          Animated.delay(index * 200), // Delay each dot
          Animated.timing(anim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      );

      Animated.loop(Animated.parallel(sequence)).start();
    };

    animateDots();

    return () => {
      animations.forEach((anim) => anim.stopAnimation());
    };
  }, [animations]);

  // Get status text based on cache status
  const getStatusText = () => {
    switch (cacheStatus) {
      case "checking":
        return "Đang kiểm tra cache...";
      case "cache_hit":
        return "Tìm thấy trong cache!";
      case "cache_miss":
        return "Đang xử lý AI...";
      default:
        return "Đang xử lý...";
    }
  };

  return (
    <View
      style={
        [
          styles.bubble,
          styles.left,
          {
            flexDirection: "column",
            gap: 8,
            backgroundColor: colors.card,
            borderColor: colors.divider,
            paddingVertical: 12,
            paddingHorizontal: 16,
            minWidth: 150,
          },
        ]}
    >
      {/* Animated dots */}
      < View style={{ flexDirection: "row", gap: 4 }
      }>
        {
          animations.map((anim, index) => (
            <Animated.View
              key={index}
              style={
                [
                  styles.dot,
                  { backgroundColor: colors.subText, opacity: anim },
                ]}
            />
          ))
        }
      </View>

      {/* Status text */}
      <Text style={{ color: colors.subText, fontSize: 12, fontStyle: "italic" }}>
        {getStatusText()}
      </Text>
    </View>
  );
}

/* ---------------- Pinch-to-Zoom Image Viewer ---------------- */
function PinchZoomImageViewer({
  uri,
  onClose,
}: {
  uri: string | null;
  onClose: () => void;
}) {
  const { width: SW, height: SH } = Dimensions.get("window");
  const CX = SW / 2;
  const CY = SH / 2;

  // Animated scale + translate
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Mutable refs for gesture tracking (avoid setState in gesture handlers)
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  // Pinch state
  const initialDistanceRef = useRef<number | null>(null);
  const initialScaleRef = useRef(1);
  const focalXRef = useRef(0);
  const focalYRef = useRef(0);
  const initialTxRef = useRef(0);
  const initialTyRef = useRef(0);

  // Double-tap detection
  const lastTapRef = useRef(0);
  const lastTapPoint = useRef<{ x: number; y: number } | null>(null);

  // Reset to default
  const resetTransform = () => {
    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  };

  // Get distance between 2 touches
  const getDistance = (touches: any[]) => {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Get midpoint of 2 touches
  const getMidpoint = (touches: any[]) => ({
    x: (touches[0].pageX + touches[1].pageX) / 2,
    y: (touches[0].pageY + touches[1].pageY) / 2,
  });

  // Tracking cho pan (kéo) 1 ngón
  const lastPanPoint = useRef<{ x: number; y: number } | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2,
      onPanResponderGrant: () => {
        initialDistanceRef.current = null;
        lastPanPoint.current = null;
      },
      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length === 2) {
          lastPanPoint.current = null; // Huỷ tracking pan 1 ngón

          if (initialDistanceRef.current === null) {
            // Bắt đầu pinch
            initialDistanceRef.current = getDistance(touches);
            initialScaleRef.current = scaleRef.current;
            const mid = getMidpoint(touches);
            focalXRef.current = mid.x;
            focalYRef.current = mid.y;
            initialTxRef.current = txRef.current;
            initialTyRef.current = tyRef.current;
          } else {
            // Đang pinch
            const newDist = getDistance(touches);
            const newScale = Math.max(
              0.5,
              Math.min(5, initialScaleRef.current * (newDist / initialDistanceRef.current))
            );

            // Zoom giữ nguyên vị trí focal (tính theo Center của View)
            const fX = focalXRef.current;
            const fY = focalYRef.current;
            const newTx =
              fX - CX - ((fX - CX - initialTxRef.current) / initialScaleRef.current) * newScale;
            const newTy =
              fY - CY - ((fY - CY - initialTyRef.current) / initialScaleRef.current) * newScale;

            scaleRef.current = newScale;
            txRef.current = newTx;
            tyRef.current = newTy;

            scale.setValue(newScale);
            translateX.setValue(newTx);
            translateY.setValue(newTy);
          }
        } else if (touches.length === 1 && scaleRef.current > 1) {
          // Pan 1 ngón (khi đã zoom)
          initialDistanceRef.current = null; // Huỷ tracking pinch

          const pt = { x: touches[0].pageX, y: touches[0].pageY };
          if (!lastPanPoint.current) {
            lastPanPoint.current = pt;
          } else {
            const dx = pt.x - lastPanPoint.current.x;
            const dy = pt.y - lastPanPoint.current.y;
            lastPanPoint.current = pt;

            const newTx = txRef.current + dx;
            const newTy = tyRef.current + dy;
            
            txRef.current = newTx;
            tyRef.current = newTy;
            translateX.setValue(newTx);
            translateY.setValue(newTy);
          }
        }
      },
      onPanResponderRelease: (evt, gs) => {
        initialDistanceRef.current = null;
        lastPanPoint.current = null;

        // Nếu zoom < 1x thì nảy về 1x
        if (scaleRef.current < 1) {
          resetTransform();
          return;
        }

        // Double tap để zoom/reset (khi ngón tay nhấc lên và không kéo)
        const changedTouches = evt.nativeEvent.changedTouches;
        if (changedTouches.length === 1 && Math.abs(gs.dx) < 10 && Math.abs(gs.dy) < 10) {
          const now = Date.now();
          const tapPt = { x: changedTouches[0].pageX, y: changedTouches[0].pageY };

          // Kiểm tra double tap trong vòng 300ms và cùng vị trí (sai số nhỏ)
          if (
            lastTapPoint.current &&
            now - lastTapRef.current < 300 &&
            Math.abs(tapPt.x - lastTapPoint.current.x) < 30 &&
            Math.abs(tapPt.y - lastTapPoint.current.y) < 30
          ) {
            // DOUBLE TAP THÀNH CÔNG
            if (scaleRef.current > 1) {
              resetTransform();
            } else {
              // Phóng to x3 vào vị trí đang tap
              const maxScale = 3;
              const newTx = (tapPt.x - CX) * (1 - maxScale);
              const newTy = (tapPt.y - CY) * (1 - maxScale);

              scaleRef.current = maxScale;
              txRef.current = newTx;
              tyRef.current = newTy;

              Animated.parallel([
                Animated.spring(scale, { toValue: maxScale, useNativeDriver: true }),
                Animated.spring(translateX, { toValue: newTx, useNativeDriver: true }),
                Animated.spring(translateY, { toValue: newTy, useNativeDriver: true }),
              ]).start();
            }
            lastTapRef.current = 0; // Reset
            lastTapPoint.current = null;
          } else {
            // Cập nhật tap cuối
            lastTapRef.current = now;
            lastTapPoint.current = tapPt;
          }
        }
      },
      onPanResponderTerminate: () => {
        initialDistanceRef.current = null;
        lastPanPoint.current = null;
      }
    })
  ).current;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.95)",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Close button */}
      <TouchableOpacity
        style={{
          position: "absolute",
          top: 52,
          right: 20,
          zIndex: 10,
          backgroundColor: "rgba(255,255,255,0.25)",
          borderRadius: 25,
          width: 48,
          height: 48,
          justifyContent: "center",
          alignItems: "center",
        }}
        onPress={onClose}
      >
        <Ionicons name="close" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Hint */}
      <View
        style={{
          position: "absolute",
          bottom: 50,
          alignSelf: "center",
          zIndex: 10,
          backgroundColor: "rgba(0,0,0,0.45)",
          borderRadius: 20,
          paddingHorizontal: 16,
          paddingVertical: 6,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 12, opacity: 0.8 }}>
          Dùng 2 ngón để phóng to · Double-tap để reset
        </Text>
      </View>

      {/* Zoomable image */}
      <Animated.View
        style={{
          transform: [
            { translateX },
            { translateY },
            { scale },
          ],
        }}
        {...panResponder.panHandlers}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: SW, height: SH * 0.82 }}
            resizeMode="contain"
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

/* ---------------- Chat Message Item (Memoized) ---------------- */
const ChatMessageItem = React.memo(
  ({
    item,
    colors,
    mode,
    t,
    onEdit,
    onDelete,
    onImagePress,
  }: {
    item: any;
    colors: any;
    mode: any;
    t: (key: string) => string;
    onEdit: (item: any) => void;
    onDelete: (id: string) => void;
    onImagePress: (uri: string) => void;
  }) => {
    const { role } = item;

    if (role === "user") {
      return (
        <View
          style={[
            styles.bubble,
            styles.right,
            {
              backgroundColor: mode === "dark" ? "#1E3A8A" : "#E5F5F9",
              borderColor: mode === "dark" ? "#1E40AF" : "#D0EEF6",
            },
          ]}
        >
          {item.imageUri === "voice-recording" ? (
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
              }}
            >
              <Ionicons name="mic" size={48} color="#3B82F6" />
            </View>
          ) : item.imageUri ? (
            <TouchableOpacity onPress={() => onImagePress(item.imageUri!)}>
              <Image
                source={{ uri: item.imageUri }}
                style={{
                  width: 200,
                  height: 200,
                  borderRadius: 8,
                }}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ) : (
            <Text style={[styles.text, { color: colors.text }]}>{item.text}</Text>
          )}
        </View>
      );
    }

    if (role === "bot") {
      return (
        <View
          style={[
            styles.bubble,
            styles.left,
            {
              backgroundColor: colors.card,
              borderColor: colors.divider,
            },
          ]}
        >
          <Text style={[styles.text, { color: colors.text }]}>{item.text}</Text>
        </View>
      );
    }

    if (role === "typing") {
      return <TypingIndicator colors={colors} cacheStatus={item.cacheStatus} />;
    }

    // Card
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.divider,
          },
        ]}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: item.categoryColor || "#6366F1" },
            ]}
          >
            <MaterialCommunityIcons
              name={fixIconName(item.categoryIcon) as any}
              size={26}
              color="#fff"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.subText, marginBottom: 2 }}>
              {t("recorded")} {item.io === "OUT" ? t("expense") : t("income")} ·{" "}
              {item.when}
            </Text>
            <Text
              style={{
                fontWeight: "700",
                fontSize: 18,
                color: colors.text,
              }}
            >
              {item.categoryName}
            </Text>
            <Text style={{ marginTop: 2, color: colors.text }}>{item.note}</Text>
          </View>
          <Text
            style={{
              fontWeight: "700",
              fontSize: 16,
              color: colors.text,
            }}
          >
            {item.amount ? item.amount.toLocaleString() + "đ" : "—"}
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginTop: 16,
            justifyContent: "flex-end",
          }}
        >
          <TouchableOpacity
            onPress={() => onEdit(item)}
            style={[
              styles.actionBtn,
              {
                backgroundColor: mode === "dark" ? "#1E40AF" : "#DBEAFE",
                borderColor: mode === "dark" ? "#2563EB" : "#93C5FD",
                shadowColor: "#3B82F6",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 3,
                elevation: 2,
              },
            ]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="create-outline"
              size={18}
              color={mode === "dark" ? "#93C5FD" : "#2563EB"}
            />
            <Text
              style={{
                color: mode === "dark" ? "#93C5FD" : "#2563EB",
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {t("edit")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDelete(item.transactionId)}
            style={[
              styles.actionBtn,
              {
                backgroundColor: mode === "dark" ? "#7F1D1D" : "#FEE2E2",
                borderColor: mode === "dark" ? "#991B1B" : "#FCA5A5",
                shadowColor: "#EF4444",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 3,
                elevation: 2,
              },
            ]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color={mode === "dark" ? "#FCA5A5" : "#DC2626"}
            />
            <Text
              style={{
                color: mode === "dark" ? "#FCA5A5" : "#DC2626",
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {t("delete")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.item === next.item &&
      prev.mode === next.mode &&
      prev.colors === next.colors &&
      prev.t === next.t
    );
  }
);

/* ---------------- Component ---------------- */
export default function Chatbot() {
  const { t } = useI18n();
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputBarHeight, setInputBarHeight] = useState(0);

  const [items, setItems] = useState<Category[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [priors, setPriors] = useState<{
    IN: Record<string, number>;
    OUT: Record<string, number>;
  }>({ IN: {}, OUT: {} });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "bot", text: t("chatWelcome") },
  ]);
  const flatRef = useRef<FlatList>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [forceHideButton, setForceHideButton] = useState(false);
  const [isScrollingToBottom, setIsScrollingToBottom] = useState(false);
  const scrollButtonAnim = useRef(new Animated.Value(0)).current;

  // Voice states
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [spokenText, setSpokenText] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const audioMeter = useAudioMeter();

  // TF model training startup disabled — useModelTraining removed

  // Image viewer states
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const [recordDuration, setRecordDuration] = useState(0); // đơn vị: giây
  const recordStartRef = useRef<number | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const sessionIdRef = useRef(0);
  const activeSessionRef = useRef<number | null>(null);
  // when a final result is being processed, store its originating session
  const processingSessionRef = useRef<number | null>(null);
  const pendingFinalRef = useRef(false);
  const lastInterimRef = useRef("");
  const fallbackFinalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const clearFallbackTimer = () => {
    if (fallbackFinalTimerRef.current) {
      clearTimeout(fallbackFinalTimerRef.current);
      fallbackFinalTimerRef.current = null;
    }
  };

  //VOICE
  useSpeechRecognitionEvent("start", () => {
    clearFallbackTimer();
    setRecognizing(true);
    setIsRecording(true);
    setError(undefined);
    setSpokenText("");
    lastInterimRef.current = "";
  });

  useSpeechRecognitionEvent("end", () => {
    setRecognizing(false);
    setIsRecording(false);
  });

  useSpeechRecognitionEvent("result", (event: any) => {
    // If user cancelled, ignore this event
    if (cancelledRef.current) {
      // reset flag for next session and ignore
      cancelledRef.current = false;
      return;
    }

    // Use the activeSession captured when recording started. If it doesn't match
    // the current global sessionIdRef, this event is stale and should be ignored.
    const eventSession = activeSessionRef.current;
    if (eventSession == null || eventSession !== sessionIdRef.current) return;

    const text = event?.results?.[0]?.transcript || "";

    if (!text) return;

    // interim (partial) => hiển thị lên thanh đang ghi
    if (!event.isFinal) {
      setSpokenText(text.trim());
      lastInterimRef.current = text.trim();
      return;
    }

    // final => dừng ghi, xử lý như input text
    clearFallbackTimer();
    lastInterimRef.current = "";
    const finalText = text.trim();
    if (!finalText) return;

    setIsRecording(false);
    setRecognizing(false);
    setIsProcessingVoice(true);
    setSpokenText("");

    // mark pending final so cancel can remove it
    pendingFinalRef.current = true;

    // push message user (capture processing session)
    const procSession = eventSession;
    processingSessionRef.current = procSession;
    setMessages((m) => [...m, { role: "user", text: finalText }]);
    // Final speech result behaves like sending a message — clear suggestions
    setPendingPick(null);

    (async () => {
      try {
        // if session changed (cancel/new start) before processing, remove message and skip
        if (procSession !== sessionIdRef.current || cancelledRef.current) {
          pendingFinalRef.current = false;
          processingSessionRef.current = null;
          setIsProcessingVoice(false);
          setSpokenText("");
          setMessages((m) => m.slice(0, -1));
          return;
        }

        await processTextInput(finalText);
      } finally {
        pendingFinalRef.current = false;
        processingSessionRef.current = null;
        setIsProcessingVoice(false);
      }
    })();
  });

  useSpeechRecognitionEvent("error", (event: any) => {
    setError(event?.message || "Lỗi nhận diện giọng nói");
    // ensure all recording resources are stopped
    cancelRecording();
  });
  const lastRecordDurationRef = useRef(0);
  const startVoice = async () => {
    try {
      clearFallbackTimer();
      lastInterimRef.current = "";
      // Start a fresh session id for this recording. This helps ignore
      // any late speech events from previous sessions.
      sessionIdRef.current = (sessionIdRef.current || 0) + 1;

      // mark this session as active so result events know which session to apply to
      activeSessionRef.current = sessionIdRef.current;

      // clear any previous cancel flag
      cancelledRef.current = false;
      // xin quyền (robustly accept different response shapes)
      let perm: any;
      try {
        perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      } catch (e) {
        // some platforms may throw or not implement this call
        perm = null;
      }

      const permGranted =
        perm === true ||
        (perm && (perm.granted === true || perm.status === "granted"));

      if (!permGranted) {
        Alert.alert("Cần quyền microphone");
        return;
      }

      // Ensure previous sessions are stopped cleanly before starting a new one
      try {
        await ExpoSpeechRecognitionModule.stop();
      } catch { }

      // reset UI
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      setSpokenText("");
      setIsRecording(true);
      setRecordDuration(0);
      recordStartRef.current = Date.now();
      lastRecordDurationRef.current = 0;

      recordTimerRef.current = setInterval(() => {
        if (recordStartRef.current != null) {
          const sec = Math.floor((Date.now() - recordStartRef.current) / 1000);
          setRecordDuration(sec);
          lastRecordDurationRef.current = sec;
        }
      }, 500); // Reduced frequency to avoid lag

      // Start speech recognition with optimized settings for Vietnamese
      try {
        await ExpoSpeechRecognitionModule.start({
          lang: "vi-VN",
          interimResults: true,
          continuous: true,
          maxAlternatives: 1, // Focus on best result only
          requiresOnDeviceRecognition: false, // Use cloud for better Vietnamese accuracy
        });

        // Wait briefly for the recognition "start" event to arrive. If the
        // underlying module fails to emit events (some OEM ROMs / Android
        // combinations), abort the recording to avoid a stuck state.
        const waitForStart = async (timeout = 10000) => {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            if (recognizing) return true;
            // small delay
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 150));
          }
          return false;
        };

        const started = await waitForStart(10000);
        if (!started) {
          // Some devices don't emit start; continue silently instead of warning
          setRecognizing(true);
        }
      } catch (e) {
        console.warn("SpeechRecognition start failed", e);
        // reset recording state
        setIsRecording(false);
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        recordStartRef.current = null;
        return;
      }
    } catch (e) {
      console.warn("start error", e);
      setIsRecording(false);
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      recordStartRef.current = null;
    }
  };

  const stopVoice = async (opts?: { skipFallback?: boolean }) => {
    try {
      await ExpoSpeechRecognitionModule.stop();
      // Wait briefly for the final result event to be processed
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      // Ignore stop errors
    }

    setIsRecording(false);

    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    if (recordStartRef.current != null) {
      const sec = Math.floor((Date.now() - recordStartRef.current) / 1000);
      setRecordDuration(sec);
      lastRecordDurationRef.current = sec;
    }
    recordStartRef.current = null;

    // Fallback: if final event doesn't arrive quickly, submit the last interim
    clearFallbackTimer();

    // Khi đã gửi thủ công (ấn ✓), bỏ qua fallback để tránh gửi trùng
    if (opts?.skipFallback) {
      return;
    }

    fallbackFinalTimerRef.current = setTimeout(() => {
      fallbackFinalTimerRef.current = null;

      if (pendingFinalRef.current || processingSessionRef.current != null)
        return;

      const candidate = (lastInterimRef.current || spokenText).trim();
      if (!candidate) return;

      const procSession = activeSessionRef.current ?? sessionIdRef.current;

      pendingFinalRef.current = true;
      processingSessionRef.current = procSession;
      cancelledRef.current = true; // ignore late events from this session
      activeSessionRef.current = null;
      sessionIdRef.current = (sessionIdRef.current || 0) + 1;

      setIsProcessingVoice(true);
      setRecognizing(false);
      setIsRecording(false);
      setSpokenText("");
      lastInterimRef.current = "";

      setMessages((m) => [...m, { role: "user", text: candidate }]);
      setPendingPick(null);

      (async () => {
        try {
          await processTextInput(candidate);
        } finally {
          pendingFinalRef.current = false;
          processingSessionRef.current = null;
          setIsProcessingVoice(false);
        }
      })();
    }, 1000);
  };

  // Cancel recording without processing/submit — used for X/cancel or when app backgrounds
  const cancelRecording = async () => {
    // mark as cancelled so any pending 'result' events are ignored
    cancelledRef.current = true;
    // bump session id to invalidate any in-flight events tied to this session
    sessionIdRef.current = (sessionIdRef.current || 0) + 1;
    // clear active session so result handler ignores future events
    activeSessionRef.current = null;
    // clear processing flags so background handlers won't process
    pendingFinalRef.current = false;
    processingSessionRef.current = null;
    clearFallbackTimer();
    lastInterimRef.current = "";
    // if a final result is pending (message already inserted but not processed), remove it
    if (pendingFinalRef.current) {
      try {
        setMessages((m) => m.slice(0, -1));
      } catch { }
      pendingFinalRef.current = false;
    }
    try {
      try {
        await ExpoSpeechRecognitionModule.stop();
        // Wait briefly for any in-flight result events to arrive and be ignored
        await new Promise((r) => setTimeout(r, 200));
      } catch { }
    } catch { }

    setIsRecording(false);
    setRecognizing(false);
    setIsProcessingVoice(false);
    setSpokenText("");

    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    recordStartRef.current = null;
  };

  // ref to the text input so we can focus when opened via deep-link
  const inputRef = useRef<TextInput | null>(null);

  // App Tour context for guided tour
  const { shouldShowTour, currentStep, nextStep, skipTour } = useAppTour();

  // read route params early so focus logic can decide whether to focus
  const params = useLocalSearchParams();

  const load = useCallback(async () => {
    await seedCategoryDefaults();
    // ⚡ PERFORMANCE: Use cached categories for faster loading
    const { getCachedCategories } = await import("@/services/cacheService");
    const rows = await getCachedCategories();
    setItems(rows);

    // Test backend connection on load (for debugging)
    InteractionManager.runAfterInteractions(() => {
      setTimeout(async () => {
        console.log("🔌 Testing backend API connection...");
        const connTest = await testBackendConnection();
        if (connTest.success) {
          console.log(`✅ Backend connected! Latency: ${connTest.latency}ms`);
        } else {
          console.warn(`⚠️ Backend unreachable: ${connTest.error}`);
        }
      }, 500);
    });

    // Background model training disabled — TF/PhoBERT removed to prevent ANR crash
    console.log("ℹ️ Background TF training disabled. Using backend LLM only.");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Build simple category priors from user's history - deferred to background
  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(async () => {
        try {
          const userId = await getCurrentUserId();
          const nowSec = Math.floor(Date.now() / 1000);
          const fromSec = nowSec - 90 * 86400;
          const rows = await db.getAllAsync<{
            category_id: string | null;
            type: string;
            cnt: number;
          }>(
            `SELECT category_id, type, COUNT(*) as cnt
             FROM transactions
             WHERE user_id=? AND occurred_at>=? AND occurred_at<=?
             GROUP BY category_id, type`,
            [Number(userId || 0), fromSec, nowSec] as any
          );
          const outP: Record<string, number> = {};
          const inP: Record<string, number> = {};
          let sumOut = 0,
            sumIn = 0;
          for (const r of rows) {
            const id = r.category_id || "__null__";
            if (r.type === "expense") {
              outP[id] = (outP[id] || 0) + (r.cnt || 0);
              sumOut += r.cnt || 0;
            } else {
              inP[id] = (inP[id] || 0) + (r.cnt || 0);
              sumIn += r.cnt || 0;
            }
          }
          const norm = (m: Record<string, number>, sum: number) => {
            const out: Record<string, number> = {};
            const denom = sum + 1e-6;
            Object.entries(m).forEach(([k, v]) => {
              out[k] = v / denom;
            });
            return out;
          };
          setPriors({ IN: norm(inP, sumIn), OUT: norm(outP, sumOut) });
        } catch (e) { }
      }, 1500);
    });
  }, []);

  // PhoBERT initializes lazily on first use (no need to block here)

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Ensure recording is stopped when leaving the screen
  useFocusEffect(
    useCallback(() => {
      return () => {
        try {
          if (isRecording) {
            // Fire-and-forget cancel to stop audio + recognition
            cancelRecording();
          }
        } catch (e) { }
      };
    }, [isRecording, params?.mode])
  );



  // Handle deep-link params from widget (mode=voice|image|text, text=...)
  useEffect(() => {
    const mode = (params?.mode as string | undefined) || null;
    const initial =
      (params?.text as string | undefined) ||
      (params?.initial as string | undefined) ||
      null;

    if (mode === "voice") {
      // start voice recording slightly delayed to allow navigation settle
      setTimeout(() => {
        startVoice().catch((e) =>
          console.warn("startVoice failed from widget", e)
        );
      }, 220);
    } else if (mode === "image") {
      // open image picker after a short delay
      setTimeout(() => {
        (async () => {
          try {
            await handleImagePress();
          } catch (e) {
            console.warn("handleImagePress failed from widget", e);
          }
        })();
      }, 220);
    } else if (mode === "text" && initial) {
      // prefill input and focus the TextInput so keyboard appears
      try {
        setInput(decodeURIComponent(String(initial)));
      } catch {
        setInput(String(initial));
      }

      // Try a few focus attempts to handle timing across devices/router
      const tryFocus = () => {
        try {
          inputRef.current?.focus();
        } catch (e) {
          /* ignore */
        }
      };

      // immediate attempt in next frame
      requestAnimationFrame(() => tryFocus());
      // small delayed attempt (allow Animated views to mount)
      const t1 = setTimeout(() => tryFocus(), 220);
      // fallback later attempt
      const t2 = setTimeout(() => tryFocus(), 700);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    // react to changes in params so focus runs when route receives new params
  }, [params?.mode, params?.text, params?.initial]);

  const scrollToEnd = () =>
    requestAnimationFrame(() =>
      flatRef.current?.scrollToEnd({ animated: true })
    );

  // Classify text to user categories using heuristics + category priors (no TF/ML)
  const classifyToUserCategoriesAI = useCallback(
    async (text: string, expectedIO?: "IN" | "OUT") => {
      const actualIO = expectedIO || "OUT";
      const ranked = [...items]
        .filter(
          (c) =>
            !expectedIO || (c.type === "income" ? "IN" : "OUT") === expectedIO
        )
        .map((c) => ({
          categoryId: c.id,
          name: c.name,
          score: (priors.IN[c.id] ?? priors.OUT[c.id] ?? 0) as number,
          io: c.type === "income" ? ("IN" as const) : ("OUT" as const),
        }))
        .sort((a, b) => b.score - a.score);

      // If priors are empty (new user), just return first few categories matching IO type
      if ((ranked[0]?.score || 0) <= 0) {
        const matchingCategories = items.filter(
          (c) =>
            !expectedIO || (c.type === "income" ? "IN" : "OUT") === expectedIO
        );
        return {
          io: actualIO,
          ranked: matchingCategories.slice(0, 6).map((c) => ({
            categoryId: c.id,
            name: c.name,
            score: 0.01,
          })),
        };
      }

      const topIo = ranked[0]?.io || "OUT";
      return {
        io: topIo,
        ranked: ranked.slice(0, 6).map(({ io: _io, ...rest }) => rest),
      };
    },
    [items, priors]
  );

  // ⬇️ Trong handleSend, đổi phần “tạo giao dịch” để fallback sang pendingPick khi chưa chắc danh mục:
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;

    setIsSending(true); // show spinner + block
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setPendingPick(null);
    scrollToEnd();

    // Advance to step 4 when user sends message on step 3
    if (shouldShowTour && currentStep === 3) {
      nextStep();
    }

    try {
      // Use the unified AI parser (same as voice input) - supports action types
      await processTextInput(text);
    } finally {
      // Ensure we always clear sending state
      setIsSending(false);
    }
  };

  // ----- Gợi ý khi chưa đủ tự tin -----
  const [pendingPick, setPendingPick] = useState<{
    text: string;
    amount: number | null;
    io: "IN" | "OUT";
    choices: { categoryId: string; name: string; score: number }[];
    date?: Date;
  } | null>(null);
  // Animation for suggestion appearance
  const suggestAnim = useRef(new Animated.Value(pendingPick ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(suggestAnim, {
      toValue: pendingPick ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [pendingPick, suggestAnim]);
  const pendingLogId = useRef<string | null>(null);

  // Edit transaction state
  const [editingTx, setEditingTx] = useState<{
    transactionId: string;
    accountId: string;
    categoryId: string;
    io: "IN" | "OUT";
    amount: number;
    note: string;
    when: Date;
  } | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const spinValue = useRef(new Animated.Value(0)).current;

  // Animate the spinning icon when saving
  useEffect(() => {
    if (isSaving) {
      spinValue.setValue(0);
      Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      spinValue.stopAnimation();
      spinValue.setValue(0);
    }
  }, [isSaving, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const chooseCategory = async (c: { categoryId: string; name: string }) => {
    if (!pendingPick) return;
    try {
      const txn = await createTransaction({
        amount: pendingPick.amount,
        io: pendingPick.io,
        categoryId: c.categoryId,
        note: pendingPick.text,
        date: (pendingPick as any).date, // Pass date if available
      });

      const transactionDate = (pendingPick as any).date || new Date();
      const when = transactionDate.toLocaleDateString();
      const selectedCategory = items.find((cat) => cat.id === c.categoryId);
      setMessages((m) => [
        ...m,
        {
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io: pendingPick.io,
          categoryId: c.categoryId,
          categoryName: c.name,
          categoryIcon: selectedCategory?.icon || "wallet",
          categoryColor: selectedCategory?.color || "#6366F1",
          note: pendingPick.text,
          when,
        },
      ]);

      // Learning pipeline disabled — TF/logPrediction removed to prevent ANR crash

      setPendingPick(null);
      scrollToEnd();
    } catch (e: any) {
      // Show informative message to user instead of uncaught rejection
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text:
            "Không thể tạo giao dịch: " +
            (e?.message || "Vui lòng kiểm tra dữ liệu."),
        },
      ]);
      setPendingPick(null);
      scrollToEnd();
    }
  };

  // ----- Image Receipt Handler -----
  const handleImagePress = async () => {
    try {
      // Ask user to choose between camera or gallery
      const choice = await new Promise<"camera" | "gallery" | null>(
        (resolve) => {
          Alert.alert(
            "Chọn nguồn ảnh",
            "Bạn muốn chụp ảnh mới hay chọn từ thư viện?",
            [
              { text: "Chụp ảnh", onPress: () => resolve("camera") },
              { text: "Chọn từ thư viện", onPress: () => resolve("gallery") },
              { text: "Hủy", style: "cancel", onPress: () => resolve(null) },
            ]
          );
        }
      );

      if (!choice) return;

      let permissionStatus;
      let pickerResult;

      if (choice === "camera") {
        // Request camera permissions
        const cameraPermission =
          await ImagePicker.requestCameraPermissionsAsync();
        if (cameraPermission.status !== "granted") {
          Alert.alert(
            "Quyền truy cập",
            "Cần quyền truy cập camera để chụp ảnh"
          );
          return;
        }

        pickerResult = await ImagePicker.launchCameraAsync({
          mediaTypes: "images" as any,
          allowsEditing: true,
          quality: 0.6,
        });
      } else {
        // Request media library permissions
        const mediaPermission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (mediaPermission.status !== "granted") {
          Alert.alert("Quyền truy cập", "Cần quyền truy cập thư viện ảnh");
          return;
        }

        pickerResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: "images" as any,
          allowsEditing: true,
          quality: 0.6,
        });
      }

      if (pickerResult.canceled) return;
      const imageUri = pickerResult.assets[0].uri;

      // Check image size before processing
      const imageInfo = await FileSystem.getInfoAsync(imageUri).catch(
        () => null
      );
      if (imageInfo?.exists && imageInfo.size && imageInfo.size > 1024 * 1024) {
        Alert.alert(
          "Ảnh quá lớn",
          `Ảnh có kích thước ${(imageInfo.size / 1024 / 1024).toFixed(
            2
          )}MB. OCR.space chỉ hỗ trợ tối đa 1MB. Ảnh sẽ được tự động nén.`,
          [{ text: "Tiếp tục" }]
        );
      }

      // Show image and processing message
      setMessages((m) => [
        ...m,
        { role: "user", text: "", imageUri: imageUri },
        {
          role: "bot",
          text: "🤖 Đang quét hóa đơn...",
        },
      ]);

      // OCR with Tesseract - Auto extract and create transaction
      const ocrResult = await processReceiptImage(imageUri);

      if (!ocrResult.amount || ocrResult.amount <= 0) {
        // OCR failed - show error message
        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "bot",
            text: `❌ Không đọc được số tiền từ hóa đơn.\n\n${ocrResult.text ? `📄 Text nhận được:\n${ocrResult.text}\n\n` : ""
              }Vui lòng thử ảnh khác có kích thước nhỏ hơn 1MB và độ phân giải cao hơn.`,
          },
        ]);
        scrollToEnd();
        return;
      }

      // OCR successful - Auto create transaction
      const amount = ocrResult.amount;
      const merchantName = ocrResult.merchantName;
      const note = `${merchantName}`;

      // Refresh categories to ensure we have the latest list (avoid stale closure)
      const currentCategories = await listCategories();

      let finalCategoryId: string | undefined;

      // Helper: Normalize strings (lowercase + NFC + remove accents for robust matching)
      const robustNormalize = (s: string) => {
        return s.trim().toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d").replace(/Đ/g, "D");
      };

      const aiCategoryRaw = ocrResult.category || "";
      const aiCategoryNorm = robustNormalize(aiCategoryRaw);

      if (aiCategoryRaw) {
        console.log(`🔍 Matching AI Category: "${aiCategoryRaw}" (Norm: "${aiCategoryNorm}")`);

        // 1. Exact Match (Accent-Insensitive)
        let matchedCategory = currentCategories.find(c => robustNormalize(c.name) === aiCategoryNorm);

        // 2. Fuzzy Match (Contains)
        if (!matchedCategory) {
          matchedCategory = currentCategories.find(c => {
            const cName = robustNormalize(c.name);
            return cName.includes(aiCategoryNorm) || aiCategoryNorm.includes(cName);
          });
        }

        if (matchedCategory) {
          console.log(`✅ Direct Category Match: "${matchedCategory.name}" (ID: ${matchedCategory.id})`);
          finalCategoryId = matchedCategory.id;
        } else {
          console.log(`⚠️ No match found in user categories: ${currentCategories.map(c => c.name).join(", ")}`);
        }
      }

      // NEW: Heuristic Mapping for "Hoá đơn" / Utilities
      if (!finalCategoryId) {
        const merchantNorm = robustNormalize(merchantName || "");

        // 1. Utilities (Electricity, Water, Internet) -> Nhà ở
        if (
          merchantNorm.includes("dien") || merchantNorm.includes("evn") ||
          merchantNorm.includes("nuoc") || merchantNorm.includes("internet") ||
          merchantNorm.includes("vnpt") || merchantNorm.includes("fpt") ||
          merchantNorm.includes("viettel")
        ) {
          const housingCat = currentCategories.find(c => {
            const name = robustNormalize(c.name);
            return name === "nha o" || name === "house" || name === "living" || name === "bill";
          });

          if (housingCat) {
            console.log(`💡 Heuristic Helper: Map "${merchantName}" -> "${housingCat.name}" (Utilities)`);
            finalCategoryId = housingCat.id;
          }
        }
      }

      if (!finalCategoryId) {
        // 3. Fallback: Local AI Model
        console.log("⚠️ Using Local AI Classification as fallback.");
        let classificationInput = merchantName || "";
        if (ocrResult.category && ocrResult.category !== "Chưa xác định") {
          classificationInput = `${ocrResult.category} ${classificationInput}`;
        }

        console.log(`🧠 Local AI Input: "${classificationInput}"`);
        const { ranked } = await classifyToUserCategoriesAI(classificationInput);
        finalCategoryId = ranked[0]?.categoryId;
      }


      if (!finalCategoryId) {
        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "bot",
            text: "❌ Không tìm thấy danh mục. Vui lòng tạo danh mục Chi tiêu trước.",
          },
        ]);
        return;
      }

      // Create transaction automatically
      const txn = await createTransaction({
        amount,
        io: "OUT",
        categoryId: finalCategoryId,
        note,
      });

      const when = new Date().toLocaleDateString();
      const selectedCategory = items.find((c) => c.id === finalCategoryId);

      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: (ocrResult as any).message
            ? (ocrResult as any).message
            : "Đã lưu hoá đơn thành công! Bạn có thể nhấn vào thẻ bên trên để chỉnh sửa nếu cần nhé.",
        },
        {
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io: "OUT",
          categoryId: finalCategoryId,
          categoryName: selectedCategory?.name || "Chưa xác định",
          categoryIcon: selectedCategory?.icon || "cart",
          categoryColor: selectedCategory?.color || "#6366F1",
          note,
          when,
        },
      ]);
      scrollToEnd();
    } catch (error) {
      console.error("Image selection error:", error);
      Alert.alert("Lỗi", "Không thể chọn ảnh");
    }
  };

  // ----- Process text input (shared by voice, image, and text) -----
  const processingTextRef = useRef(false);
  const processTextInput = useCallback(
    async (text: string) => {
      const userText = text.trim();
      if (!userText) return;

      // Prevent concurrent processing (avoid duplicate responses)
      if (processingTextRef.current) return;
      processingTextRef.current = true;

      try {
        // Add typing indicator with cache status
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last && last.role === "typing") return m;
          return [...m, { role: "typing", cacheStatus: "checking" }];
        });
        scrollToEnd();

        const aiResult = await parseTransactionWithAI(userText, items);

        if (!aiResult) {
          let amountFromOriginal: number | null = parseAmountVN(userText);

          // Clean text for category prediction
          const parsed = parseTransactionText(userText);
          const cleanNote = parsed.note || userText;
          const amt = amountFromOriginal || parsed.amount;

          // Use ML to predict category
          const { io, ranked } = await classifyToUserCategoriesAI(cleanNote);

          if (!ranked || ranked.length === 0) {
            setMessages((m) => [
              ...m.slice(0, -1),
              { role: "bot", text: t("askAmount") },
            ]);
            return;
          }

          const topPred = ranked[0];
          await autoCreateTransaction(
            cleanNote,
            amt,
            io,
            topPred.categoryId,
            userText
          );
          return;
        }

        // Use AI parsed result

        if (aiResult.action === "VIEW_STATS") {
          // User wants to see statistics - direct them to Charts tab
          setMessages((m) => [
            ...m.slice(0, -1),
            {
              role: "bot",
              text: `📊 ${aiResult.message}\n\nĐể xem thống kê chi tiết, vui lòng vào tab "Biểu đồ" ở thanh điều hướng bên dưới. 📈`,
            },
          ]);
          scrollToEnd();
          return;
        }

        if (aiResult.action === "EDIT_TRANSACTION") {
          // User wants to edit transaction - show last transaction with edit option
          const lastCard = messages.findLast((m) => m.role === "card");
          if (lastCard && lastCard.role === "card") {
            setMessages((m) => [
              ...m.slice(0, -1),
              {
                role: "bot",
                text: `✏️ ${aiResult.message}\n\nBạn có thể nhấn nút "Sửa" ở giao dịch bên dưới để chỉnh sửa.`,
              },
            ]);
          } else {
            setMessages((m) => [
              ...m.slice(0, -1),
              {
                role: "bot",
                text: `❌ Không tìm thấy giao dịch nào để sửa.\n\nVui lòng tạo giao dịch mới hoặc xem danh sách giao dịch ở tab "Giao dịch".`,
              },
            ]);
          }
          scrollToEnd();
          return;
        }

        if (aiResult.action === "DELETE_TRANSACTION") {
          // User wants to delete transaction - show last transaction with delete option
          const lastCard = messages.findLast((m) => m.role === "card");
          if (lastCard && lastCard.role === "card") {
            setMessages((m) => [
              ...m.slice(0, -1),
              {
                role: "bot",
                text: `🗑️ ${aiResult.message}\n\nBạn có thể nhấn nút "Xóa" ở giao dịch bên dưới để xóa.`,
              },
            ]);
          } else {
            setMessages((m) => [
              ...m.slice(0, -1),
              {
                role: "bot",
                text: `❌ Không tìm thấy giao dịch nào để xóa.\n\nVui lòng xem danh sách giao dịch ở tab "Giao dịch".`,
              },
            ]);
          }
          scrollToEnd();
          return;
        }

        // Handle multi-transaction from backend API with PROGRESSIVE DISPLAY
        if (aiResult.action === "CREATE_MULTIPLE_TRANSACTIONS") {
          if (!aiResult.transactions || aiResult.transactions.length === 0) {
            setMessages((m) => [
              ...m.slice(0, -1),
              {
                role: "bot",
                text: `❌ Không thể phân tích các giao dịch từ: "${userText}"\n\nVui lòng thử lại với định dạng khác.`,
              },
            ]);
            scrollToEnd();
            return;
          }

          // Progressive transaction display with streaming UI
          try {
            // Get default account via cache service
            const { getCachedDefaultAccount } = await import("@/services/cacheService");
            const defaultAccount = await getCachedDefaultAccount();
            if (!defaultAccount) throw new Error("No default account found");

            const totalTransactions = aiResult.transactions.length;
            const createdTransactions: string[] = [];
            const cardMessages: any[] = [];

            // Show initial progress message
            setMessages((m) => [
              ...m.slice(0, -1),
              {
                role: "bot",
                text: `🔄 Đang xử lý ${totalTransactions} giao dịch...\n\n⏳ Vui lòng chờ trong giây lát.`,
              },
            ]);

            // Process transactions - collect cards, update progress incrementally
            for (let index = 0; index < aiResult.transactions.length; index++) {
              const tx = aiResult.transactions[index];

              // Create transaction
              const txn = await addExpense({
                accountId: defaultAccount.id,
                amount: tx.amount,
                categoryId: tx.categoryId,
                note: tx.note,
                when: tx.date || new Date(),
                updatedAt: new Date(),
              } as any);
              createdTransactions.push(txn);

              // Get category info for display
              const txCategory = items.find((c) => c.id === tx.categoryId);
              const when = (tx.date || new Date()).toLocaleDateString("vi-VN");

              const cardMessage = {
                role: "card" as const,
                transactionId: txn,
                accountId: defaultAccount.id,
                amount: tx.amount,
                io: tx.io || "OUT",
                categoryId: tx.categoryId,
                categoryName: tx.categoryName || txCategory?.name || "",
                categoryIcon: txCategory?.icon || "wallet",
                categoryColor: txCategory?.color || "#6366F1",
                note: tx.note,
                when,
                date: tx.date,
              };

              // Collect card message - will be added ONCE at the end
              cardMessages.push(cardMessage);

              // Update progress message with current count (progressive feedback)
              const processedCount = index + 1;
              if (processedCount < totalTransactions) {
                setMessages((m) =>
                  m.map((msg) =>
                    msg.role === "bot" && msg.text?.includes("Đang xử lý")
                      ? { ...msg, text: `🔄 Đang xử lý ${processedCount}/${totalTransactions} giao dịch...\n\n⏳ Vui lòng chờ trong giây lát.` }
                      : msg
                  )
                );
              }

              // logPrediction disabled — TF learning pipeline removed
            }

            // Validate: ensure card count matches backend transactions exactly
            const expectedCount = aiResult.transactions.length;
            const actualCardCount = cardMessages.length;
            if (actualCardCount !== expectedCount) {
              console.warn(`⚠️ Card count mismatch: expected ${expectedCount}, got ${actualCardCount}`);
            }

            // Final update: remove progress, show success + all cards ONCE
            const latencyInfo = aiResult.cacheLatency
              ? `\n⏱️ Thời gian: ${aiResult.cacheLatency}ms`
              : "";

            setMessages((m) => {
              // Keep user's message, remove progress and typing indicator
              const cleanMessages = m.filter(
                (msg) =>
                  !(msg.role === "bot" && (msg.text?.includes("Đang xử lý") || msg.text === "..."))
              );

              return [
                ...cleanMessages, // Keep user's message
                {
                  // Use conversational message from backend instead of hardcoded text
                  role: "bot",
                  text: `✅ ${aiResult.message || "Tự động tạo giao dịch thành công!"}\n\n💰 Tổng: ${aiResult.amount?.toLocaleString("vi-VN")}đ${latencyInfo}`,
                },
                ...cardMessages, // Add ALL cards ONCE - exactly matching backend count
              ];
            });

            // Learning pipeline disabled — transactionClassifier removed

            scrollToEnd();
          } catch (error: any) {
            console.error("❌ Error creating multiple transactions:", error);
            setMessages((m) => [
              ...m.slice(0, -1),
              {
                role: "bot",
                text: `❌ Lỗi khi tạo giao dịch: ${error.message}\n\nVui lòng thử lại.`,
              },
            ]);
            scrollToEnd();
          }

          processingTextRef.current = false;
          return;
        }

        // Default: CREATE_TRANSACTION
        // Define minimum confidence for auto-creation (safety threshold)
        const MIN_AUTO_CREATE_CONFIDENCE = 0.6; // 60% - balance between automation and accuracy
        const rawConfidence = aiResult.confidence ?? 0;
        const confidenceValue = rawConfidence * (rawConfidence <= 1 ? 1 : 0.01); // Normalize to 0-1
        const mlFailed = (aiResult as any).mlFailed || false;

        // CASE 1: ML prediction completely failed - always show suggestions
        if (mlFailed) {
          console.log("🔍 ML failed - showing category suggestions");
          const { io, ranked } = await classifyToUserCategoriesAI(
            aiResult.note
          );
          setMessages((m) => [
            ...m.slice(0, -1),
            {
              role: "bot",
              text: `⚠️ Không thể xác định danh mục chính xác. Bạn muốn phân loại vào:`,
            },
          ]);
          setPendingPick({
            text: aiResult.note,
            amount: aiResult.amount,
            io: aiResult.io,
            choices: ranked?.slice(0, 3) || [],
            date: aiResult.date,
          });
          return;
        }

        // CASE 2: High confidence (>= 60%) - auto-create transaction
        if (confidenceValue >= MIN_AUTO_CREATE_CONFIDENCE) {
          console.log(
            `✅ High confidence (${(confidenceValue * 100).toFixed(
              1
            )}%) - auto-creating transaction`
          );
          let matchedCategory = aiResult.categoryId
            ? items.find((c) => c.id === aiResult.categoryId)
            : null;

          // Fallback to name matching if categoryId not found
          if (!matchedCategory) {
            matchedCategory = items.find(
              (c) =>
                c.name
                  .toLowerCase()
                  .includes(aiResult.categoryName.toLowerCase()) ||
                aiResult.categoryName
                  .toLowerCase()
                  .includes(c.name.toLowerCase())
            );
          }

          if (matchedCategory) {
            await autoCreateTransactionDirect(aiResult as any, matchedCategory.id);
            return;
          }
        }

        // CASE 3: Low confidence (< 60%) - show suggestions for user to confirm
        console.log(
          `⚠️ Low confidence (${(confidenceValue * 100).toFixed(
            1
          )}%) - showing suggestions`
        );
        const { io, ranked } = await classifyToUserCategoriesAI(
          aiResult.note,
          aiResult.io
        );

        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "bot",
            text: `⚠️ Độ tin cậy thấp (${(confidenceValue * 100).toFixed(
              0
            )}%). Bạn muốn phân loại vào:`,
          },
        ]);

        setPendingPick({
          text: aiResult.note,
          amount: aiResult.amount,
          io: aiResult.io,
          choices: ranked?.slice(0, 3) || [],
          date: aiResult.date,
        });
      } finally {
        processingTextRef.current = false;
      }
    },
    [items, classifyToUserCategoriesAI, messages]
  );

  // ----- Auto create transaction (NEW - from AI parsed result) -----
  const autoCreateTransactionDirect = async (
    aiResult: {
      action:
      | "CREATE_TRANSACTION"
      | "VIEW_STATS"
      | "EDIT_TRANSACTION"
      | "DELETE_TRANSACTION";
      amount: number | null;
      note: string;
      categoryName: string;
      io: "IN" | "OUT";
      date: Date;
      message: string;
    },
    categoryId: string
  ) => {
    try {
      const selectedCategory = items.find((c) => c.id === categoryId);

      // Create transaction with AI parsed data
      const txn = await createTransaction({
        amount: aiResult.amount,
        io: aiResult.io,
        categoryId,
        note: aiResult.note,
        date: aiResult.date,
      });

      // Learning pipeline disabled

      const when = aiResult.date.toLocaleDateString("vi-VN");
      // cacheLatency removed — not in return type
      const latencyInfo = "";

      // Remove typing indicator and add bot response + transaction card
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: aiResult.message + latencyInfo,
        },
        {
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io: aiResult.io,
          categoryId,
          categoryName: selectedCategory?.name || aiResult.categoryName,
          categoryIcon: selectedCategory?.icon || "wallet",
          categoryColor: selectedCategory?.color || "#6366F1",
          note: aiResult.note,
          when,
          date: aiResult.date,
        },
      ]);
      scrollToEnd();

      // Complete tour if on step 4 (transaction created successfully)
      if (shouldShowTour && currentStep === 4) {
        setTimeout(() => {
          Alert.alert(
            "🎉 Hoàn thành hướng dẫn!",
            "Bạn đã hoàn thành tất cả các bước hướng dẫn cơ bản. Giờ bạn có thể tự do khám phá ứng dụng!",
            [
              {
                text: "OK",
                onPress: () => skipTour(),
              },
            ]
          );
        }, 1000);
      }
    } catch (e: any) {
      console.warn("❌ Transaction creation failed:", e);
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: "Tạo giao dịch thất bại. " + (e?.message || ""),
        },
      ]);
    }
  };

  // ----- Auto create transaction (OLD - legacy fallback) -----
  const autoCreateTransaction = async (
    text: string,
    amount: number | null,
    io: "IN" | "OUT",
    categoryId: string,
    originalText?: string // Original text with date for parsing
  ) => {
    try {
      // Get AI response with date extraction
      const selectedCategory = items.find((c) => c.id === categoryId);
      const categoryName = selectedCategory?.name || "Unknown";

      // Prefer using the original user text for both the AI reply and stored note
      // so the bot response and saved transaction match what the user typed.
      const originalNote = originalText || text;
      // Parse date from original text for accurate date extraction
      const extractedDate: Date = parseDateFromAI("", originalNote);
      const isToday = extractedDate.toDateString() === new Date().toDateString();
      const isFuture = extractedDate > new Date();
      const isPast = !isToday && extractedDate < new Date();

      const verb = isFuture ? "Lên lịch" : "Đã ghi";
      const dateStr = isToday
        ? " hôm nay"
        : isFuture
          ? ` ngày ${extractedDate.toLocaleDateString("vi-VN")}`
          : ` ngày ${extractedDate.toLocaleDateString("vi-VN")}`;
      const amtStr = amount ? amount.toLocaleString("vi-VN") + "đ " : "";
      const botMsg =
        io === "OUT"
          ? `${verb} chi ${amtStr}${originalNote}${dateStr}. ${isFuture ? "📅" : "✅"}`
          : `${verb} thu ${amtStr}${originalNote}${dateStr}. ${isFuture ? "📅" : "✅"}`;

      // Create transaction with extracted date
      const txn = await createTransaction({
        amount,
        io,
        categoryId,
        note: originalNote,
        date: extractedDate,
      });

      const when = extractedDate.toLocaleDateString("vi-VN");

      // Remove typing indicator and add bot response + transaction card
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: botMsg,
        },
        {
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io,
          categoryId,
          categoryName,
          categoryIcon: selectedCategory?.icon || "wallet",
          categoryColor: selectedCategory?.color || "#6366F1",
          note: originalNote,
          when,
          date: extractedDate,
        },
      ]);
      scrollToEnd();

      // Complete tour if on step 4 (transaction created successfully)
      if (shouldShowTour && currentStep === 4) {
        setTimeout(() => {
          Alert.alert(
            "🎉 Hoàn thành hướng dẫn!",
            "Bạn đã hoàn thành tất cả các bước hướng dẫn cơ bản. Giờ bạn có thể tự do khám phá ứng dụng!",
            [
              {
                text: "OK",
                onPress: () => skipTour(),
              },
            ]
          );
        }, 1000);
      }
    } catch (e: any) {
      console.warn("❌ Transaction creation failed:", e);
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: "Tạo giao dịch thất bại. " + (e?.message || ""),
        },
      ]);
    }
  }; // Edit transaction handlers
  const handleEditTransaction = useCallback((item: any) => {
    // Ensure io is properly set from the card data
    const txType = item.io || "OUT"; // default to OUT if not set
    setEditingTx({
      transactionId: item.transactionId,
      accountId: item.accountId,
      categoryId: item.categoryId,
      io: txType,
      amount: item.amount || 0,
      note: item.note,
      when: new Date(),
    });
    // Format amount with thousand separators
    const formattedAmount = (item.amount || 0).toLocaleString("vi-VN");
    setEditAmount(formattedAmount);
    setEditNote(item.note);
    setEditCategoryId(item.categoryId);
  }, []);

  const handleSaveEdit = async () => {
    if (!editingTx) return;
    // Parse formatted amount (remove commas)
    const newAmount = parseFloat(editAmount.replace(/[^0-9]/g, ""));
    if (!newAmount || newAmount <= 0) {
      alert("Số tiền không hợp lệ");
      return;
    }

    if (!editCategoryId) {
      alert("Vui lòng chọn danh mục");
      return;
    }

    setIsSaving(true);
    try {
      // Check if category changed (user corrected AI prediction)
      const oldCategoryId = editingTx.categoryId;
      const categoryChanged = oldCategoryId !== editCategoryId;

      await updateTransaction({
        id: editingTx.transactionId,
        accountId: editingTx.accountId,
        categoryId: editCategoryId,
        type: editingTx.io === "OUT" ? "expense" : "income",
        amount: newAmount,
        note: editNote,
        when: editingTx.when,
      });

      // Correction learning disabled — TF/transactionClassifier removed to prevent ANR crash

      // Update message in chat - bao gồm cả io type, icon và color
      const updatedCategory = items.find((c) => c.id === editCategoryId);
      setMessages((msgs) =>
        msgs.map((m) =>
          m.role === "card" && m.transactionId === editingTx.transactionId
            ? {
              ...m,
              amount: newAmount,
              note: editNote,
              categoryId: editCategoryId,
              io: editingTx.io, // Update io type
              categoryName: updatedCategory?.name || m.categoryName,
              categoryIcon: updatedCategory?.icon || m.categoryIcon, // Update icon
              categoryColor: updatedCategory?.color || m.categoryColor, // Update color
            }
            : m
        )
      );

      setEditingTx(null);
      // Reset edit states
      setEditAmount("");
      setEditNote("");
      setEditCategoryId("");
    } catch (e: any) {
      alert("Không thể cập nhật: " + (e?.message || "Lỗi"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTransaction = useCallback(async (transactionId: string) => {
    try {
      await deleteTx(transactionId);
      // Remove card and its associated bot message from messages
      setMessages((msgs) => {
        const cardIndex = msgs.findIndex(
          (m) => m.role === "card" && m.transactionId === transactionId
        );

        if (cardIndex === -1) return msgs;

        // Check if there's a bot message right before the card
        const hasBotMessageBefore =
          cardIndex > 0 && msgs[cardIndex - 1].role === "bot";

        return msgs.filter((m, index) => {
          // Remove the card
          if (m.role === "card" && m.transactionId === transactionId) {
            return false;
          }
          // Remove bot message before card if exists
          if (hasBotMessageBefore && index === cardIndex - 1) {
            return false;
          }
          return true;
        });
      });
    } catch (e: any) {
      alert("Không thể xóa: " + (e?.message || "Lỗi"));
    }
  }, []);

  const handleConfirmDelete = useCallback(
    (id: string) => {
      Alert.alert(t("confirmDelete"), t("confirmDeleteMsg"), [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: () => handleDeleteTransaction(id),
        },
      ]);
    },
    [t, handleDeleteTransaction]
  );

  const handleViewImage = useCallback((uri: string) => {
    setSelectedImage(uri);
    setImageViewerVisible(true);
  }, []);

  function VoiceWaveformLite({
    isRecording,
    color = "#3B82F6",
  }: {
    isRecording: boolean;
    color?: string;
  }) {
    // Fix #3: Reduced from 28 → 12 bars. Use scaleY + useNativeDriver:true (native thread, not JS thread)
    const NUM_BARS = 12;
    const anim = useRef(new Animated.Value(0)).current;
    // Pre-computed peaks so no re-computation on re-render
    const peaks = useRef(
      Array.from({ length: NUM_BARS }, () => 0.5 + Math.random() * 0.8)
    ).current;

    useEffect(() => {
      if (!isRecording) {
        anim.stopAnimation();
        anim.setValue(0);
        return;
      }

      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true, // Fix #3: Native thread — no JS involvement
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true, // Fix #3: Native thread
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }, [anim, isRecording]);

    if (!isRecording && !spokenText) return null;

    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          height: 44,
        }}
      >
        <View
          style={{
            width: "100%",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            height: 44,
            paddingHorizontal: 4,
            borderRadius: 14,
            backgroundColor: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          {Array.from({ length: NUM_BARS }).map((_, i) => {
            const symmetry = Math.sin((Math.PI * i) / (NUM_BARS - 1));
            const base = 0.3 + 0.7 * symmetry;
            const maxScale = 0.2 + base * peaks[i] * 0.8;

            // Fix #3: Use scaleY transform (works with useNativeDriver: true)
            const scaleY = anim.interpolate({
              inputRange: [0, 0.4, 0.6, 1],
              outputRange: [0.15, maxScale * 0.9, maxScale, 0.15],
            });

            return (
              <Animated.View
                key={i}
                style={{
                  flex: 1,
                  height: 30, // Fixed height — scale changes via transform
                  borderRadius: 3,
                  backgroundColor: color,
                  opacity: 0.5 + 0.5 * base,
                  transform: [{ scaleY }],
                }}
              />
            );
          })}
        </View>
      </View>
    );
  }


  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const inputAnim = useRef(new Animated.Value(0)).current;

  const estimatedKeyboardHeight = Math.round(
    Dimensions.get("window").height * 0.38
  );

  useEffect(() => {
    Animated.timing(inputAnim, {
      toValue: isRecording ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isRecording, inputAnim]);

  // Keyboard listeners to lift input bar on Android and adjust padding
  useEffect(() => {
    const onShow = (e: any) => {
      let h =
        e?.endCoordinates?.height ||
        e?.end?.height ||
        e?.startCoordinates?.height ||
        0;

      if (!h || h <= 0) {
        h = Math.round(Dimensions.get("window").height * 0.38);
      }

      setKeyboardHeight(h);

      // Fix #7: Track timer IDs so we can cancel them on unmount
      const t1 = setTimeout(() => { flatRef.current?.scrollToEnd({ animated: true }); }, 100);
      const t2 = setTimeout(() => { flatRef.current?.scrollToEnd({ animated: true }); }, 300);
      // Store refs so cleanup can cancel pending scrolls
      (onShow as any)._timers = [(onShow as any)._timers || [], t1, t2].flat();
    };

    const onHide = () => {
      setKeyboardHeight(0);
      const t3 = setTimeout(() => { flatRef.current?.scrollToEnd({ animated: true }); }, 100);
      (onHide as any)._timers = [(onHide as any)._timers || [], t3].flat();
    };

    const subShow = Keyboard.addListener("keyboardDidShow", onShow);
    const subHide = Keyboard.addListener("keyboardDidHide", onHide);

    return () => {
      // Fix #7: Clear pending scroll timers to prevent setState after unmount
      ((onShow as any)._timers || []).forEach((id: ReturnType<typeof setTimeout>) => clearTimeout(id));
      ((onHide as any)._timers || []).forEach((id: ReturnType<typeof setTimeout>) => clearTimeout(id));
      try { subShow.remove(); } catch (e) { }
      try { subHide.remove(); } catch (e) { }
    };
  }, [insets.bottom]);

  // Prevent duplicate submits when user taps ✓ multiple times quickly
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Cancel recording if app goes to background or becomes inactive
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (isRecording) cancelRecording();
      }
    });
    return () => subscription.remove();
  }, [isRecording]);

  // Animate scroll button based on isAtBottom state (button visibility is handled by conditional rendering)
  useEffect(() => {
    Animated.timing(scrollButtonAnim, {
      toValue: isAtBottom ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isAtBottom, scrollButtonAnim]);

  const handleSubmitVoice = async () => {
    // If we're already processing a submit, ignore
    if (submittingRef.current) return;

    // Immediately mark as submitting so UI (both X and ✓) disables right away
    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      // If a final result is already pending or being processed by the speech handler,
      // don't duplicate — stop recording and let the existing handler finish. Keep buttons disabled.
      if (pendingFinalRef.current || processingSessionRef.current != null) {
        try {
          await stopVoice({ skipFallback: true });
        } catch { }
        return;
      }

      const text = spokenText.trim();
      if (!text) {
        await stopVoice({ skipFallback: true });
        return;
      }

      // Prevent the speech recognition event handler or fallback timer from
      // also inserting/processing a final result that would duplicate this send.
      clearFallbackTimer();
      pendingFinalRef.current = true;
      processingSessionRef.current = sessionIdRef.current;
      cancelledRef.current = true;
      activeSessionRef.current = null;
      sessionIdRef.current = (sessionIdRef.current || 0) + 1;
      lastInterimRef.current = "";

      // Stop recording and wait for any pending result to be processed
      await stopVoice({ skipFallback: true });

      // Push into chat like sending text normally
      setMessages((m) => [...m, { role: "user", text }]);
      setSpokenText("");

      await processTextInput(text);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      // Clear the temporary cancel guard so future sessions work normally
      cancelledRef.current = false;
      pendingFinalRef.current = false;
      processingSessionRef.current = null;
    }
  };

  // Fix #5: renderItem defined OUTSIDE JSX so it's properly memoized
  // (useCallback inside JSX prop is not memoized properly)
  const renderChatItem = useCallback(
    ({ item }: { item: any }) => (
      <ChatMessageItem
        item={item}
        colors={colors}
        mode={mode}
        t={t}
        onEdit={handleEditTransaction}
        onDelete={handleConfirmDelete}
        onImagePress={handleViewImage}
      />
    ),
    [colors, mode, t, handleEditTransaction, handleConfirmDelete, handleViewImage]
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <BackBar />

        {/* Chat */}
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(item, i) =>
            // Fix #4: Stable key — prefer transaction/role+index to avoid full re-render on insert
            (item as any).transactionId
              ? `card-${(item as any).transactionId}`
              : `${(item as any).role || "msg"}-${i}`
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Fix #1: Plain scroll handler — NO new Animated.Value() inside → prevents OOM crash
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
            const isCloseToBottom = distanceFromBottom <= 50;
            setIsAtBottom(isCloseToBottom);
            if (!isCloseToBottom && !isScrollingToBottom) {
              setForceHideButton(false);
            }
            if (isCloseToBottom) {
              setIsScrollingToBottom(false);
            }
          }}
          scrollEventThrottle={32}
          contentContainerStyle={{
            padding: 16,
            gap: 12,
            flexGrow: 1,
          }}
          onContentSizeChange={() => {
            requestAnimationFrame(() => {
              flatRef.current?.scrollToEnd({ animated: true });
            });
          }}
          onLayout={() => {
            requestAnimationFrame(() => {
              flatRef.current?.scrollToEnd({ animated: false });
            });
          }}
          // Fix #5: renderItem defined outside JSX (see renderChatItem above return)
          renderItem={renderChatItem}
        />

        {/* Gợi ý khi chưa đủ tự tin: render above the input bar so it's not covered */}
        {
          <Animated.View
            pointerEvents={pendingPick ? "auto" : "none"}
            style={
              [
                styles.suggestBar,
                {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: (insets.bottom || 0) + keyboardHeight + 70,
                  zIndex: 60,
                  // full-width + no outer background/border/shadow
                  backgroundColor: "transparent",
                  borderRadius: 0,
                  paddingVertical: 6,
                  paddingHorizontal: 0,
                  borderWidth: 0,
                  borderColor: "transparent",
                  elevation: 0,
                  // animated opacity + translate
                  opacity: suggestAnim,
                  transform: [
                    {
                      translateY: suggestAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [8, 0],
                      }),
                    },
                  ],
                  shadowColor: "transparent",
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0,
                  shadowRadius: 0,
                },
              ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                alignItems: "center",
                paddingLeft: insets.left || 4,
              }
              }
            >
              {
                pendingPick?.choices.map((c, index) => (
                  <Pressable
                    key={c.categoryId}
                    onPress={() => chooseCategory(c)}
                    style={
                      [
                        styles.chip,
                        {
                          borderColor: colors.divider,
                          backgroundColor:
                            index === 0 && c.score > 0.5 ? "#16A34A" : colors.card,
                          borderWidth: index === 0 && c.score > 0.5 ? 0 : 1,
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          marginRight: 8,
                          flexDirection: "row",
                          alignItems: "center",
                        },
                      ]}
                  >
                    {index === 0 && c.score > 0.5 && (
                      <MaterialCommunityIcons
                        name="robot"
                        size={14}
                        color="#fff"
                        style={{ marginRight: 8 }}
                      />
                    )}
                    <Text
                      style={
                        [
                          styles.chipText,
                          {
                            color:
                              index === 0 && c.score > 0.5 ? "#fff" : colors.text,
                          },
                        ]
                      }
                    >
                      {c.name}
                    </Text>
                    < View
                      style={{
                        marginLeft: 8,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 8,
                        backgroundColor:
                          index === 0 && c.score > 0.5
                            ? "rgba(255,255,255,0.12)"
                            : "transparent",
                      }}
                    >
                      <Text
                        style={
                          {
                            color:
                              index === 0 && c.score > 0.5
                                ? "#fff"
                                : colors.subText,
                            fontSize: 12,
                          }
                        }
                      >
                        {(c as any).isFromML
                          ? `🎓 ${Math.round(
                            ((c as any).mlConfidence || c.score) * 100
                          )}%`
                          : `${Math.round(c.score * 100)}%`}
                      </Text>
                    </View>
                  </Pressable>
                ))}
            </ScrollView>
          </Animated.View>
        }

        {/* Edit Modal */}
        <Modal
          visible={!!editingTx}
          transparent
          animationType="slide"
          onRequestClose={() => setEditingTx(null)}
        >
          <View
            style={
              {
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.5)",
                justifyContent: "flex-end",
              }
            }
          >
            <SafeAreaView
              style={
                {
                  backgroundColor: colors.card,
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                  padding: 20,
                  maxHeight: "80%",
                }
              }
              edges={["bottom"]}
            >
              <View
                style={
                  {
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                  }
                }
              >
                <Text
                  style={
                    {
                      fontSize: 18,
                      fontWeight: "700",
                      color: colors.text,
                    }
                  }
                >
                  {t("editTransaction")}
                </Text>
                < TouchableOpacity onPress={() => setEditingTx(null)}>
                  <Ionicons name="close" size={24} color={colors.icon} />
                </TouchableOpacity>
              </View>

              <ScrollView>
                {/* Transaction Type Toggle */}
                <View style={{ marginBottom: 16 }}>
                  <Text
                    style={
                      {
                        fontSize: 14,
                        fontWeight: "600",
                        marginBottom: 8,
                        color: colors.text,
                      }
                    }
                  >
                    Loại giao dịch
                  </Text>
                  < View style={{ flexDirection: "row", gap: 12 }}>
                    <TouchableOpacity
                      onPress={
                        () => {
                          if (editingTx) {
                            setEditingTx({ ...editingTx, io: "OUT" });
                            // Reset category khi đổi loại
                            setEditCategoryId("");
                          }
                        }
                      }
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        paddingVertical: 12,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor:
                          editingTx?.io === "OUT" ? "#EF4444" : colors.divider,
                        backgroundColor:
                          editingTx?.io === "OUT"
                            ? mode === "dark"
                              ? "#7F1D1D"
                              : "#FEE2E2"
                            : colors.background,
                      }}
                    >
                      <Ionicons
                        name="arrow-down-circle"
                        size={20}
                        color={
                          editingTx?.io === "OUT" ? "#EF4444" : colors.subText
                        }
                      />
                      < Text
                        style={{
                          fontSize: 15,
                          fontWeight: "700",
                          color:
                            editingTx?.io === "OUT"
                              ? "#EF4444"
                              : colors.subText,
                        }}
                      >
                        Chi phí
                      </Text>
                    </TouchableOpacity>

                    < TouchableOpacity
                      onPress={() => {
                        if (editingTx) {
                          setEditingTx({ ...editingTx, io: "IN" });
                          // Reset category khi đổi loại
                          setEditCategoryId("");
                        }
                      }}
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        paddingVertical: 12,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor:
                          editingTx?.io === "IN" ? "#10B981" : colors.divider,
                        backgroundColor:
                          editingTx?.io === "IN"
                            ? mode === "dark"
                              ? "#065F46"
                              : "#D1FAE5"
                            : colors.background,
                      }}
                    >
                      <Ionicons
                        name="arrow-up-circle"
                        size={20}
                        color={
                          editingTx?.io === "IN" ? "#10B981" : colors.subText
                        }
                      />
                      < Text
                        style={{
                          fontSize: 15,
                          fontWeight: "700",
                          color:
                            editingTx?.io === "IN" ? "#10B981" : colors.subText,
                        }}
                      >
                        Thu nhập
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Amount */}
                <View style={{ marginBottom: 16 }}>
                  <Text
                    style={
                      {
                        fontSize: 14,
                        fontWeight: "600",
                        marginBottom: 6,
                        color: colors.text,
                      }
                    }
                  >
                    {t("amount")}
                  </Text>
                  < TextInput
                    value={editAmount}
                    onChangeText={(text) => {
                      // Format with commas
                      const num = text.replace(/[^0-9]/g, "");
                      if (num) {
                        const formatted = parseInt(num).toLocaleString("vi-VN");
                        setEditAmount(formatted);
                      } else {
                        setEditAmount("");
                      }
                    }}
                    keyboardType="numeric"
                    placeholderTextColor={colors.subText}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.divider,
                      borderRadius: 8,
                      padding: 12,
                      fontSize: 16,
                      color: colors.text,
                      backgroundColor: colors.background,
                    }}
                  />
                </View>

                {/* Note */}
                <View style={{ marginBottom: 16 }}>
                  <Text
                    style={
                      {
                        fontSize: 14,
                        fontWeight: "600",
                        marginBottom: 6,
                        color: colors.text,
                      }
                    }
                  >
                    {t("note")}
                  </Text>
                  < TextInput
                    value={editNote}
                    onChangeText={setEditNote}
                    multiline
                    numberOfLines={3}
                    placeholderTextColor={colors.subText}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.divider,
                      borderRadius: 8,
                      padding: 12,
                      fontSize: 16,
                      textAlignVertical: "top",
                      color: colors.text,
                      backgroundColor: colors.background,
                    }}
                  />
                </View>

                {/* Category */}
                <View style={{ marginBottom: 16 }}>
                  <Text
                    style={
                      {
                        fontSize: 14,
                        fontWeight: "600",
                        marginBottom: 6,
                        color: colors.text,
                      }
                    }
                  >
                    {t("category")}
                  </Text>
                  < ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{
                      flexDirection: "row",
                      gap: 8,
                      paddingVertical: 4,
                    }}
                  >
                    {
                      items
                        .filter((c) => {
                          if (!editingTx) return false;
                          const type =
                            editingTx.io === "OUT" ? "expense" : "income";
                          return c.type === type;
                        })
                        .map((cat) => (
                          <TouchableOpacity
                            key={cat.id}
                            onPress={() => setEditCategoryId(cat.id)}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor:
                                editCategoryId === cat.id
                                  ? "#10B981"
                                  : colors.divider,
                              backgroundColor:
                                editCategoryId === cat.id
                                  ? mode === "dark"
                                    ? "#065F46"
                                    : "#D1FAE5"
                                  : colors.background,
                            }}
                          >
                            <Text
                              style={
                                {
                                  fontSize: 14,
                                  fontWeight: "600",
                                  color:
                                    editCategoryId === cat.id
                                      ? "#10B981"
                                      : colors.text,
                                }
                              }
                            >
                              {cat.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                  </ScrollView>
                </View>
              </ScrollView>

              {/* Save button */}
              <TouchableOpacity
                onPress={handleSaveEdit}
                disabled={isSaving}
                style={{
                  backgroundColor: isSaving ? "#9CA3AF" : "#10B981",
                  padding: 14,
                  borderRadius: 10,
                  alignItems: "center",
                  marginTop: 8,
                  flexDirection: "row",
                  justifyContent: "center",
                  opacity: isSaving ? 0.7 : 1,
                }}
              >
                {isSaving && (
                  <Animated.View
                    style={
                      {
                        marginRight: 8,
                        transform: [{ rotate: spin }],
                      }
                    }
                  >
                    <Ionicons name="sync" size={20} color="#fff" />
                  </Animated.View>
                )}
                <Text
                  style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}
                >
                  {isSaving ? t("saving") || "Đang lưu..." : t("saveChanges")}
                </Text>
              </TouchableOpacity>
            </SafeAreaView>
          </View>
        </Modal>

        {/* Input Bar (ẩn khi đang thu âm) */}
        <Animated.View
          onLayout={
            (e) =>
              setInputBarHeight(Math.max(0, e.nativeEvent.layout.height || 0))
          }
          style={
            [
              styles.inputBar,
              {
                borderColor: colors.divider,
                backgroundColor: colors.card,
                marginBottom: (keyboardHeight || 0) + (insets.bottom || 0),
                paddingBottom: 12,
              },
            ]}
        >
          {/* Nút Voice (ẩn khi đang ghi âm) */}
          {
            !isRecording && (
              <Pressable
                style={
                  [
                    styles.iconBtn,
                    {
                      backgroundColor:
                        mode === "dark" ? colors.background : "#F3F4F6",
                      borderColor: colors.divider,
                      opacity: isProcessingVoice ? 0.4 : 1,
                    },
                  ]
                }
                onPress={startVoice}
                disabled={isProcessingVoice}
              >
                <Ionicons name={"mic"} size={22} color={colors.icon} />
              </Pressable>
            )
          }

          {/* Nút Image - ẩn khi đang ghi âm */}
          {
            !isRecording && (
              <Pressable
                style={
                  [
                    styles.iconBtn,
                    {
                      backgroundColor:
                        mode === "dark" ? colors.background : "#F3F4F6",
                      borderColor: colors.divider,
                    },
                  ]
                }
                onPress={handleImagePress}
                disabled={isProcessingVoice}
              >
                <Ionicons name="image" size={22} color={colors.icon} />
              </Pressable>
            )
          }

          {/* Vùng giữa: TextInput <-> RecordingBar */}
          <View
            style={
              {
                flex: 1,
                marginHorizontal: 4,
                position: "relative",
                minHeight: 44,
                justifyContent: "center",
              }
            }
          >
            {/* TextInput (hiện khi không ghi) */}
            < Animated.View
              pointerEvents={isRecording ? "none" : "auto"}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                opacity: inputAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0],
                }),
                transform: [
                  {
                    translateY: inputAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 10],
                    }),
                  },
                ],
              }}
            >
              <Tooltip
                isVisible={shouldShowTour && currentStep === 2}
                content={
                  < View style={{ padding: 8 }}>
                    <Text
                      style={
                        {
                          fontSize: 16,
                          fontWeight: "700",
                          color: "#111",
                          marginBottom: 8,
                        }
                      }
                    >
                      📝 Nhập giao dịch
                    </Text>
                    < Text
                      style={{
                        fontSize: 14,
                        color: "#666",
                        marginBottom: 12,
                      }}
                    >
                      Nhập nội dung giao dịch của bạn tại đây.Ví dụ: "Trà sữa
                      60k" rồi nhấn nút gửi.
                    </Text>
                    < TouchableOpacity
                      onPress={() => {
                        nextStep();
                        inputRef.current?.focus();
                      }}
                      style={{
                        backgroundColor: "#10B981",
                        paddingVertical: 8,
                        paddingHorizontal: 16,
                        borderRadius: 8,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "600" }}>
                        Tiếp tục
                      </Text>
                    </TouchableOpacity>
                  </View>
                }
                placement="top"
                onClose={() => nextStep()}
                contentStyle={{
                  backgroundColor: "#fff",
                  borderRadius: 12,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 8,
                  elevation: 5,
                }}
              >
                <TextInput
                  placeholder={t("inputPlaceholder")}
                  placeholderTextColor={colors.subText}
                  value={input}
                  onChangeText={(text) => {
                    setInput(text);
                    // Advance to step 3 when user types something
                    if (
                      shouldShowTour &&
                      currentStep === 2 &&
                      text.trim().length > 3
                    ) {
                      Keyboard.dismiss();
                      setKeyboardHeight(0);
                      inputRef.current?.blur();
                      nextStep();
                    }
                  }}
                  ref={(r) => {
                    inputRef.current = r;
                  }}
                  onFocus={() => {
                    // Some keyboards/ROMs don't emit keyboardDidShow with sizes.
                    // Ensure the input bar lifts when focused by using an estimated height.
                    if (!keyboardHeight) {
                      const est = Math.max(
                        150,
                        estimatedKeyboardHeight - (insets.bottom || 0)
                      );
                      setKeyboardHeight(est);
                    }
                    // Scroll to end so last messages remain visible. Use multiple
                    // attempts to handle timing differences across keyboards/ROMs.
                    try {
                      requestAnimationFrame(() =>
                        flatRef.current?.scrollToEnd({ animated: true })
                      );
                    } catch (e) { }

                    setTimeout(
                      () => flatRef.current?.scrollToEnd({ animated: true }),
                      120
                    );
                    setTimeout(
                      () => flatRef.current?.scrollToEnd({ animated: true }),
                      420
                    );
                    // Also attempt after interactions settle
                    try {
                      InteractionManager.runAfterInteractions(() => {
                        flatRef.current?.scrollToEnd({ animated: true });
                      });
                    } catch (e) { }
                  }}
                  onBlur={() => {
                    setKeyboardHeight(0);
                  }}
                  style={
                    [
                      styles.textInput,
                      {
                        borderColor: colors.divider,
                        backgroundColor: colors.background,
                        color: colors.text,
                        paddingHorizontal: 16
                      },
                    ]}
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                />
              </Tooltip>
            </Animated.View>

            {/* Recording bar (hiện khi đang ghi) */}
            <Animated.View
              pointerEvents={isRecording ? "auto" : "none"}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                opacity: inputAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1],
                }),
                transform: [
                  {
                    translateY: inputAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-10, 0],
                    }),
                  },
                ],
              }}
            >
              <View
                style={
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.divider,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    backgroundColor:
                      mode === "dark" ? "rgba(37, 99, 235, 0.15)" : "#E5F5F9",
                  }
                }
              >
                {/* small mic icon at the start while recording */}
                < View
                  style={{
                    width: 32,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 6,
                  }}
                >
                  <Ionicons
                    name="mic"
                    size={18}
                    color={mode === "dark" ? "#60A5FA" : "#3B82F6"}
                  />
                </View>

                < View style={{ flex: 1, marginHorizontal: 8 }}>
                  <VoiceWaveformLite
                    isRecording={isRecording}
                    color={mode === "dark" ? "#60A5FA" : "#3B82F6"}
                  />
                </View>

                {/* X – hủy (framed button) */}
                <Pressable
                  onPress={cancelRecording}
                  disabled={isSubmitting}
                  style={
                    [
                      styles.iconBtn,
                      {
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        marginRight: 8,
                        backgroundColor:
                          mode === "dark" ? colors.background : colors.card,
                        borderColor: colors.divider,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: isSubmitting ? 0.45 : 1,
                      },
                    ]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color={colors.subText} />
                </Pressable>

                {/* ✓ – gửi voice (framed button) */}
                <Pressable
                  onPress={handleSubmitVoice}
                  disabled={isSubmitting}
                  style={
                    [
                      styles.iconBtn,
                      {
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        marginLeft: 8,
                        backgroundColor:
                          mode === "dark" ? colors.background : colors.card,
                        borderColor: colors.divider,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: isSubmitting ? 0.45 : 1,
                      },
                    ]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="checkmark" size={18} color="#10B981" />
                </Pressable>
              </View>
            </Animated.View>
          </View>

          {/* Nút Send text - ẩn khi đang ghi âm */}
          {
            !isRecording && (
              <Tooltip
                isVisible={shouldShowTour && currentStep === 3}
                content={
                  < View style={{ padding: 8 }
                  }>
                    <Text
                      style={
                        {
                          fontSize: 16,
                          fontWeight: "700",
                          color: "#111",
                          marginBottom: 8,
                        }
                      }
                    >
                      🚀 Gửi tin nhắn
                    </Text>
                    < Text
                      style={{
                        fontSize: 14,
                        color: "#666",
                        marginBottom: 12,
                      }}
                    >
                      Nhấn nút "Gửi" để AI xử lý giao dịch của bạn.AI sẽ tự động
                      phân loại và tạo giao dịch mới.
                    </Text>
                    < TouchableOpacity
                      onPress={() => {
                        nextStep();
                      }}
                      style={{
                        backgroundColor: "#10B981",
                        paddingVertical: 8,
                        paddingHorizontal: 16,
                        borderRadius: 8,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "600" }}>
                        Hiểu rồi
                      </Text>
                    </TouchableOpacity>
                  </View>
                }
                placement="top"
                onClose={() => nextStep()}
                contentStyle={{
                  backgroundColor: "#fff",
                  borderRadius: 12,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 8,
                  elevation: 5,
                }}
              >
                <Pressable
                  style={
                    [
                      styles.sendBtn,
                      isSending
                        ? { backgroundColor: "#9CA3AF" }
                        : { backgroundColor: mode === "dark" ? "#3B82F6" : "#111" },
                    ]
                  }
                  onPress={handleSend}
                  disabled={isSending}
                  accessibilityLabel={isSending ? "Đang gửi" : "Gửi"}
                >
                  {
                    isSending ? (
                      <View style={{ flexDirection: "row", alignItems: "center" }} >
                        <ActivityIndicator size="small" color="#fff" />
                      </View>
                    ) : (
                      <Text style={styles.sendText} > {t("send")} </Text>
                    )}
                </Pressable>
              </Tooltip>
            )}
        </Animated.View>

        {/* Image Viewer Modal – Pinch-to-Zoom */}
        <Modal
          visible={imageViewerVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            setImageViewerVisible(false);
          }}
          statusBarTranslucent
        >
          <PinchZoomImageViewer
            uri={selectedImage}
            onClose={() => setImageViewerVisible(false)}
          />
        </Modal>

        {/* Floating Scroll to Bottom Button */}
        {
          !isAtBottom && !forceHideButton && (
            <Animated.View
              style={
                {
                  position: 'absolute',
                  right: 12, // Position above the send button
                  bottom: inputBarHeight + insets.bottom + 10, // Above the send button
                  opacity: scrollButtonAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 0.85], // Slightly transparent for subtle look
                  }),
                  transform: [
                    {
                      translateY: scrollButtonAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [20, 0], // Slide up from below
                      }),
                    },
                    {
                      scale: scrollButtonAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 1], // Slight scale animation
                      }),
                    },
                  ],
                }
              }
            >
              <Pressable
                style={
                  {
                    width: 32,
                    height: 32,
                    borderRadius: 12, // Match send button borderRadius
                    backgroundColor: mode === 'dark' ? '#3B82F6' : '#2563EB', // Match send button colors
                    alignItems: 'center',
                    justifyContent: 'center',
                    elevation: 3,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.15,
                    shadowRadius: 2,
                  }
                }
                onPress={() => {
                  // Hide button immediately when pressed
                  setForceHideButton(true);
                  setIsScrollingToBottom(true);
                  // Scroll to bottom
                  flatRef.current?.scrollToEnd({ animated: true });
                  // Set isAtBottom to true after scroll completes
                  setTimeout(() => {
                    setIsAtBottom(true);
                    setIsScrollingToBottom(false);
                  }, 300); // Match animation duration
                }
                }
              >
                <Ionicons name="chevron-down" size={20} color="#fff" />
              </Pressable>
            </Animated.View>
          )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- Styles ---------------- */
const styles = StyleSheet.create({
  bubble: {
    maxWidth: "85%",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e5ea",
    backgroundColor: "#fff",
  },
  left: { alignSelf: "flex-start" },
  right: {
    alignSelf: "flex-end",
    backgroundColor: "#E5F5F9",
    borderColor: "#D0EEF6",
  },
  text: { fontSize: 15, color: "#111" },

  card: {
    padding: 14,
    borderWidth: 1,
    borderColor: "#e8e8e8",
    backgroundColor: "#fff",
    borderRadius: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#7EC5E8",
    alignItems: "center",
    justifyContent: "center",
  },

  inputBar: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#fff",
  },
  textInput: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5ea",
    backgroundColor: "#fff",
  },
  sendBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontWeight: "600" },

  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderColor: "#E5E7EB",
  },

  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 90,
    justifyContent: "center",
  },

  suggestBar: {
    flexDirection: "row",
    // container styles are applied inline so keep this minimal
    overflow: "hidden",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "transparent",
  },
  chipText: { fontSize: 13, color: "#222", fontWeight: "600" },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#bbb",
    opacity: 0.6,
  },
});
