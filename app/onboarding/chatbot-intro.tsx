import { useTheme } from "@/app/providers/ThemeProvider";
import { db } from "@/db";
import { useI18n } from "@/i18n/I18nProvider";
import {
  listCategories,
  seedCategoryDefaults,
  type Category,
} from "@/repos/categoryRepo";
import { logCorrection, logPrediction } from "@/repos/mlRepo";
import {
  addExpense,
  addIncome,
  deleteTx,
  updateTransaction,
} from "@/repos/transactionRepo";
import { transactionClassifier } from "@/services/transactionClassifier";
import { phobertExtractor } from "@/services/phobertAmountExtractor";
import { getCurrentUserId } from "@/utils/auth";
import { fixIconName } from "@/utils/iconMapper";
import { parseAmountVN, parseTransactionText } from "@/utils/textPreprocessing";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { router } from "expo-router";
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
import { tfTransactionParser } from "../../services/tensorflowTransactionParser";

// Minimal placeholders (keeps file compiling if config values/helpers missing)
const HUGGINGFACE_API_KEY =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_HUGGINGFACE_API_KEY ||
  Constants.expoConfig?.extra?.HUGGINGFACE_API_KEY;
const HUGGINGFACE_MODEL =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_HUGGINGFACE_MODEL ||
  Constants.expoConfig?.extra?.HUGGINGFACE_MODEL ||
  "llama-3.1-8b-instant";
const OCR_SPACE_API_KEY =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_OCR_SPACE_API_KEY || "";

function tryPickJson(text: string) {
  if (!text) return null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : JSON.parse(text);
  } catch {
    return null;
  }
}

function makeShortMsg(io: any, categoryName: any, amount: any, note: any) {
  const money = amount ? amount.toLocaleString?.("vi-VN") + "đ" : "";
  return io === "OUT" ? `Đã ghi nhận chi ${money}` : `Đã ghi nhận thu ${money}`;
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

type Msg = any;

async function getEmotionalReplyDirect(args: {
  io: "IN" | "OUT";
  categoryName: string;
  amount: number | null;
  note: string;
  originalText?: string; // Full original text for date parsing
}): Promise<{
  message: string;
  categoryId?: string;
  amount: number | null;
  io: "IN" | "OUT";
  note: string;
  date?: Date;
}> {
  const { io, categoryName, amount, note, originalText } = args;

  const listCategoriesUser = await listCategories();

  // Parse date from original text (before cleaning) for accurate date extraction
  if (!originalText) {
    console.warn(
      "⚠️ WARNING: originalText is undefined! Date parsing may fail!"
    );
    console.warn(
      "⚠️ This means the old code path is running. Please RELOAD the app!"
    );
  }

  const textForDateParsing = originalText || note;

  const extractedDate: Date = parseDateFromAI("", textForDateParsing);

  const isToday = extractedDate.toDateString() === new Date().toDateString();
  const isFuture = extractedDate > new Date();
  const isPast = extractedDate < new Date() && !isToday;

  let dateDisplay: string;
  let timeContext: string;

  if (isToday) {
    dateDisplay = "hôm nay";
    timeContext = "hôm nay";
  } else if (isFuture) {
    dateDisplay = extractedDate.toLocaleDateString("vi-VN");
    timeContext = `cho ngày ${dateDisplay} (tương lai)`;
  } else {
    dateDisplay = extractedDate.toLocaleDateString("vi-VN");
    timeContext = `ngày ${dateDisplay}`;
  }

  const prompt = `Bạn là trợ thủ tài chính thân thiện của người Việt. Tạo câu xác nhận giao dịch ngắn gọn, tự nhiên.

📝 Người dùng nói: "${note}"

✓ Đã xác định:
- ${io === "IN" ? "Thu" : "Chi"}: ${
    amount ? amount.toLocaleString("vi-VN") + "đ" : "?"
  }
- Danh mục: ${categoryName}
- Ngày: ${dateDisplay}${isFuture ? " (TƯƠNG LAI)" : ""}

📋 VÍ DỤ CHUẨN (học theo):

"Du lịch đà lạt 397k ngày 25/12/2025"
→ Đã lên lịch chi 397.000đ cho chuyến du lịch Đà Lạt vào ngày 25/12/2025. Đừng quên nhé! 📅🎒

"hôm qua mua cafe 50k"
→ Đã ghi hôm qua chi 50.000đ mua cafe. Thư giãn tuyệt! ☕

"ngày 5/12 mua vé máy bay 2tr"
→ Đã lên lịch chi 2.000.000đ mua vé máy bay ngày 5/12/2025. Chuẩn bị hành lý nhé! ✈️

"nhận lương 15tr"
→ Đã ghi thu 15.000.000đ từ lương hôm nay. Chúc mừng bạn! 💰

"ăn trưa 45k"
→ Đã ghi chi 45.000đ ăn trưa hôm nay. Ngon miệng! 🍜

YÊU CẦU: Tạo câu tương tự (1-2 câu, emoji cuối), CHỈ TRẢ CÂU PHẢN HỒI:`;

  // Fallback: Smart response with full context
  let dateStr = "";
  let verb = "Đã ghi";

  if (isFuture) {
    dateStr = ` cho ngày ${extractedDate.toLocaleDateString("vi-VN")}`;
    verb = "Đã lên lịch";
  } else if (isPast) {
    dateStr = ` ngày ${extractedDate.toLocaleDateString("vi-VN")}`;
    verb = "Đã ghi";
  } else {
    dateStr = " hôm nay";
    verb = "Đã ghi";
  }

  const amountStr = amount ? amount.toLocaleString("vi-VN") + "đ " : "";
  const fallbackMsg =
    io === "OUT"
      ? `${verb} chi ${amountStr}${note}${dateStr}. ${isFuture ? "📅" : "✓"}`
      : `${verb} thu ${amountStr}${note}${dateStr}. ${isFuture ? "📅" : "✓"}`;

  return {
    message: fallbackMsg,
    categoryId: undefined,
    amount,
    io,
    note,
    date: extractedDate,
  };
}

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

      <TouchableOpacity
        onPress={() => router.replace("/onboarding/reminder-setup")}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 8,
          paddingHorizontal: 16,
          backgroundColor: "#10B981",
          borderRadius: 8,
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>
          Tiếp tục
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color="#fff"
        />
      </TouchableOpacity>
    </View>
  );
}


