import { useTheme } from "@/app/providers/ThemeProvider";
import { db } from "@/db";
import { useI18n } from "@/i18n/I18nProvider";
import { listAccounts } from "@/repos/accountRepo";
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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAudioRecorder } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
// ↓ Helper: lấy JSON từ chuỗi có thể lẫn text
function tryPickJson(text: string) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/); // lấy đoạn {...} đầu tiên
  try {
    return m ? JSON.parse(m[0]) : JSON.parse(text);
  } catch {
    return null;
  }
}

// ↓ Tạo câu fallback ngắn gọn khi GPT không parse được
function makeShortMsg(
  io: "IN" | "OUT",
  categoryName: string,
  amount: number | null,
  note: string
) {
  const money = amount ? amount.toLocaleString("vi-VN") + "đ" : "";
  if (io === "OUT")
    return `Đã ghi nhận chi ${money}${
      categoryName ? ` cho ${categoryName.toLowerCase()}` : ""
    }.`;
  return `Đã ghi nhận thu ${money}${
    categoryName ? ` vào ${categoryName.toLowerCase()}` : ""
  }.`;
}

async function getEmotionalReplyDirect(args: {
  io: "IN" | "OUT";
  categoryName: string;
  amount: number | null;
  note: string;
}): Promise<{
  message: string;
  categoryId?: string;
  amount: number | null;
  io: "IN" | "OUT";
  note: string;
}> {
  const { io, categoryName, amount, note } = args;

  const listCategoriesUser = await listCategories();
  const system = `
System: Bạn là trợ thủ tài chính của ứng dụng.
Trả về DUY NHẤT một JSON theo mẫu sau (không giải thích thêm bên ngoài JSON):
{
  "amount": number | null,
  "io": "IN" | "OUT",
  "categoryId": string | null,
  "note": string,
  "feature": "_taogiaodich",
  "message": string
}
- "message": 1–2 câu tiếng Việt tự nhiên mô tả giao dịch (không kèm JSON).
- Nếu không chắc categoryId, có thể để null.
Danh mục hiện có:
${listCategoriesUser.map((c) => `- ${c.id}: ${c.name}`).join("\n")}
  `.trim();

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: note },
        ],
        temperature: 0.7,
        max_tokens: 120,
      }),
    });
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const j = tryPickJson(raw);

    if (j?.message) {
      return {
        message: String(j.message),
        categoryId: j.categoryId ?? undefined,
        amount: typeof j.amount === "number" ? j.amount : amount,
        io: j.io === "IN" || j.io === "OUT" ? j.io : io,
        note: String(j.note ?? note),
      };
    }
  } catch {}

  // Fallback: không parse được JSON → tự tạo câu ngắn
  return {
    message: makeShortMsg(io, categoryName, amount, note),
    categoryId: undefined,
    amount,
    io,
    note,
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
    </View>
  );
}

/* ---------------- OCR: Extract text from receipt image using Vision API ---------------- */
async function processReceiptImage(imageUri: string): Promise<{
  amount: number | null;
  text: string;
  merchantName?: string;
}> {
  try {
    // TODO: Replace with your Google Cloud Vision API key or similar OCR service
    const VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY || "";

    // Read image as base64
    const response = await fetch(imageUri);
    const blob = await response.blob();
    const reader = new FileReader();

    const base64Image = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]); // Remove data:image/jpeg;base64, prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Call Google Vision API for OCR
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [{ type: "TEXT_DETECTION" }],
            },
          ],
        }),
      }
    );

    const visionData = await visionResponse.json();
    const fullText = visionData.responses?.[0]?.fullTextAnnotation?.text || "";

    // Extract amount using regex (tìm số tiền trong OCR text)
    const amountMatch = fullText.match(
      /(?:total|tổng|cộng|t\.tiền|thanh toán)[\s:]*([0-9,.]+)/i
    );
    const amount = amountMatch ? parseAmountVN(amountMatch[1]) : null;

    // Extract merchant name (first line usually)
    const lines = fullText.split("\n").filter((l: string) => l.trim());
    const merchantName = lines[0] || "";

    return {
      amount,
      text: fullText,
      merchantName,
    };
  } catch (error) {
    console.error("OCR Error:", error);
    return { amount: null, text: "", merchantName: "" };
  }
}

