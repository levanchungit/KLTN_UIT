import {
  listCategories,
  seedCategoryDefaults,
  type Category,
} from "@/repos/categoryRepo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Pressable,
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
  return (
    <View
      style={{
        padding: 12,
        borderBottomWidth: 1,
        borderColor: "#eee",
        backgroundColor: "#fff",
      }}
    >
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MaterialCommunityIcons name="chevron-left" size={28} color="#111" />
        <Text style={{ fontSize: 16, fontWeight: "600" }}>Quay lại</Text>
      </TouchableOpacity>
    </View>
  );
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
  const A = new Set(a),
    B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
};
const ngramSet = (s: string, n = 3) => {
  const t = normalizeVN(s);
  const out = new Set<string>();
  for (let i = 0; i <= Math.max(0, t.length - n); i++)
    out.add(t.slice(i, i + n));
  return out;
};
const ngramOverlap = (a: string, b: string, n = 3) => {
  const A = ngramSet(a, n),
    B = ngramSet(b, n);
  const inter = [...A].filter((x) => B.has(x)).length;
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
async function createTransaction(draft: {
  amount: number | null;
  io: "IN" | "OUT";
  categoryId?: string;
  note: string;
}) {
  // TODO: thay bằng API backend thật
  await new Promise((r) => setTimeout(r, 250));
  return { id: Date.now().toString(), ...draft };
}

/* ---------------- Chat types ---------------- */
type Msg =
  | { role: "bot"; text: string }
  | { role: "user"; text: string }
  | { role: "typing" }
  | {
      role: "card";
      amount: number | null;
      io: "IN" | "OUT";
      categoryName: string;
      note: string;
      when: string;
    };

/* ---------------- Component ---------------- */
export default function Chatbox() {
  const [items, setItems] = useState<Category[]>([]);
  const [model, setModel] = useState<LRModel | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "bot",
      text: "Xin chào!👋 Hãy bắt đầu thêm giao dịch của bạn tại đây nhé!",
    },
  ]);
  const flatRef = useRef<FlatList>(null);

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
          const score = 0.8 * r.p + 0.2 * m.sim;
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
      const arr = [...byId.values()].sort((a, b) => b.score - a.score);

      // Nếu mỏng quá (ít khớp), trộn thêm heuristic để an toàn
      if (arr.length < 2) {
        const hs = items.map((c) => ({
          categoryId: c.id,
          name: c.name,
          score: heuristicScore(text, c, io),
        }));
        hs.sort((a, b) => b.score - a.score);
        return { io, ranked: [...arr, ...hs].slice(0, 5) };
      }
      return { io, ranked: arr };
    }

    // 2) Fallback: heuristic thuần
    const hs = items.map((c) => ({
      categoryId: c.id,
      name: c.name,
      score: heuristicScore(text, c, io),
    }));
    hs.sort((a, b) => b.score - a.score);
    return { io, ranked: hs };
  }

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

    // Lấy message ngắn + (có thể) categoryId từ GPT
    const ai = await getEmotionalReplyDirect({
      io,
      categoryName: best?.name || (io === "IN" ? "Thu nhập" : "Chi tiêu"),
      amount,
      note: text,
    });

    // Chọn categoryId cuối cùng: ưu tiên từ GPT, nếu không có thì lấy best
    const finalCategoryId = ai.categoryId || best?.categoryId;
    const finalCategoryName =
      items.find((c) => c.id === finalCategoryId)?.name ||
      best?.name ||
      "Chưa rõ";

    // Hiển thị phản hồi 1–2 câu (không JSON)
    setMessages((m) => [
      ...m.filter((x) => x.role !== "typing"),
      { role: "bot", text: ai.message },
    ]);
    scrollToEnd();

    // Tạo giao dịch đúng mã danh mục
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
        amount: txn.amount ?? null,
        io: ai.io,
        categoryName: finalCategoryName,
        note: ai.note,
        when,
      },
    ]);
    scrollToEnd();
  };

  // ----- Gợi ý khi chưa đủ tự tin -----
  const [pendingPick, setPendingPick] = useState<{
    text: string;
    amount: number | null;
    io: "IN" | "OUT";
    choices: { categoryId: string; name: string; score: number }[];
  } | null>(null);

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
        amount: txn.amount ?? null,
        io: pendingPick.io,
        categoryName: c.name,
        note: pendingPick.text,
        when,
      },
    ]);
    setPendingPick(null);
    scrollToEnd();
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "#f5f5f5" }}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: "#fafafa" }}
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
                <View style={[styles.bubble, styles.right]}>
                  <Text style={styles.text}>{item.text}</Text>
                </View>
              );
            }
            if (item.role === "bot") {
              return (
                <View style={[styles.bubble, styles.left]}>
                  <Text style={styles.text}>{item.text}</Text>
                </View>
              );
            }
            if (item.role === "typing") {
              return (
                <View
                  style={[
                    styles.bubble,
                    styles.left,
                    { flexDirection: "row", gap: 4 },
                  ]}
                >
                  <View style={styles.dot} />
                  <View style={styles.dot} />
                  <View style={styles.dot} />
                </View>
              );
            }

            return (
              <View style={styles.card}>
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
                    <Text style={{ color: "#666", marginBottom: 2 }}>
                      Đã ghi nhận: {item.io === "OUT" ? "Chi phí" : "Thu nhập"}{" "}
                      · {item.when}
                    </Text>
                    <Text style={{ fontWeight: "700", fontSize: 18 }}>
                      {item.categoryName}
                    </Text>
                    <Text style={{ marginTop: 2, color: "#444" }}>
                      {item.note}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: "700", fontSize: 16 }}>
                    {item.amount ? item.amount.toLocaleString() + "đ" : "—"}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {/* Gợi ý khi chưa đủ tự tin */}
        {pendingPick && (
          <View style={styles.suggestBar}>
            {pendingPick.choices.map((c) => (
              <Pressable
                key={c.categoryId}
                onPress={() => chooseCategory(c)}
                style={styles.chip}
              >
                <Text style={styles.chipText}>
                  {c.name} · {Math.round(c.score * 100)}%
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Input */}
        <View style={styles.inputBar}>
          <TextInput
            placeholder="ví dụ: trà sữa 60k · lương tháng 10 10tr…"
            value={input}
            onChangeText={setInput}
            style={styles.textInput}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable style={styles.sendBtn} onPress={handleSend}>
            <Text style={styles.sendText}>Gửi</Text>
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