const parseTransactionWithAI = async (
  text: string,
  userCategories: Category[]
): Promise<{
  action:
    | "CREATE_TRANSACTION"
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
  confidence?: number;
  mlFailed?: boolean;
  alternatives?: Array<{
    categoryId: string;
    categoryName: string;
    confidence: number;
  }>;
} | null> => {
  try {
    // Parse transaction locally with TensorFlow (for amount and date only!)
    const result = await tfTransactionParser.parseTransaction(
      text,
      userCategories
    );

    if (!result) {
      return null;
    }

    // Try ML prediction with amount context (fast - returns null if model not ready)
    const mlPrediction = await transactionClassifier.predictCategory(
      result.note,
      result.amount
    );

    let categoryId = result.categoryId;
    let categoryName = result.categoryName;
    let confidence = result.primary?.confidence || 0;
    let alternatives = result.alternatives || [];
    let message = result.message;
    let mlFailed = !mlPrediction; // Model not ready or prediction failed

    // Define minimum confidence threshold for auto-creation
    // Raised to 60% to ensure high accuracy and reduce wrong classifications
    // User can still correct via suggestions if confidence is lower
    const MIN_AUTO_CONFIDENCE = 0.6;

    if (mlPrediction && mlPrediction.confidence > MIN_AUTO_CONFIDENCE) {
      // ML has a good prediction - use it instead!
      console.log(
        `✅ Auto-creating with ${(mlPrediction.confidence * 100).toFixed(
          1
        )}% confidence`
      );
      categoryId = mlPrediction.categoryId;
      categoryName = mlPrediction.categoryName || result.categoryName;
      confidence = mlPrediction.confidence;
      // Clear alternatives since we're using ML prediction
      alternatives = [];

      // 🔥 REGENERATE MESSAGE with ML category!
      const mlCategory = userCategories.find((c) => c.id === categoryId);
      if (result.action === "CREATE_TRANSACTION" && result.amount) {
        const formattedAmount = result.amount.toLocaleString("vi-VN");
        const dateStr = result.date.toLocaleDateString("vi-VN");
        const emoji = mlCategory?.icon || "✅";
        const transactionType = mlCategory?.type === "income" ? "thu" : "chi";
        const confidenceStr =
          confidence < 0.75
            ? ` (${(confidence * 100).toFixed(0)}% chắc chắn)`
            : " ✓";

        // Use original user text in the message to keep bot response identical
        // to what the user sent (preserve casing/spacing).
        message = `Đã ghi ${transactionType} ${formattedAmount}đ cho ${text} vào ${dateStr}. Phân loại: ${categoryName}${confidenceStr}.`;
      }
    } else {
      // ML prediction is too low or model not ready - will show suggestion UI
      console.log(
        `⚠️ Low confidence (${
          mlPrediction ? (mlPrediction.confidence * 100).toFixed(1) : 0
        }%) - showing suggestions`
      );
      mlFailed = true;
      confidence = 0.05; // Trigger suggestion UI
    }

    // Derive IO from the resolved category type (AI-first, no keyword rules)
    const resolvedCategory = userCategories.find((c) => c.id === categoryId);
    const resolvedIo: "IN" | "OUT" =
      resolvedCategory?.type === "income"
        ? "IN"
        : resolvedCategory?.type === "expense"
        ? "OUT"
        : result.io;

    // Include confidence and alternatives from the parser.
    // Important: preserve the original user input as `note` so UI and storage
    // show exactly what user sent (e.g., "Trà sữa 50k" stays unchanged).
    return {
      ...result,
      note: text,
      categoryId,
      categoryName,
      confidence,
      message, // Use regenerated message
      mlFailed, // Flag indicating ML prediction failed
      io: resolvedIo,
      alternatives: alternatives.map((alt) => ({
        categoryId: alt.categoryId,
        categoryName: alt.categoryName,
        confidence: alt.confidence,
      })),
    };
  } catch (error) {
    console.error("❌ TensorFlow parser error:", error);
    return null;
  }
};