/* ---------------- Voice: Transcribe audio to text using Speech-to-Text API ---------------- */
async function transcribeAudio(audioUri: string): Promise<string> {
  try {
    // TODO: Use Google Speech-to-Text API or similar
    const SPEECH_API_KEY = process.env.GOOGLE_SPEECH_API_KEY || "";

    // Read audio file as base64
    const response = await fetch(audioUri);
    const blob = await response.blob();
    const reader = new FileReader();

    const base64Audio = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Call Google Speech-to-Text API
    const speechResponse = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${SPEECH_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: "vi-VN", // Vietnamese
          },
          audio: { content: base64Audio },
        }),
      }
    );

    const speechData = await speechResponse.json();
    const transcript =
      speechData.results?.[0]?.alternatives?.[0]?.transcript || "";

    return transcript;
  } catch (error) {
    console.error("Speech-to-Text Error:", error);
    return "";
  }
}

/* ---------------- Helpers: VN money + IN/OUT ---------------- */
const parseAmountVN = (text: string): number | null => {
  const t = text.toLowerCase().replace(/[,\.](?=\d{3}\b)/g, "");
  const m = t.match(
    /(\d+(?:[.,]\d+)?)(?:\s*(k|nghìn|ngan|tr|triệu|trieu|đ|vnd))?/i
  );
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  const unit = (m[2] || "").toLowerCase();
  const factor =
    unit.startsWith("k") || unit.startsWith("ng")
      ? 1e3
      : unit.startsWith("tr") || unit.startsWith("tri")
      ? 1e6
      : 1;
  return Math.round(n * factor);
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
  if (/(an|uống|uong|cafe|ca phe|coffee|food)/.test(s))
    return ["an", "uong", "tra sua", "cafe", "ca phe", "nha hang", "foody"];
  if (/(di chuyen|xang|transport|grab|be|taxi|xe)/.test(s))
    return ["grab", "taxi", "be", "xang", "bus", "tau"];
  if (/(mua sam|shopping|quan ao|giay)/.test(s))
    return ["shopee", "tiki", "lazada", "quan ao", "giay", "mall"];
  if (/(hoa don|dien|nuoc|internet|wifi)/.test(s))
    return ["dien", "nuoc", "internet", "wifi", "viettel", "vnpt"];
  if (/(nha cua|thue nha|chung cu|coc nha)/.test(s))
    return ["tien nha", "thue nha", "coc nha", "chung cu"];
  if (/(thu nhap|luong|income)/.test(s))
    return ["luong", "thu nhap", "bonus", "thuong", "chuyen vao"];
  return tokens(name);
};
const heuristicScore = (text: string, cat: Category, io: "IN" | "OUT") => {
  const tks = tokens(text);
  const kw = [
    ...((cat as any).keywords || []),
    ...((cat as any).aliases || []),
    ...((cat as any).tags || []),
    ...defaultKeywordsByName(cat.name || ""),
  ].map(normalizeVN);
  const A = kw.some((k) => normalizeVN(text).includes(k)) ? 1 : 0;
  const B = jaccard(tks, tokens(cat.name));
  const C = ngramOverlap(text, cat.name, 3);
  const D =
    io === "IN" && /thu nhap|luong/.test(normalizeVN(cat.name))
      ? 0.2
      : io === "OUT" &&
        /(hoa don|dien|nuoc|internet|wifi|mua sam|an uong|di chuyen|xang)/.test(
          normalizeVN(cat.name)
        )
      ? 0.1
      : 0;
  return 0.45 * A + 0.25 * B + 0.2 * C + 0.1 * D;
};

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
}) {
  if (!draft.amount || draft.amount <= 0) {
    throw new Error("Số tiền chưa hợp lệ.");
  }
  if (!draft.categoryId) {
    throw new Error("Chưa có danh mục để tạo giao dịch.");
  }

  // chọn account mặc định: ưu tiên include_in_total=1 rồi đến account đầu tiên
  const accounts = await listAccounts().catch(() => []);
  const acc =
    accounts.find((a: any) => a.include_in_total === 1) || accounts[0] || null;
  if (!acc?.id) throw new Error("Chưa có tài khoản để ghi giao dịch.");

  const common = {
    accountId: acc.id as string,
    categoryId: draft.categoryId as string,
    amount: draft.amount,
    note: draft.note,
    when: new Date(),
    updatedAt: new Date(),
  };

  const id =
    draft.io === "OUT"
      ? await addExpense(common as any)
      : await addIncome(common as any);

  return { id, ...draft, accountId: acc.id };
}

