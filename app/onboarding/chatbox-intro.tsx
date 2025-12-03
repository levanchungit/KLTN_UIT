import { useTheme } from "@/app/providers/ThemeProvider";
import { db } from "@/db";
import { useI18n } from "@/i18n/I18nProvider";
import {
  listCategories,
  seedCategoryDefaults,
  type Category,
} from "@/repos/categoryRepo";
import { logCorrection } from "@/repos/mlRepo";
import { deleteTx, updateTransaction } from "@/repos/transactionRepo";
import { transactionClassifier } from "@/services/transactionClassifier";
import { getCurrentUserId } from "@/utils/auth";
import { fixIconName } from "@/utils/iconMapper";
import { parseTransactionText } from "@/utils/textPreprocessing";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
// import Voice from "@react-native-voice/voice";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
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
import { SafeAreaView } from "react-native-safe-area-context";

const OPENAI_API_KEY =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_OPENAI_API_KEY || "";
const OCR_SPACE_API_KEY =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_OCR_SPACE_API_KEY || "";

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

/* ---------------- Chat types ---------------- */
type Msg =
  | { role: "bot"; text: string }
  | { role: "user"; text: string; imageUri?: string }
  | { role: "typing" }
  | {
      role: "card";
      transactionId: string;
      accountId: string;
      amount: number | null;
      io: "IN" | "OUT";
      categoryId: string;
      categoryName: string;
      categoryIcon?: string;
      categoryColor?: string;
      note: string;
      when: string;
    };