// IO is derived from the resolved category type (income/expense)


/* ---------------- ML: Logistic Regression JSON on-device ---------------- */
type LRModel = {
  classes: string[]; // ví dụ: ["Ăn uống","Di chuyển","Mua sắm",...]
  vocab: Record<string, number>; // char n-gram -> index
  weights: number[][]; // [numClasses][numFeatures]
  bias: number[]; // [numClasses]
};
function featurize(text: string, vocab: Record<string, number>) {
  const t = normalizeVN(text);
  const feats = new Map<number, number>();
  for (let n = 3; n <= 5; n++) {
    for (let i = 0; i <= Math.max(0, t.length - n); i++) {
      const g = t.slice(i, i + n);
      const idx = vocab[g];
      if (idx !== undefined) feats.set(idx, (feats.get(idx) || 0) + 1);
    }
  }
  return feats;
}
const softmax = (logits: number[]) => {
  const m = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - m));
  const s = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / (s || 1));
};
function lrPredict(text: string, model: LRModel) {
  const x = featurize(text, model.vocab);
  const logits = model.weights.map((w_k, k) => {
    let s = model.bias?.[k] ?? 0;
    x.forEach((val, idx) => {
      const w = w_k[idx] || 0;
      s += w * val;
    });
    return s;
  });
  const proba = softmax(logits);
  return model.classes
    .map((c, i) => ({ label: c, p: proba[i] }))
    .sort((a, b) => b.p - a.p);
}

/* ---------------- Map ML label → user's categories ---------------- */
function mapMLToUserCategory(
  mlLabel: string,
  categories: Category[]
): { category: Category; sim: number } | null {
  // Tìm danh mục có tên/alias gần nhất với label
  let best: { category: Category; sim: number } | null = null;
  for (const c of categories) {
    const s1 = jaccard(tokens(mlLabel), tokens(c.name));
    const s2 = ngramOverlap(mlLabel, c.name, 3);
    const sim = 0.6 * s1 + 0.4 * s2;
    if (!best || sim > best.sim) best = { category: c, sim };
  }
  return best;
}

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
function TypingIndicator({ colors }: { colors: any }) {
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

  return (
    <View
      style={[
        styles.bubble,
        styles.left,
        {
          flexDirection: "row",
          gap: 4,
          backgroundColor: colors.card,
          borderColor: colors.divider,
        },
      ]}
    >
      {animations.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            { backgroundColor: colors.subText, opacity: anim },
          ]}
        />
      ))}
    </View>
  );
}