/* ---------------- Chat types ---------------- */
type Msg =
  | { role: "bot"; text: string }
  | { role: "user"; text: string }
  | { role: "typing" }
  | {
      role: "card";
      transactionId: string;
      accountId: string;
      amount: number | null;
      io: "IN" | "OUT";
      categoryId: string;
      categoryName: string;
      note: string;
      when: string;
    };

/* ---------------- Component ---------------- */
export default function Chatbox() {
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

  // Voice & Image states
  const audioRecorder = useAudioRecorder(
    {
      android: {
        extension: ".m4a",
        outputFormat: "mpeg4",
        audioEncoder: "aac",
        sampleRate: 16000,
      },
      ios: {
        extension: ".m4a",
        audioQuality: 0x60,
        sampleRate: 16000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      extension: ".m4a",
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 128000,
    },
    (status) => {
      console.log("Recording status:", status);
    }
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  const load = useCallback(async () => {
    await seedCategoryDefaults();
    const rows = await listCategories();
    setItems(rows);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

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
        const nowSec = Math.floor(Date.now() / 1000);
        const fromSec = nowSec - 90 * 86400;
        const rows = await db.getAllAsync<{
          category_id: string | null;
          type: string;
          cnt: number;
        }>(
          `SELECT category_id, type, COUNT(*) as cnt
           FROM transactions
           WHERE user_id='u_demo' AND occurred_at>=${fromSec} AND occurred_at<=${nowSec}
           GROUP BY category_id, type`
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

  // Core: classify to user's categories
  function classifyToUserCategories(text: string) {
    const io = detectInOut(text);

    // 1) Nếu có ML: lấy top labels → map sang danh mục user → rerank
    if (model) {
      const mlRank = lrPredict(text, model); // [{label, p} ...]
      const mapped = mlRank
        .slice(0, 6) // lấy ~6 nhãn đầu
        .map((r) => {
          const m = mapMLToUserCategory(r.label, items);
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
        const hs = items.map((c) => {
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
    const hs = items.map((c) => {
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

  // ⬇️ Trong handleSend, đổi phần “tạo giao dịch” để fallback sang pendingPick khi chưa chắc danh mục:
  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    scrollToEnd();

    const { io, ranked } = classifyToUserCategories(text);
    const best = ranked[0];
    const amount = parseAmountVN(text);

    setMessages((m) => [...m, { role: "typing" }]);
    scrollToEnd();

    const ai = await getEmotionalReplyDirect({
      io,
      categoryName: best?.name || (io === "IN" ? "Thu nhập" : "Chi tiêu"),
      amount,
      note: text,
    });

    // Quyết định danh mục cuối:
    const finalCategoryId = ai.categoryId || best?.categoryId;
    const finalCategoryName =
      items.find((c) => c.id === finalCategoryId)?.name ||
      best?.name ||
      "Chưa rõ";

    // Hiển thị câu phản hồi ngắn gọn
    setMessages((m) => [
      ...m.filter((x) => x.role !== "typing"),
      { role: "bot", text: ai.message },
    ]);
    scrollToEnd();

    // Nếu chưa có amount → nhắn nhắc người dùng bổ sung và dừng
    if (!ai.amount || ai.amount <= 0) {
      setMessages((m) => [...m, { role: "bot", text: t("askAmount") }]);
      scrollToEnd();
      return;
    }

    // Nếu chưa có categoryId HOẶC điểm tự tin thấp → bật gợi ý chọn danh mục
    const confidence = best?.score ?? 0;
    const lowConfidence = confidence < 0.4; // threshold can be tuned

    // Log initial prediction
    try {
      pendingLogId.current = await logPrediction({
        text,
        amount: ai.amount ?? null,
        io,
        predictedCategoryId: best?.categoryId || null,
        confidence,
      });
    } catch {}
    if (!finalCategoryId || lowConfidence) {
      setPendingPick({
        text,
        amount: ai.amount,
        io: ai.io,
        choices: ranked.slice(0, 6), // tối đa 6 gợi ý
      });
      return; // đợi user chọn trước khi tạo
    }

    // Đủ dữ kiện → tạo giao dịch
    try {
      const txn = await createTransaction({
        amount: ai.amount,
        io: ai.io,
        categoryId: finalCategoryId,
        note: ai.note,
      });

      const when = new Date().toLocaleDateString();
      setMessages((m) => [
        ...m,
        {
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io: ai.io,
          categoryId: finalCategoryId,
          categoryName: finalCategoryName,
          note: ai.note,
          when,
        },
      ]);
      // If user did not correct (direct accept), log correction equal to prediction
      try {
        if (pendingLogId.current && finalCategoryId) {
          await logCorrection({
            id: pendingLogId.current,
            chosenCategoryId: finalCategoryId,
          });
          pendingLogId.current = null;
        }
      } catch {}
      scrollToEnd();
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text:
            "Tạo giao dịch thất bại. " +
            (e?.message ? `(${e.message})` : "Vui lòng thử lại."),
        },
      ]);
    }
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
    categoryId: string;
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
    const txn = await createTransaction({
      amount: pendingPick.amount,
      io: pendingPick.io,
      categoryId: c.categoryId,
      note: pendingPick.text,
    });
    const when = new Date().toLocaleDateString();
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

  // ----- Voice Recording Handler -----
  const handleVoicePress = async () => {
    try {
      if (isRecording) {
        // Stop recording
        setIsRecording(false);
        if (!audioRecorder.isRecording) return;

        await audioRecorder.stop();
        const uri = audioRecorder.uri;
        if (!uri) return;

        // Show processing message
        setIsProcessingVoice(true);
        setMessages((m) => [
          ...m,
          { role: "bot", text: "🎤 Đang xử lý giọng nói..." },
        ]);

        // Transcribe audio to text
        const transcript = await transcribeAudio(uri);

        if (!transcript || transcript.trim() === "") {
          setMessages((m) => [
            ...m.slice(0, -1),
            {
              role: "bot",
              text: "❌ Không thể nhận diện giọng nói. Vui lòng thử lại.",
            },
          ]);
          setIsProcessingVoice(false);
          return;
        }

        // Remove processing message and add user message
        setMessages((m) => [
          ...m.slice(0, -1),
          { role: "user", text: transcript },
        ]);
        setIsProcessingVoice(false);

        // Process using existing classification logic
        const { io, ranked } = classifyToUserCategories(transcript);
        const best = ranked[0];
        const amount = parseAmountVN(transcript);

        setMessages((m) => [...m, { role: "typing" }]);
        scrollToEnd();

        const ai = await getEmotionalReplyDirect({
          io,
          categoryName: best?.name || (io === "IN" ? "Thu nhập" : "Chi tiêu"),
          amount,
          note: transcript,
        });

        const finalCategoryId = ai.categoryId || best?.categoryId;
        const confidence = best?.score ?? 0;

        setMessages((m) => [
          ...m.filter((x) => x.role !== "typing"),
          { role: "bot", text: ai.message },
        ]);
        scrollToEnd();

        if (!ai.amount || ai.amount <= 0) {
          setMessages((m) => [...m, { role: "bot", text: t("askAmount") }]);
          scrollToEnd();
          return;
        }

        // Log prediction
        try {
          pendingLogId.current = await logPrediction({
            text: transcript,
            amount: ai.amount ?? null,
            io,
            predictedCategoryId: best?.categoryId || null,
            confidence,
          });
        } catch {}

        if (!finalCategoryId || confidence < 0.4) {
          setPendingPick({
            text: transcript,
            amount: ai.amount,
            io: ai.io,
            choices: ranked.slice(0, 6),
          });
          return;
        }

        // Create transaction
        const txn = await createTransaction({
          amount: ai.amount,
          io: ai.io,
          categoryId: finalCategoryId,
          note: ai.note,
        });

        const when = new Date().toLocaleDateString();
        const finalCategoryName =
          items.find((c) => c.id === finalCategoryId)?.name ||
          best?.name ||
          "Chưa rõ";

        setMessages((m) => [
          ...m,
          {
            role: "card",
            transactionId: txn.id,
            accountId: txn.accountId,
            amount: txn.amount ?? null,
            io: ai.io,
            categoryId: finalCategoryId,
            categoryName: finalCategoryName,
            note: ai.note,
            when,
          },
        ]);

        try {
          if (pendingLogId.current) {
            await logCorrection({
              id: pendingLogId.current,
              chosenCategoryId: finalCategoryId,
            });
            pendingLogId.current = null;
          }
        } catch {}
        scrollToEnd();
      } else {
        // Start recording
        await audioRecorder.record();
        setIsRecording(true);

        // Show recording message
        setMessages((m) => [
          ...m,
          { role: "bot", text: "🎤 Đang ghi âm... Nhấn lại để dừng." },
        ]);
      }
    } catch (error) {
      console.error("Voice error:", error);
      Alert.alert("Lỗi", "Không thể ghi âm. Vui lòng thử lại.");
      setIsRecording(false);
      setIsProcessingVoice(false);
    }
  };

  // ----- Image Receipt Handler -----
  const handleImagePress = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Quyền truy cập", "Cần quyền truy cập thư viện ảnh");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images" as any,
        allowsEditing: true,
        quality: 1,
      });

      if (result.canceled) return;
      const imageUri = result.assets[0].uri;

      setIsProcessingImage(true);
      setMessages((m) => [
        ...m,
        { role: "bot", text: "📷 Đang phân tích hóa đơn..." },
      ]);

      // Process receipt image with OCR
      const ocrResult = await processReceiptImage(imageUri);

      if (!ocrResult.amount && !ocrResult.text) {
        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "bot",
            text: "❌ Không thể đọc hóa đơn. Vui lòng thử ảnh khác.",
          },
        ]);
        setIsProcessingImage(false);
        return;
      }

      // Build transaction text from OCR
      const merchantText = ocrResult.merchantName || "hóa đơn";
      const amountText = ocrResult.amount
        ? `${ocrResult.amount.toLocaleString("vi-VN")}đ`
        : "";
      const transactionText = `${merchantText} ${amountText}`;

      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "user", text: `📷 ${transactionText}` },
      ]);
      setIsProcessingImage(false);

      // Process using existing classification logic (always OUT for receipts)
      const { ranked } = classifyToUserCategories(transactionText);
      const best = ranked[0];
      const amount = ocrResult.amount || parseAmountVN(transactionText);
      const io = "OUT"; // Receipts are always expenses

      setMessages((m) => [...m, { role: "typing" }]);
      scrollToEnd();

      const ai = await getEmotionalReplyDirect({
        io,
        categoryName: best?.name || "Chi tiêu",
        amount,
        note: transactionText,
      });

      const finalCategoryId = ai.categoryId || best?.categoryId;
      const confidence = best?.score ?? 0;

      setMessages((m) => [
        ...m.filter((x) => x.role !== "typing"),
        { role: "bot", text: ai.message },
      ]);
      scrollToEnd();

      if (!ai.amount || ai.amount <= 0) {
        setMessages((m) => [...m, { role: "bot", text: t("askAmount") }]);
        scrollToEnd();
        return;
      }

      // Log prediction
      try {
        pendingLogId.current = await logPrediction({
          text: transactionText,
          amount: ai.amount ?? null,
          io,
          predictedCategoryId: best?.categoryId || null,
          confidence,
        });
      } catch {}

      if (!finalCategoryId || confidence < 0.4) {
        setPendingPick({
          text: transactionText,
          amount: ai.amount,
          io: ai.io,
          choices: ranked.slice(0, 6),
        });
        return;
      }

      // Create transaction
      const txn = await createTransaction({
        amount: ai.amount,
        io: ai.io,
        categoryId: finalCategoryId,
        note: ai.note,
      });

      const when = new Date().toLocaleDateString();
      const finalCategoryName =
        items.find((c) => c.id === finalCategoryId)?.name ||
        best?.name ||
        "Chưa rõ";

      setMessages((m) => [
        ...m,
        {
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io: ai.io,
          categoryId: finalCategoryId,
          categoryName: finalCategoryName,
          note: ai.note,
          when,
        },
      ]);

      try {
        if (pendingLogId.current) {
          await logCorrection({
            id: pendingLogId.current,
            chosenCategoryId: finalCategoryId,
          });
          pendingLogId.current = null;
        }
      } catch {}
      scrollToEnd();
    } catch (error) {
      console.error("Image OCR error:", error);
      Alert.alert("Lỗi", "Không thể xử lý ảnh. Vui lòng thử lại.");
      setIsProcessingImage(false);
    }
  };

  // ----- Process text input (shared by voice, image, and text) -----
  const processTextInput = async (text: string) => {
    const userText = text.trim();
    if (!userText) return;

    // Add typing indicator
    setMessages((m) => [...m, { role: "typing" }]);
    scrollToEnd();

    // Parse and classify
    const amt = parseAmountVN(userText);
    const { io, ranked } = classifyToUserCategories(userText);

    if (!ranked || ranked.length === 0) {
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "bot",
          text: t("askAmount"),
        },
      ]);
      return;
    }

    const topPred = ranked[0];
    if (topPred.score >= 0.6) {
      // Auto-create with high confidence
      await autoCreateTransaction(userText, amt, io, topPred.categoryId);
    } else {
      // Show suggestions
      setMessages((m) => m.slice(0, -1));
      setPendingPick({
        text: userText,
        amount: amt,
        io,
        choices: ranked.slice(0, 3),
      });
    }
  };

  // ----- Auto create transaction -----
  const autoCreateTransaction = async (
    text: string,
    amount: number | null,
    io: "IN" | "OUT",
    categoryId: string
  ) => {
    try {
      const txn = await createTransaction({
        amount,
        io,
        categoryId,
        note: text,
      });

      const categoryName =
        items.find((c) => c.id === categoryId)?.name || "Unknown";
      const when = new Date().toLocaleDateString();

      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io,
          categoryId,
          categoryName,
          note: text,
          when,
        },
      ]);
      scrollToEnd();
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text: "Tạo giao dịch thất bại. " + (e?.message || ""),
        },
      ]);
    }
  };

  // Edit transaction handlers
  const handleEditTransaction = (item: Extract<Msg, { role: "card" }>) => {
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
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={"padding"}
      >
        <BackBar />

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
                  <View style={styles.iconCircle}>
                    <MaterialCommunityIcons
                      name="wallet"
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
                    gap: 8,
                    marginTop: 12,
                    justifyContent: "flex-end",
                  }}
                >
                  <TouchableOpacity
                    onPress={() => handleEditTransaction(item)}
                    style={[
                      styles.actionBtn,
                      {
                        borderColor: colors.divider,
                        backgroundColor:
                          mode === "dark" ? colors.card : "#f9f9f9",
                      },
                    ]}
                  >
                    <Ionicons name="create-outline" size={18} color="#3B82F6" />
                    <Text style={{ color: "#3B82F6", fontSize: 13 }}>
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
                        borderColor: colors.divider,
                        backgroundColor:
                          mode === "dark" ? colors.card : "#f9f9f9",
                      },
                    ]}
                  >
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    <Text style={{ color: "#EF4444", fontSize: 13 }}>
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
            {pendingPick.choices.map((c) => (
              <Pressable
                key={c.categoryId}
                onPress={() => chooseCategory(c)}
                style={[
                  styles.chip,
                  { borderColor: colors.divider, backgroundColor: colors.card },
                ]}
              >
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
            { borderColor: colors.divider, backgroundColor: colors.card },
          ]}
        >
          {/* Voice button */}
          <Pressable
            style={[
              styles.iconBtn,
              {
                backgroundColor: isRecording
                  ? "#EF4444"
                  : mode === "dark"
                  ? colors.background
                  : "#F3F4F6",
                borderColor: colors.divider,
              },
            ]}
            onPress={handleVoicePress}
            disabled={isProcessingVoice || isProcessingImage}
          >
            <Ionicons
              name={isRecording ? "stop-circle" : "mic"}
              size={22}
              color={isRecording ? "#fff" : colors.icon}
            />
          </Pressable>

          {/* Image button */}
          <Pressable
            style={[
              styles.iconBtn,
              {
                backgroundColor:
                  mode === "dark" ? colors.background : "#F3F4F6",
                borderColor: colors.divider,
              },
            ]}
            onPress={handleImagePress}
            disabled={isProcessingVoice || isProcessingImage}
          >
            <Ionicons name="image" size={22} color={colors.icon} />
          </Pressable>

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
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e5ea",
    backgroundColor: "#f9f9f9",
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