/* ---------------- Demo Helper Functions ---------------- */
const parseAmountVN = (text: string): number | null => {
  if (!text || typeof text !== "string") return null;

  // Remove common non-numeric characters but keep numbers, dots, commas
  const cleaned = text.replace(/[^\d.,ktrmđvnd]/gi, " ").trim();

  // Try to find number patterns
  // Pattern 1: 123,456 or 123.456 (Vietnamese thousand separator)
  const pattern1 = cleaned.match(/(\d{1,3}([,\.]\d{3})+)/g);
  if (pattern1) {
    const num = parseFloat(pattern1[0].replace(/[,.]/g, ""));
    if (!isNaN(num) && num > 0) return Math.round(num);
  }

  // Pattern 2: Simple numbers with units (25k, 100tr)
  const pattern2 = text.match(
    /(\d+(?:[.,]\d+)?)\s*(k|nghìn|ng|tr|triệu|trieu|m)/i
  );
  if (pattern2) {
    const num = parseFloat(pattern2[1].replace(",", "."));
    const unit = pattern2[2].toLowerCase();
    const factor =
      unit[0] === "k" || unit[0] === "n"
        ? 1000
        : unit[0] === "t" || unit[0] === "m"
        ? 1000000
        : 1;
    return Math.round(num * factor);
  }

  // Pattern 3: Any sequence of digits (fallback)
  const pattern3 = cleaned.match(/\d+/g);
  if (pattern3) {
    // Take the longest number
    const longest = pattern3.sort((a, b) => b.length - a.length)[0];
    const num = parseInt(longest);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
};

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

export default function ChatboxIntro() {
  const { t } = useI18n();
  const { colors, mode } = useTheme();

  const [items, setItems] = useState<Category[]>([]);
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

  // Keyboard state
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Voice states
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isVoiceAvailable, setIsVoiceAvailable] = useState(false);

  // Image viewer states
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

  const load = useCallback(async () => {
    await seedCategoryDefaults();
    const rows = await listCategories();
    setItems(rows);

    // Auto-train AI silently in background if needed
    transactionClassifier.trainModel(false).catch((err: any) => {
      console.log("Background AI training failed:", err);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Listen to keyboard events
  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboardHeight(0);
      }
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Load simple LR model (JSON). If missing, fallback heuristics still work.
        const mod = require("../../assets/models/lr-vn-shopping.json");
        setModel(mod as unknown as LRModel);
      } catch (e) {
        console.warn(
          "⚠️ Không tìm thấy mô hình LR; dùng heuristic fallback.",
          e
        );
        setModel(null);
      }
    })();
  }, []);

  // Build simple category priors from user's history (last 90 days), separated by IN/OUT
  useEffect(() => {
    (async () => {
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
        // Normalize and apply small smoothing
        const norm = (m: Record<string, number>, sum: number) => {
          const out: Record<string, number> = {};
          const denom = sum + 1e-6;
          Object.entries(m).forEach(([k, v]) => {
            out[k] = v / denom;
          });
          return out;
        };
        setPriors({ IN: norm(inP, sumIn), OUT: norm(outP, sumOut) });
      } catch (e) {
        // ignore priors if query fails
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const scrollToEnd = () =>
    requestAnimationFrame(() =>
      flatRef.current?.scrollToEnd({ animated: true })
    );

  // Core: classify to user's categories with AI
  async function classifyToUserCategoriesAI(text: string) {
    const io = detectInOut(text);

    // Filter categories by io type using the 'type' field
    const filteredItems = items.filter((c) => {
      // Match category type with transaction type
      if (io === "IN") {
        return c.type === "income";
      } else {
        return c.type === "expense";
      }
    });

    // If no filtered items, use all items as fallback
    const relevantItems = filteredItems.length > 0 ? filteredItems : items;

    // Try AI prediction first
    try {
      const aiPrediction = await transactionClassifier.predictCategory(text);

      if (aiPrediction && aiPrediction.confidence > 0.2) {
        // AI has a prediction, combine with heuristic scores
        const aiCategory = relevantItems.find(
          (c) => c.id === aiPrediction.categoryId
        );

        if (aiCategory) {
          // Calculate scores combining AI + heuristic for ALL categories
          const allScores = relevantItems.map((c) => {
            const heuristicBase = heuristicScore(text, c, io);
            const priorMap = io === "IN" ? priors.IN : priors.OUT;
            const prior = priorMap[c.id] || 0;
            const heuristicFinal = 0.9 * heuristicBase + 0.1 * prior;

            if (c.id === aiCategory.id) {
              // For AI-predicted category: blend AI confidence with heuristic
              // Give more weight to AI (70%) but still consider heuristic (30%)
              const blendedScore =
                0.7 * aiPrediction.confidence + 0.3 * heuristicFinal;
              return {
                categoryId: c.id,
                name: c.name,
                score: blendedScore,
              };
            } else {
              // For other categories, use heuristic only
              return {
                categoryId: c.id,
                name: c.name,
                score: heuristicFinal,
              };
            }
          });

          // Sort all scores and take top results
          const ranked = allScores
            .sort((a, b) => b.score - a.score)
            .slice(0, 6);

          console.log(
            `AI Prediction: ${aiCategory.name} (${(
              aiPrediction.confidence * 100
            ).toFixed(1)}%), Top suggestion: ${ranked[0].name} (${(
              ranked[0].score * 100
            ).toFixed(1)}%)`
          );
          return { io, ranked };
        }
      }
    } catch (error) {
      console.log("AI prediction failed, falling back to heuristic:", error);
    }

    // Fallback to existing ML or heuristic
    // 1) Nếu có ML: lấy top labels → map sang danh mục user → rerank
    if (model) {
      const mlRank = lrPredict(text, model); // [{label, p} ...]
      const mapped = mlRank
        .slice(0, 6) // lấy ~6 nhãn đầu
        .map((r) => {
          const m = mapMLToUserCategory(r.label, relevantItems);
          if (!m) return null;
          // Kết hợp điểm ML và độ giống tên danh mục
          let score = 0.8 * r.p + 0.2 * m.sim;
          // Áp dụng prior từ lịch sử người dùng
          const priorMap = io === "IN" ? priors.IN : priors.OUT;
          const prior = priorMap[m.category.id] || 0;
          score = 0.85 * score + 0.15 * prior;
          return { categoryId: m.category.id, name: m.category.name, score };
        })
        .filter(Boolean) as {
        categoryId: string;
        name: string;
        score: number;
      }[];

      // Nếu mapping trùng id, giữ điểm cao nhất
      const byId = new Map<
        string,
        { categoryId: string; name: string; score: number }
      >();
      for (const r of mapped) {
        const prev = byId.get(r.categoryId);
        if (!prev || r.score > prev.score) byId.set(r.categoryId, r);
      }
      const tmp: { categoryId: string; name: string; score: number }[] = [];
      byId.forEach((v) => tmp.push(v));
      const arr = tmp.sort((a, b) => b.score - a.score);

      // Nếu mỏng quá (ít khớp), trộn thêm heuristic để an toàn
      if (arr.length < 2) {
        const hs = relevantItems.map((c) => {
          const base = heuristicScore(text, c, io);
          const priorMap = io === "IN" ? priors.IN : priors.OUT;
          const prior = priorMap[c.id] || 0;
          return {
            categoryId: c.id,
            name: c.name,
            score: 0.9 * base + 0.1 * prior,
          };
        });
        hs.sort((a, b) => b.score - a.score);
        return { io, ranked: [...arr, ...hs].slice(0, 5) };
      }
      return { io, ranked: arr };
    }

    // 2) Fallback: heuristic thuần
    const hs = relevantItems.map((c) => {
      const base = heuristicScore(text, c, io);
      const priorMap = io === "IN" ? priors.IN : priors.OUT;
      const prior = priorMap[c.id] || 0;
      return {
        categoryId: c.id,
        name: c.name,
        score: 0.9 * base + 0.1 * prior,
      };
    });
    hs.sort((a, b) => b.score - a.score);
    return { io, ranked: hs };
  }

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    scrollToEnd();

    // Process using unified logic from chatbox.tsx
    await processTextInput(text);
  };

  // ----- Gợi ý khi chưa đủ tự tin -----
  const [pendingPick, setPendingPick] = useState<{
    text: string;
    amount: number | null;
    io: "IN" | "OUT";
    choices: { categoryId: string; name: string; score: number }[];
  } | null>(null);
  const pendingLogId = useRef<string | null>(null);

  // Edit transaction state
  const [editingTx, setEditingTx] = useState<{
    transactionId: string;
    accountId: string;
    io: "IN" | "OUT";
    amount: number;
    note: string;
    when: Date;
  } | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");

  const chooseCategory = async (c: { categoryId: string; name: string }) => {
    if (!pendingPick) return;

    // Tạo demo transaction thay vì transaction thật
    const when = new Date().toLocaleDateString();
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
    // Log correction (user choice overriding prediction)
    try {
      if (pendingLogId.current) {
        await logCorrection({
          id: pendingLogId.current,
          chosenCategoryId: c.categoryId,
        });
        pendingLogId.current = null;
      }
    } catch {}
    setPendingPick(null);
    scrollToEnd();
  };

  const processingTextRef = useRef(false);
  const processTextInput = async (text: string) => {
    const userText = text.trim();
    if (!userText) return;

    // Prevent concurrent processing
    if (processingTextRef.current) return;
    processingTextRef.current = true;

    try {
      // Add typing indicator
      setMessages((m) => {
        const last = m[m.length - 1];
        if (last && last.role === "typing") return m;
        return [...m, { role: "typing" }];
      });
      scrollToEnd();

      // Parse amount and clean note from text
      const parsed = parseTransactionText(userText);
      const cleanNote = parsed.note || userText;
      const parsedAmount = parsed.amount;
      const amt = parsedAmount || parseAmountVN(userText);

      // Classify with AI
      const { io, ranked } = await classifyToUserCategoriesAI(cleanNote);

      if (!ranked || ranked.length === 0) {
        setMessages((m) => [
          ...m.slice(0, -1),
          { role: "bot", text: t("askAmount") },
        ]);
        return;
      }

      const topPred = ranked[0];

      // Check confidence
      const confidence = topPred.score ?? 0;
      const lowConfidence = confidence < 0.3;

      // If low confidence or no amount, show suggestions
      if (!amt || amt <= 0 || lowConfidence) {
        setMessages((m) => m.slice(0, -1));
        setPendingPick({
          text: cleanNote,
          amount: amt,
          io,
          choices: ranked.slice(0, 4),
        });
        return;
      }

      // Auto-create demo transaction with high confidence
      const selectedCategory = items.find((c) => c.id === topPred.categoryId);
      const categoryName = selectedCategory?.name || "Unknown";
      const when = new Date().toLocaleDateString("vi-VN");

      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "card",
          transactionId: `demo-${Date.now()}`,
          accountId: "demo-account",
          amount: amt ?? null,
          io,
          categoryId: topPred.categoryId,
          categoryName,
          categoryIcon: selectedCategory?.icon || "wallet",
          categoryColor: selectedCategory?.color || "#6366F1",
          note: cleanNote,
          when,
        },
      ]);
      scrollToEnd();
    } finally {
      processingTextRef.current = false;
    }
  };

  // Edit transaction handlers
  const handleEditTransaction = (item: Extract<Msg, { role: "card" }>) => {
    // Ensure io is properly set from the card data
    const txType = item.io || "OUT"; // default to OUT if not set
    setEditingTx({
      transactionId: item.transactionId,
      accountId: item.accountId,
      io: txType,
      amount: item.amount || 0,
      note: item.note,
      when: new Date(),
    });
    setEditAmount(String(item.amount || 0));
    setEditNote(item.note);
    setEditCategoryId(item.categoryId);
  };

  const handleSaveEdit = async () => {
    if (!editingTx) return;
    const newAmount = parseFloat(editAmount);
    if (!newAmount || newAmount <= 0) {
      alert("Số tiền không hợp lệ");
      return;
    }

    if (!editCategoryId) {
      alert("Vui lòng chọn danh mục");
      return;
    }

    try {
      await updateTransaction({
        id: editingTx.transactionId,
        accountId: editingTx.accountId,
        categoryId: editCategoryId,
        type: editingTx.io === "OUT" ? "expense" : "income",
        amount: newAmount,
        note: editNote,
        when: editingTx.when,
      });

      // Update message in chat - bao gồm cả io type
      setMessages((msgs) =>
        msgs.map((m) =>
          m.role === "card" && m.transactionId === editingTx.transactionId
            ? {
                ...m,
                amount: newAmount,
                note: editNote,
                categoryId: editCategoryId,
                io: editingTx.io, // Update io type
                categoryName:
                  items.find((c) => c.id === editCategoryId)?.name ||
                  m.categoryName,
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
    }
  };

  const handleDeleteTransaction = async (transactionId: string) => {
    try {
      await deleteTx(transactionId);
      // Remove from messages
      setMessages((msgs) =>
        msgs.filter(
          (m) => m.role !== "card" || m.transactionId !== transactionId
        )
      );
    } catch (e: any) {
      alert("Không thể xóa: " + (e?.message || "Lỗi"));
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top", "bottom"]}
    >
      {/* Header with skip button */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => router.replace("/onboarding/reminder-setup")}
        >
          <Text style={styles.skipText}>Bỏ qua</Text>
        </TouchableOpacity>
      </View>

      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
        }}
      >
        {/* Title and Description in center */}
        <View style={styles.centerContent}>
          <Text style={[styles.title, { color: colors.text }]}>
            AI Phân loại giao dịch
          </Text>
          <Text style={[styles.desc, { color: colors.subText }]}>
            Nhập nội dung giao dịch để xem cách AI tự động phân loại và gợi ý
            danh mục phù hợp nhất.
          </Text>
        </View>

        {/* Chat */}
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => {
            if (item.role === "user") {
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
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedImage(item.imageUri!);
                        setImageViewerVisible(true);
                      }}
                    >
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
                    <Text style={[styles.text, { color: colors.text }]}>
                      {item.text}
                    </Text>
                  )}
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
                  <View
                    style={[styles.dot, { backgroundColor: colors.subText }]}
                  />
                  <View
                    style={[styles.dot, { backgroundColor: colors.subText }]}
                  />
                  <View
                    style={[styles.dot, { backgroundColor: colors.subText }]}
                  />
                </View>
              );
            }

            return (
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.divider },
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
                    onPress={() => handleEditTransaction(item)}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor:
                          mode === "dark" ? "#1E40AF" : "#DBEAFE",
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
          }}
        />

        {/* Gợi ý khi chưa đủ tự tin */}
        {pendingPick && (
          <View
            style={[styles.suggestBar, { backgroundColor: colors.background }]}
          >
            {pendingPick.choices.map((c, index) => (
              <Pressable
                key={c.categoryId}
                onPress={() => chooseCategory(c)}
                style={[
                  styles.chip,
                  {
                    borderColor:
                      index === 0 && c.score > 0.5 ? "#4CAF50" : colors.divider,
                    backgroundColor:
                      index === 0 && c.score > 0.5
                        ? "rgba(76, 175, 80, 0.1)"
                        : colors.card,
                    borderWidth: index === 0 && c.score > 0.5 ? 2 : 1,
                  },
                ]}
              >
                {index === 0 && c.score > 0.5 && (
                  <MaterialCommunityIcons
                    name="robot"
                    size={14}
                    color="#4CAF50"
                    style={{ marginRight: 4 }}
                  />
                )}
                <Text style={[styles.chipText, { color: colors.text }]}>
                  {c.name} · {Math.round(c.score * 100)}%
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Edit Modal */}
        <Modal
          visible={!!editingTx}
          transparent
          animationType="slide"
          onRequestClose={() => setEditingTx(null)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.5)",
              justifyContent: "flex-end",
            }}
          >
            <View
              style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 20,
                maxHeight: "80%",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: "700",
                    color: colors.text,
                  }}
                >
                  {t("editTransaction")}
                </Text>
                <TouchableOpacity onPress={() => setEditingTx(null)}>
                  <Ionicons name="close" size={24} color={colors.icon} />
                </TouchableOpacity>
              </View>

              <ScrollView>
                {/* Transaction Type Toggle */}
                <View style={{ marginBottom: 16 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      marginBottom: 8,
                      color: colors.text,
                    }}
                  >
                    Loại giao dịch
                  </Text>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => {
                        if (editingTx) {
                          setEditingTx({ ...editingTx, io: "OUT" });
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
                      <Text
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

                    <TouchableOpacity
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
                      <Text
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
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      marginBottom: 6,
                      color: colors.text,
                    }}
                  >
                    {t("amount")}
                  </Text>
                  <TextInput
                    value={editAmount}
                    onChangeText={setEditAmount}
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
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      marginBottom: 6,
                      color: colors.text,
                    }}
                  >
                    {t("note")}
                  </Text>
                  <TextInput
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
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      marginBottom: 6,
                      color: colors.text,
                    }}
                  >
                    {t("category")}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{
                      flexDirection: "row",
                      gap: 8,
                      paddingVertical: 4,
                    }}
                  >
                    {items
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
                            style={{
                              fontSize: 14,
                              fontWeight: "600",
                              color:
                                editCategoryId === cat.id
                                  ? "#10B981"
                                  : colors.text,
                            }}
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
                style={{
                  backgroundColor: "#10B981",
                  padding: 14,
                  borderRadius: 10,
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <Text
                  style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}
                >
                  {t("saveChanges")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Input */}
        <View
          style={[
            styles.inputBar,
            {
              borderColor: colors.divider,
              backgroundColor: colors.card,
              marginBottom: keyboardHeight > 0 ? keyboardHeight : 0,
            },
          ]}
        >
          <TextInput
            placeholder={t("inputPlaceholder")}
            placeholderTextColor={colors.subText}
            value={input}
            onChangeText={setInput}
            style={[
              styles.textInput,
              {
                borderColor: colors.divider,
                backgroundColor: colors.background,
                color: colors.text,
                flex: 1,
              },
            ]}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            style={[
              styles.sendBtn,
              { backgroundColor: mode === "dark" ? "#3B82F6" : "#111" },
            ]}
            onPress={handleSend}
          >
            <Text style={styles.sendText}>{t("send")}</Text>
          </Pressable>
        </View>

        {/* Image Viewer Modal */}
        <Modal
          visible={imageViewerVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setImageViewerVisible(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.9)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <TouchableOpacity
              style={{
                position: "absolute",
                top: 50,
                right: 20,
                zIndex: 10,
                backgroundColor: "rgba(255,255,255,0.3)",
                borderRadius: 25,
                width: 50,
                height: 50,
                justifyContent: "center",
                alignItems: "center",
              }}
              onPress={() => setImageViewerVisible(false)}
            >
              <Ionicons name="close" size={30} color="#fff" />
            </TouchableOpacity>

            {selectedImage && (
              <Image
                source={{ uri: selectedImage }}
                style={{
                  width: screenWidth,
                  height: screenHeight * 0.8,
                }}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>
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