const detectInOut = (text: string): "IN" | "OUT" => {
  const t = text.toLowerCase();
  if (/(lương|thu nhập|refund|hoàn tiền|chuyển vào)/.test(t)) return "IN";
  return "OUT";
};

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

export default function ChatbotIntro() {
  const { t } = useI18n();
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputBarHeight, setInputBarHeight] = useState(0);

  const [items, setItems] = useState<Category[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [model, setModel] = useState<LRModel | null>(null);
  const [priors, setPriors] = useState<{
    IN: Record<string, number>;
    OUT: Record<string, number>;
  }>({ IN: {}, OUT: {} });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "bot", text: t("chatWelcome") },
  ]);
  const flatRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput | null>(null);

  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

  // Khi component mount, bắt đầu huấn luyện nếu chưa sẵn sàng
  useEffect(() => {
    load();
  }, []);

  const load = useCallback(async () => {
    await seedCategoryDefaults();
    // ⚡ PERFORMANCE: Use cached categories for faster loading
    const { getCachedCategories } = await import("@/services/cacheService");
    const rows = await getCachedCategories();
    setItems(rows);

    // Defer model training to background (after UI loads)
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        console.log("🚀 Starting background model training...");
        transactionClassifier
          .trainModel(false)
          .then((result) => {
            if (result.success) {
              console.log(
                `✅ Background training complete: ${
                  result.accuracy ? (result.accuracy * 100).toFixed(1) : "N/A"
                }% accuracy`
              );
            } else {
              console.warn(
                `⚠️ Background training skipped/failed: ${result.message}`
              );
            }
          })
          .catch((err) => {
            console.error("❌ Background training error:", err);
          });
      }, 2000);
    });
  }, []);

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
        } catch (e) {}
      }, 1500);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );


  // Keyboard listeners to lift input bar on Android and adjust padding
  useEffect(() => {
    const onShow = (e: any) => {
      // Try multiple event shapes (some keyboards report different fields)
      let h =
        e?.endCoordinates?.height ||
        e?.end?.height ||
        e?.startCoordinates?.height ||
        0;

      // Fallback: some OEM keyboards report 0 — estimate as ~38% of screen height
      if (!h || h <= 0) {
        h = Math.round(Dimensions.get("window").height * 0.38);
      }

      // Use full keyboard height so when keyboard is hidden (height = 0)
      // the input bottom will be 0 as requested.
      setKeyboardHeight(h);

      // Ensure view scrolls so input and last messages are visible
      // Multiple attempts to handle different keyboard animation timings
      setTimeout(() => {
        flatRef.current?.scrollToEnd({ animated: true });
      }, 100);
      setTimeout(() => {
        flatRef.current?.scrollToEnd({ animated: true });
      }, 300);
    };

    const onHide = () => {
      setKeyboardHeight(0);
      // Scroll to end when keyboard hides to keep chat at bottom
      setTimeout(() => {
        flatRef.current?.scrollToEnd({ animated: true });
      }, 100);
    };

    const subShow = Keyboard.addListener("keyboardDidShow", onShow);
    const subHide = Keyboard.addListener("keyboardDidHide", onHide);

    return () => {
      try {
        subShow.remove();
      } catch (e) {}
      try {
        subHide.remove();
      } catch (e) {}
    };
  }, [insets.bottom]);

  const scrollToEnd = () =>
    requestAnimationFrame(() =>
      flatRef.current?.scrollToEnd({ animated: true })
    );

  // Core: classify to user's categories with AI (memoized to avoid recalculation)
  const classifyToUserCategoriesAI = useCallback(
    async (text: string, expectedIO?: "IN" | "OUT") => {
      // PRIORITY 1: Neural on-device model (learned from user's history)
      try {
        const pred =
          await transactionClassifier.predictCategoryWithAlternatives(text);

        const candidates = [pred.primary, ...pred.alternatives]
          .filter((p) => p && p.categoryId)
          .map((p) => {
            const cat = items.find((c) => c.id === p.categoryId);
            return {
              categoryId: p.categoryId,
              name: cat?.name || p.categoryName || "",
              score: p.confidence,
              io: cat?.type === "income" ? ("IN" as const) : ("OUT" as const),
            };
          })
          .filter((x) => x.name)
          // Filter by expected IO type if provided
          .filter((x) => !expectedIO || x.io === expectedIO);

        if (candidates.length > 0) {
          // Ensure unique ids, keep highest score
          const byId = new Map<string, (typeof candidates)[number]>();
          for (const c of candidates) {
            const prev = byId.get(c.categoryId);
            if (!prev || c.score > prev.score) byId.set(c.categoryId, c);
          }
          const ranked = Array.from(byId.values()).sort(
            (a, b) => b.score - a.score
          );
          const topIo = expectedIO || ranked[0]?.io || "OUT";
          return {
            io: topIo,
            ranked: ranked.map(({ io: _io, ...rest }) => rest),
          };
        }
      } catch (error) {
        console.warn(
          "Neural classification failed, falling back to priors:",
          error
        );
      }

      // PRIORITY 2: Priors-only fallback (no keyword/regex scoring)
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

  // ⬇️ Trong handleSend, đổi phần "tạo giao dịch" để fallback sang pendingPick khi chưa chắc danh mục:
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;

    setIsSending(true); // show spinner + block
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setPendingPick(null);
    scrollToEnd();

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




  const chooseCategory = async (c: { categoryId: string; name: string }) => {
    if (!pendingPick) return;
    try {
      // Tạo demo transaction thay vì transaction thật
      const transactionDate = (pendingPick as any).date || new Date();
      const when = transactionDate.toLocaleDateString();
      const selectedCategory = items.find((cat) => cat.id === c.categoryId);
      setMessages((m) => [
        ...m,
        {
          role: "card",
          transactionId: `demo-${Date.now()}`,
          accountId: "demo-account",
          amount: pendingPick.amount ?? null,
          io: pendingPick.io,
          categoryId: c.categoryId,
          categoryName: c.name,
          categoryIcon: selectedCategory?.icon || "wallet",
          categoryColor: selectedCategory?.color || "#6366F1",
          note: pendingPick.text,
          when,
        },
      ]);

      // 🎓 LEARNING PIPELINE: Log prediction → correction → retrain
      try {
        // 1. Get the top suggested category (what model predicted)
        const topSuggestion = pendingPick.choices?.[0];

        // 2. Only log if user chose a DIFFERENT category than what was predicted
        if (topSuggestion && topSuggestion.categoryId !== c.categoryId) {
          // Log the prediction record
          const sampleId = await logPrediction({
            text: pendingPick.text,
            amount: pendingPick.amount,
            io: pendingPick.io,
            predictedCategoryId: topSuggestion.categoryId,
            confidence: topSuggestion.score || 0.5,
          });

          // Log the correction
          if (sampleId) {
            await logCorrection({
              id: sampleId,
              chosenCategoryId: c.categoryId,
            });
          }

          // Defer training to background (after UI interactions complete)
          InteractionManager.runAfterInteractions(() => {
            transactionClassifier
              .learnFromCorrection(pendingPick.text, c.categoryId)
              .catch((err) =>
                console.warn("⚠️ Background training failed:", err)
              );
          });
        } else if (topSuggestion && topSuggestion.categoryId === c.categoryId) {
          // Still log as a positive example (user confirmed the prediction was correct)
          await logPrediction({
            text: pendingPick.text,
            amount: pendingPick.amount,
            io: pendingPick.io,
            predictedCategoryId: c.categoryId,
            confidence: topSuggestion.score || 0.8,
          });
        } else {
          // Log as prediction anyway
          await logPrediction({
            text: pendingPick.text,
            amount: pendingPick.amount,
            io: pendingPick.io,
            predictedCategoryId: c.categoryId,
            confidence: 0.5,
          });
        }
      } catch (err) {
        console.warn("⚠️ Learning pipeline failed:", err);
      }

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

      // Tạo demo transaction thay vì transaction thật
      setTimeout(() => {
        transactionClassifier
          .learnFromNewTransaction(aiResult.note, categoryId)
          .catch(() => {});
      }, 100);

      const when = aiResult.date.toLocaleDateString("vi-VN");

      // Remove typing indicator and add bot response + transaction card
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: aiResult.message,
        },
        {
          role: "card",
          transactionId: `demo-${Date.now()}`,
          accountId: "demo-account",
          amount: aiResult.amount ?? null,
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
      const aiResponse = await getEmotionalReplyDirect({
        io,
        categoryName,
        amount,
        note: originalNote,
        originalText: originalNote, // Use original text for date parsing
      });

      // Tạo demo transaction thay vì transaction thật
      const when = aiResponse.date
        ? aiResponse.date.toLocaleDateString("vi-VN")
        : new Date().toLocaleDateString("vi-VN");

      // Remove typing indicator and add bot response + transaction card
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: aiResponse.message, // AI's contextual response
        },
        {
          role: "card",
          transactionId: `demo-${Date.now()}`,
          accountId: "demo-account",
          amount: aiResponse.amount ?? null,
          io,
          categoryId,
          categoryName,
          categoryIcon: selectedCategory?.icon || "wallet",
          categoryColor: selectedCategory?.color || "#6366F1",
          note: originalNote,
          when,
          date: aiResponse.date, // Store date object for future reference
        },
      ]);
      scrollToEnd();
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
        // Add typing indicator only if not already present
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last && last.role === "typing") return m;
          return [...m, { role: "typing" }];
        });
        scrollToEnd();

        const aiResult = await parseTransactionWithAI(userText, items);

        if (!aiResult) {
          let amountFromOriginal: number | null = null;
          try {
            const phobertResult = await phobertExtractor.extractAmount(
              userText
            );
            if (phobertResult.amount && phobertResult.confidence > 0.5) {
              amountFromOriginal = phobertResult.amount;
            } else {
              // Low confidence, fallback to regex
              amountFromOriginal = parseAmountVN(userText);
            }
          } catch (error) {
            console.warn("❌ PhoBERT failed, using regex:", error);
            amountFromOriginal = parseAmountVN(userText);
          }

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
            await autoCreateTransactionDirect(aiResult, matchedCategory.id);
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
    [items, classifyToUserCategoriesAI]
  );

  const handleDeleteTransaction = async (transactionId: string) => {
    try {
      // Demo delete - just remove from messages
      console.log("Demo delete transaction:", transactionId);
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
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <BackBar />

      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            padding: 16,
            gap: 12,
            flexGrow: 1,
          }}
          onContentSizeChange={() => {
            // Auto scroll to end when content size changes (new messages)
            requestAnimationFrame(() => {
              flatRef.current?.scrollToEnd({ animated: true });
            });
          }}
          onLayout={() => {
            // Scroll to end on initial layout
            requestAnimationFrame(() => {
              flatRef.current?.scrollToEnd({ animated: false });
            });
          }}
          renderItem={useCallback(
            ({ item }: { item: any }) => {
              if (item.role === "user") {
                return (
                  <View
                    style={[
                      styles.bubble,
                      styles.right,
                      {
                        backgroundColor:
                          mode === "dark" ? "#1E3A8A" : "#E5F5F9",
                        borderColor: mode === "dark" ? "#1E40AF" : "#D0EEF6",
                      },
                    ]}
                  >
                    <Text style={[styles.text, { color: colors.text }]}>
                      {item.text}
                    </Text>
                  </View>
                );
              }
              if (item.role === "bot") {
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
                    <Text style={[styles.text, { color: colors.text }]}>
                      {item.text}
                    </Text>
                  </View>
                );
              }
              if (item.role === "typing") {
                return <TypingIndicator colors={colors} />;
              }

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
                        {t("recorded")}{" "}
                        {item.io === "OUT" ? t("expense") : t("income")} ·{" "}
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
                      <Text style={{ marginTop: 2, color: colors.text }}>
                        {item.note}
                      </Text>
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
                  {/* Action buttons */}
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 10,
                      marginTop: 16,
                      justifyContent: "flex-end",
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert(t("confirmDelete"), t("confirmDeleteMsg"), [
                          { text: t("cancel"), style: "cancel" },
                          {
                            text: t("delete"),
                            style: "destructive",
                            onPress: () =>
                              handleDeleteTransaction(item.transactionId),
                          },
                        ]);
                      }}
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor:
                            mode === "dark" ? "#7F1D1D" : "#FEE2E2",
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
            [colors, mode, items, t]
          )}
        />

        {/* Gợi ý khi chưa đủ tự tin: render above the input bar so it's not covered */}
        {
          <Animated.View
            pointerEvents={pendingPick ? "auto" : "none"}
            style={[
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
              }}
            >
              {pendingPick?.choices.map((c, index) => (
                <Pressable
                  key={c.categoryId}
                  onPress={() => chooseCategory(c)}
                  style={[
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
                    style={[
                      styles.chipText,
                      {
                        color:
                          index === 0 && c.score > 0.5 ? "#fff" : colors.text,
                      },
                    ]}
                  >
                    {c.name}
                  </Text>
                  <View
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
                      style={{
                        color:
                          index === 0 && c.score > 0.5
                            ? "#fff"
                            : colors.subText,
                        fontSize: 12,
                      }}
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

        {/* Edit Modal - REMOVED for demo optimization */}

        {/* Input Bar (ẩn khi đang thu âm) */}
        <Animated.View
          onLayout={(e) =>
            setInputBarHeight(Math.max(0, e.nativeEvent.layout.height || 0))
          }
          style={[
            styles.inputBar,
            {
              borderColor: colors.divider,
              backgroundColor: colors.card,
              marginBottom: (keyboardHeight || 0) + (insets.bottom || 0),
              paddingBottom: 12,
            },
          ]}
        >
          {/* Vùng giữa: TextInput */}
          <View
            style={{
              flex: 1,
              marginHorizontal: 4,
              position: "relative",
              minHeight: 44,
              justifyContent: "center",
            }}
          >
            <TextInput
              placeholder={t("inputPlaceholder")}
              placeholderTextColor={colors.subText}
              value={input}
              onChangeText={setInput}
              ref={(r) => {
                inputRef.current = r;
              }}
              onFocus={() => {
                // Try multiple event shapes (some keyboards report different fields)
                let h =
                  keyboardHeight ||
                  Math.round(Dimensions.get("window").height * 0.38);

                // Use full keyboard height so when keyboard is hidden (height = 0)
                // the input bottom will be 0 as requested.
                setKeyboardHeight(h);

                // Ensure view scrolls so input and last messages are visible
                // Multiple attempts to handle different keyboard animation timings
                setTimeout(() => {
                  flatRef.current?.scrollToEnd({ animated: true });
                }, 100);
                setTimeout(() => {
                  flatRef.current?.scrollToEnd({ animated: true });
                }, 300);
              }}
              onBlur={() => {
                setKeyboardHeight(0);
              }}
              style={[
                styles.textInput,
                {
                  borderColor: colors.divider,
                  backgroundColor: colors.background,
                  color: colors.text,
                },
              ]}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
          </View>

          {/* Nút Send text */}
          <Pressable
            style={[
              styles.sendBtn,
              isSending
                ? { backgroundColor: "#9CA3AF" }
                : { backgroundColor: mode === "dark" ? "#3B82F6" : "#111" },
            ]}
            onPress={handleSend}
            disabled={isSending}
            accessibilityLabel={isSending ? "Đang gửi" : "Gửi"}
          >
            {isSending ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : (
              <Text style={styles.sendText}>{t("send")}</Text>
            )}
          </Pressable>
        </Animated.View>

        {/* Image Viewer Modal - REMOVED for demo purposes */}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1F2937",
    textAlign: "center",
    marginBottom: 12,
  },
  desc: {
    fontSize: 16,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 24,
  },
  skipBtn: {
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 16,
    color: "#16A34A",
    fontWeight: "500",
  },
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
    paddingHorizontal: 16,
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
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: "#fafafa",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#f7f7f7",
  },
  chipText: { fontSize: 13, color: "#222" },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#bbb",
    opacity: 0.6,
  },
});
