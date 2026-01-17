import { useTheme } from "@/app/providers/ThemeProvider";
import { useAppTour } from "@/context/appTourContext";
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
import { phobertExtractor } from "@/services/phobertAmountExtractor";
import { transactionClassifier } from "@/services/transactionClassifier";
import useAudioMeter from "@/services/useAudioMeter";
import { getCurrentUserId } from "@/utils/auth";
import { fixIconName } from "@/utils/iconMapper";
import { parseAmountVN, parseTransactionText } from "@/utils/textPreprocessing";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { useFocusEffect } from "@react-navigation/native";
import Tooltip from "react-native-walkthrough-tooltip";
// Waveform visualization will use a lightweight animated view instead of capturing audio
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
import { tfTransactionParser } from "../services/tensorflowTransactionParser";
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

async function processReceiptImage(imageUri: string): Promise<{
  amount: number | null;
  text: string;
  merchantName?: string;
}> {
  try {
    // Sử dụng ML Kit Text Recognition để nhận diện text từ ảnh
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

    // Log boundingBox để debug
    blocks.forEach((block: any, index: any) => {
      console.log(`\nBlock ${index + 1}:`);
      console.log("  Text:", block.text);
      console.log(
        "  BoundingBox (frame):",
        JSON.stringify(block.frame, null, 2)
      );
    });
    console.log("=== End of Recognition Results ===\n");

    const ocrText = result.text;

    // Helper: Extract số tiền từ text
    const extractNumber = (text: string): number => {
      const normalized = text.replace(/[oOlI]/g, (m) =>
        m === "o" || m === "O" ? "0" : "1"
      );
      const matches = normalized.match(
        /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{4,}/g
      );
      if (!matches) return 0;

      const nums = matches
        .map((raw) => {
          const n = parseInt(raw.replace(/[,\.]/g, ""), 10);
          if (isNaN(n) || n < 1000 || n > 100000000000) return 0;
          // Filter phone numbers (9-11 digits)
          if (n >= 900000000 && n < 10000000000) return 0;
          return n;
        })
        .filter((n) => n > 0);

      return Math.max(...nums, 0);
    };

    // Extract merchant name - Tìm tên công ty/cơ sở từ blocks
    const extractMerchant = (blocks: any[]): string => {
      // Priority 1: Tìm block ở phần top section (top < 150) có company keyword
      // Đây là vùng tiêu đề/header chứa tên công ty chính thức
      const companyKeywords =
        /công ty|cơ sở|xí nghiệp|shop|cửa hàng|nhà hàng|khách sạn|bệnh viện|trường|trung tâm/i;

      const topHeaderBlocks = blocks.filter(
        (b: any) => b.frame?.top !== undefined && b.frame.top < 150
      );

      const topCompanyBlocks = topHeaderBlocks.filter((b: any) =>
        companyKeywords.test(b.text)
      );

      if (topCompanyBlocks.length > 0) {
        // Lấy block có text dài nhất, ưu tiên block ở top nhất
        const bestBlock = topCompanyBlocks.sort((a: any, b: any) => {
          // Priority 1: Sort by position (ở trên cùng)
          if (a.frame.top !== b.frame.top) {
            return a.frame.top - b.frame.top;
          }
          // Priority 2: Sort by length (text dài hơn = tên đầy đủ hơn)
          return (b.text?.length || 0) - (a.text?.length || 0);
        })[0];
        const name = bestBlock.text?.trim() || "Hóa đơn";
        if (name.length > 5 && !/thanh toán|payment|thông tin/i.test(name))
          return name;
      }

      // Priority 2: Tìm trong header rộng hơn (top < 400), loại "thông tin thanh toán"
      const headerBlocks = blocks.filter(
        (b: any) => b.frame?.top !== undefined && b.frame.top < 400
      );

      const headerCompanyBlocks = headerBlocks.filter(
        (b: any) =>
          companyKeywords.test(b.text) &&
          !/thanh toán|payment|thông tin/i.test(b.text)
      );

      if (headerCompanyBlocks.length > 0) {
        const bestBlock = headerCompanyBlocks.sort((a: any, b: any) => {
          if (a.frame.top !== b.frame.top) {
            return a.frame.top - b.frame.top;
          }
          return (b.text?.length || 0) - (a.text?.length || 0);
        })[0];
        const name = bestBlock.text?.trim() || "Hóa đơn";
        if (name.length > 5) return name;
      }

      // Priority 3: Tìm company blocks ở toàn bộ tài liệu, loại signature area
      const allCompanyBlocks = blocks.filter(
        (b: any) =>
          companyKeywords.test(b.text) &&
          !/thanh toán|payment|thông tin|ký bởi|dược ký|ngày ký/i.test(b.text)
      );

      if (allCompanyBlocks.length > 0) {
        const bestBlock = allCompanyBlocks.sort((a: any, b: any) => {
          // Ưu tiên block ở trên cùng
          if (a.frame?.top && b.frame?.top && a.frame.top !== b.frame.top) {
            return a.frame.top - b.frame.top;
          }
          return (b.text?.length || 0) - (a.text?.length || 0);
        })[0];
        const name = bestBlock.text?.trim() || "Hóa đơn";
        if (name.length > 5) return name;
      }

      return "Hóa đơn";
    };

    // Tính chiều cao ảnh
    const imageHeight = Math.max(
      ...blocks.map((b: any) => (b.frame?.top || 0) + (b.frame?.height || 0))
    );

    // STRATEGY 1: Tìm cặp (Label + Amount) theo vị trí ngang
    const findTotalByHorizontalPair = (): number => {
      const totalZone = blocks.filter(
        (b: any) => (b.frame?.top || 0) >= imageHeight * 0.6
      );

      const totalKeywords =
        /total|tổng|sum|cộng|thanh\s*toán|phải\s*trả|grand|amount|due|balance/i;
      const taxKeywords = /thuế|vat|gtgt|%|chịu\s*thuế/i;

      let bestAmount = 0;
      const MIN_TOTAL = 0; // tránh nhặt nhầm các số rất nhỏ

      for (const labelBlock of totalZone) {
        if (!totalKeywords.test(labelBlock.text)) continue;
        if (taxKeywords.test(labelBlock.text)) continue; // bỏ các dòng thuế

        // Tìm block chứa số ở cùng hàng (Y tương đương) và bên phải
        // Tăng tolerance Y lên 50px vì có thể không hoàn toàn cùng hàng
        const sameRowBlocks = totalZone.filter(
          (b: any) =>
            Math.abs((b.frame?.top || 0) - (labelBlock.frame?.top || 0)) < 50 && // Increased from 30 to 50
            (b.frame?.left || 0) > (labelBlock.frame?.left || 0) - 50 && // Cho phép overlap nhỏ
            !taxKeywords.test(b.text) // bỏ các block thuế/percent
        );

        // Sort by Y distance (gần hơn có priority cao hơn)
        const sortedBlocks = sameRowBlocks.sort(
          (a: any, b: any) =>
            Math.abs((a.frame?.top || 0) - (labelBlock.frame?.top || 0)) -
            Math.abs((b.frame?.top || 0) - (labelBlock.frame?.top || 0))
        );

        for (const amountBlock of sortedBlocks) {
          const amount = extractNumber(amountBlock.text);
          if (amount > MIN_TOTAL && amount > bestAmount) {
            bestAmount = amount;
          }
        }

        // Fallback: Tìm số trong chính label block
        const amount = extractNumber(labelBlock.text);
        if (amount > MIN_TOTAL && amount > bestAmount) {
          bestAmount = amount;
        }
      }

      if (bestAmount > 0) {
        console.log(`✅ Strategy 1 (Best Candidate): ${bestAmount}`);
        return bestAmount;
      }

      return 0;
    };

    // STRATEGY 0 (HIGHEST PRIORITY): Tìm số tiền từ "Số tiền bằng chữ" (Amount in words)
    const findByAmountInWords = (): number => {
      // Tìm block có "số tiền bằng chữ" hoặc "amount in words"
      const amountInWordsKeywords =
        /số\s*tiền\s*bằng\s*chữ|amount\s*in\s*words/i;

      const amountBlocks = blocks.filter((b: any) =>
        amountInWordsKeywords.test(b.text)
      );

      if (amountBlocks.length > 0) {
        // Lấy block đầu tiên (thường là block chứa text chữ và số)
        const blockWithAmount = amountBlocks[0];

        if (blockWithAmount && blockWithAmount.text) {
          const amount = extractNumber(blockWithAmount.text);
          if (amount > 0 && amount < 100000000) {
            console.log(
              `✅ Strategy 0 (Amount in Words): ${amount} from "${blockWithAmount.text.substring(
                0,
                80
              )}..."`
            );
            return amount;
          }
        }
      }

      return 0;
    };

    // STRATEGY 0 (NEW - PRIORITY): Tìm "Tổng tiền thanh toán" và lấy số bên cạnh
    const findFinalTotal = (): number => {
      // Tìm block có "Tổng tiền thanh toán" keyword (đây là dấu hiệu tổng tiền)
      const totalKeywords = /tổng\s*tiền\s*thanh\s*toán|total|tổng\s*cộng/i;
      const totalLabelBlocks = blocks.filter((b: any) =>
        totalKeywords.test(b.text)
      );

      if (totalLabelBlocks.length > 0) {
        // Lấy block gần cuối (nếu có nhiều, lấy cái dưới nhất)
        const labelBlock = totalLabelBlocks.sort(
          (a: any, b: any) => (b.frame?.top || 0) - (a.frame?.top || 0)
        )[0];

        console.log(
          `🔍 Strategy 0: Found "Tổng tiền thanh toán" at top=${labelBlock.frame?.top}`
        );

        // Tìm các blocks gần label này (cùng hàng, bên phải, hoặc dưới gần)
        const nearbyBlocks = blocks.filter((b: any) => {
          const topDiff = Math.abs(
            (b.frame?.top || 0) - (labelBlock.frame?.top || 0)
          );
          const leftDiff = (b.frame?.left || 0) - (labelBlock.frame?.left || 0);

          // Block bên phải cùng hàng hoặc phía dưới gần
          return (
            (topDiff < 40 && leftDiff > 50) || // Cùng hàng, bên phải
            (topDiff < 50 && topDiff > 0 && leftDiff > 0) // Phía dưới một chút, bên phải
          );
        });

        // Lọc và tìm số hợp lệ (không phải năm, địa chỉ, v.v.)
        const validAmounts = nearbyBlocks
          .map((b: any) => ({
            value: extractNumber(b.text),
            text: b.text,
            top: b.frame?.top || 0,
          }))
          .filter(
            (a: any) =>
              a.value > 0 &&
              a.value < 100000000 && // Không quá lớn (năm, ID)
              !/2025|2024|2023|địa|địa chỉ|đường|quận|phố|hotline|https/i.test(
                a.text
              )
          )
          .sort((a: any, b: any) => {
            // Ưu tiên giá trị lớn nhất trước, sau đó mới xét độ gần nhãn
            if (a.value !== b.value) return b.value - a.value;
            const topDiffA = Math.abs(a.top - (labelBlock.frame?.top || 0));
            const topDiffB = Math.abs(b.top - (labelBlock.frame?.top || 0));
            return topDiffA - topDiffB;
          });

        if (validAmounts.length > 0) {
          console.log(
            `✅ Strategy 0 (Total Label): ${validAmounts[0].value} from "${validAmounts[0].text}"`
          );
          return validAmounts[0].value;
        }
      }

      // Fallback: Lấy 20% phía dưới và tìm số lớn nhất (không có "tổng" keyword)
      const finalZone = blocks.filter(
        (b: any) => (b.frame?.top || 0) >= imageHeight * 0.8
      );

      if (finalZone.length > 0) {
        const excludeKeywords =
          /mst|mã\s*số\s*thuế|thuế|chịu\s*thuế|vat|gtgt|%|phone|tel|sdt|hotline|đường|địa|quốc|gia|2025|2024|2023|ký|dấu|chứng/i;
        const validBlocks = finalZone.filter(
          (b: any) => !excludeKeywords.test(b.text)
        );

        const amounts = validBlocks
          .map((b: any) => ({
            value: extractNumber(b.text),
            text: b.text,
            top: b.frame?.top || 0,
            isTotal: /tổng|cộng|thanh\s*toán|sau\s*thuế/i.test(b.text) || false,
          }))
          .filter((a: any) => a.value > 0 && a.value < 100000000)
          .sort((a: any, b: any) => {
            // Ưu tiên dòng có từ khóa tổng/thanh toán/sau thuế, rồi đến giá trị lớn nhất
            if (a.isTotal !== b.isTotal) return a.isTotal ? -1 : 1;
            return b.value - a.value;
          });

        if (amounts.length > 0) {
          console.log(
            `✅ Strategy 0 (Final Zone): ${amounts[0].value} from "${amounts[0].text}"`
          );
          return amounts[0].value;
        }
      }

      return 0;
    };

    // STRATEGY 2: Tìm số lớn nhất ở 60% phía dưới nhưng ưu tiên "Tổng tiền"
    const findLargestAmountInBottom = (): number => {
      const bottomZone = blocks.filter(
        (b: any) => (b.frame?.top || 0) >= imageHeight * 0.6
      );

      // Filter ra các keywords không liên quan đến tổng tiền
      const excludeKeywords =
        /mst|mã\s*số\s*thuế|tax\s*code|thuế|chịu\s*thuế|vat|gtgt|%|phone|tel|sdt|hotline|thanh\s*toán/i;
      const validBlocks = bottomZone.filter(
        (b: any) => !excludeKeywords.test(b.text)
      );

      // Tách blocks thành 2 nhóm: có "Tổng tiền" vs không có
      const totalKeywords = /tổng\s*tiền|total|tổng/i;
      const totalBlocks = validBlocks.filter((b: any) =>
        totalKeywords.test(b.text)
      );
      const otherBlocks = validBlocks.filter(
        (b: any) => !totalKeywords.test(b.text)
      );

      // Ưu tiên tìm trong blocks có "Tổng tiền"
      const blocksToSearch = totalBlocks.length > 0 ? totalBlocks : otherBlocks;

      const amounts = blocksToSearch
        .map((b: any) => ({
          value: extractNumber(b.text),
          text: b.text,
          y: b.frame?.top || 0,
        }))
        .filter((a: any) => a.value > 0)
        .sort((a: any, b: any) => b.value - a.value);

      if (amounts.length > 0) {
        console.log(
          `✅ Strategy 2 (Largest Bottom): ${amounts[0].value} from "${amounts[0].text}"`
        );
        return amounts[0].value;
      }

      return 0;
    };

    // STRATEGY 3: Tìm số lớn nhất trong các block có từ khóa total
    const findByKeywords = (): number => {
      const keywords = /total|tổng|cộng|thanh\s*toán|phải\s*trả/i;
      const matchingBlocks = blocks.filter((b: any) => keywords.test(b.text));

      let maxAmount = 0;
      let maxText = "";

      for (const block of matchingBlocks) {
        const amount = extractNumber(block.text);
        if (amount > maxAmount) {
          maxAmount = amount;
          maxText = block.text;
        }
      }

      if (maxAmount > 0) {
        console.log(
          `✅ Strategy 3 (Keyword Match): ${maxAmount} from "${maxText}"`
        );
      }

      return maxAmount;
    };

    // Thực thi các strategies theo thứ tự ưu tiên
    let amount = findByAmountInWords(); // Strategy 0 - Ưu tiên "Số tiền bằng chữ"

    if (!amount || amount === 0) {
      amount = findFinalTotal(); // Strategy 1 - "Tổng tiền thanh toán"
    }

    if (!amount || amount === 0) {
      amount = findTotalByHorizontalPair();
    }

    if (!amount || amount === 0) {
      amount = findLargestAmountInBottom();
    }

    if (!amount || amount === 0) {
      amount = findByKeywords();
    }

    const merchantName = extractMerchant(blocks);

    console.log(`🎯 Final Amount: ${amount}`);
    console.log(`🏪 Merchant: ${merchantName}`);

    return {
      amount: amount || null,
      text: ocrText.substring(0, 500),
      merchantName,
    };
  } catch (error) {
    console.error("ML Kit Text Recognition error:", error);
    const errorMsg =
      error instanceof Error ? error.message : "Lỗi nhận diện text";

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

/* ---------------- Component ---------------- */
export default function Chatbox() {
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
      } catch {}

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
      } catch {}
      pendingFinalRef.current = false;
    }
    try {
      try {
        await ExpoSpeechRecognitionModule.stop();
        // Wait briefly for any in-flight result events to arrive and be ignored
        await new Promise((r) => setTimeout(r, 200));
      } catch {}
    } catch {}

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
        } catch (e) {}
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
        } catch (e) {}
      };
    }, [isRecording, params?.mode])
  );

  // Always focus the input when the chatbox screen is focused (unless recording)
  useFocusEffect(
    useCallback(() => {
      // If deep-link requests image or voice, skip auto-focus here
      const modeParam = (params?.mode as string | undefined) || null;
      if (modeParam === "image" || modeParam === "voice") return;
      if (isRecording) return;
      const tryFocus = () => {
        try {
          inputRef.current?.focus();
        } catch (e) {
          // ignore
        }
      };

      // Use InteractionManager to wait until animations and navigation settle
      const interaction = InteractionManager.runAfterInteractions(() => {
        // immediate attempt in next frame
        requestAnimationFrame(() => tryFocus());
        // two retries to cover timing differences across devices
        const t1 = setTimeout(() => tryFocus(), 120);
        const t2 = setTimeout(() => tryFocus(), 420);

        // optional: small measurable log when keyboard appears
        const showListener = Keyboard.addListener("keyboardDidShow", () => {
          // eslint-disable-next-line no-console
          showListener.remove();
        });

        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
          try {
            showListener.remove();
          } catch (e) {}
        };
      });

      return () => {
        try {
          interaction.cancel();
        } catch (e) {}
      };
    }, [isRecording])
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
            text: `❌ Không đọc được số tiền từ hóa đơn.\n\n${
              ocrResult.text ? `📄 Text nhận được:\n${ocrResult.text}\n\n` : ""
            }Vui lòng thử ảnh khác có kích thước nhỏ hơn 1MB và độ phân giải cao hơn.`,
          },
        ]);
        scrollToEnd();
        return;
      }

      // OCR successful - Auto create transaction
      const amount = ocrResult.amount;
      const merchantName = ocrResult.merchantName || "Hóa đơn";
      const note = `${merchantName}`;

      // Classify category
      const { ranked } = await classifyToUserCategoriesAI(merchantName);
      const finalCategoryId = ranked[0]?.categoryId;

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
          role: "card",
          transactionId: txn.id,
          accountId: txn.accountId,
          amount: txn.amount ?? null,
          io: "OUT",
          categoryId: finalCategoryId,
          categoryName: selectedCategory?.name || "Mua sắm",
          categoryIcon: selectedCategory?.icon || "cart",
          categoryColor: selectedCategory?.color || "#6366F1",
          note,
          when,
        },
        {
          role: "bot",
          text: `✅ Tạo giao dịch thành công!\n\n💰 ${amount.toLocaleString()}đ\n🏪 ${merchantName}\n📂 ${
            selectedCategory?.name || "Mua sắm"
          }\n\nNhấn Edit nếu cần sửa.`,
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

      // Defer learning to background (don't block UI)
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
      const aiResponse = await getEmotionalReplyDirect({
        io,
        categoryName,
        amount,
        note: originalNote,
        originalText: originalNote, // Use original text for date parsing
      });

      // Create transaction with extracted date
      const txn = await createTransaction({
        amount: aiResponse.amount,
        io: aiResponse.io,
        categoryId,
        note: originalNote,
        date: aiResponse.date, // Use extracted date
      });

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
          date: aiResponse.date, // Store date object for future reference
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
    // Format amount with thousand separators
    const formattedAmount = (item.amount || 0).toLocaleString("vi-VN");
    setEditAmount(formattedAmount);
    setEditNote(item.note);
    setEditCategoryId(item.categoryId);
  };

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

      // 🎓 CORRECTION LEARNING: If user changed category, retrain AI immediately
      if (categoryChanged && editNote) {
        // Create training sample for this correction
        try {
          const sampleId = await logPrediction({
            text: editNote,
            amount: newAmount,
            io: editingTx.io,
            predictedCategoryId: oldCategoryId, // Original wrong prediction
            confidence: 0.5, // Unknown confidence (0-1 range)
          });

          // Log the correction (user chose different category)
          await logCorrection({
            id: sampleId,
            chosenCategoryId: editCategoryId,
          });
        } catch (err) {
          console.warn("⚠️ Failed to log correction:", err);
        }

        // Defer training to background (non-blocking)
        InteractionManager.runAfterInteractions(() => {
          transactionClassifier
            .learnFromCorrection(editNote, editCategoryId)
            .catch((err) => console.warn("⚠️ Model retraining failed:", err));
        });
      }

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

  const handleDeleteTransaction = async (transactionId: string) => {
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
  };

  function VoiceWaveformLite({
    isRecording,
    color = "#3B82F6",
  }: {
    isRecording: boolean;
    color?: string;
  }) {
    const NUM_BARS = 28;
    const anim = useRef(new Animated.Value(0)).current;
    const peaks = useRef(
      Array.from({ length: NUM_BARS }, () => 0.6 + Math.random() * 1.2)
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
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 900,
            useNativeDriver: false,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }, [anim, isRecording]);

    if (!isRecording && !spokenText) return null;

    const MIN_H = 4;
    const MAX_H = 28;

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
            alignItems: "flex-end",
            justifyContent: "center",
            gap: 2,
            height: 44,
            paddingHorizontal: 4,
            borderRadius: 14,
            backgroundColor: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          {Array.from({ length: NUM_BARS }).map((_, i) => {
            const symmetry = Math.sin((Math.PI * i) / (NUM_BARS - 1));
            const base = 0.35 + 0.65 * symmetry;
            const peak = Math.max(MIN_H + 1, MAX_H * base * peaks[i]);

            const h = anim.interpolate({
              inputRange: [0, 0.25, 0.5, 0.75, 1],
              outputRange: [MIN_H, peak * 0.7, peak * 1.05, peak * 0.75, MIN_H],
            });

            return (
              <Animated.View
                key={i}
                style={{
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: color,
                  height: h,
                  opacity: 0.55 + 0.45 * base,
                  shadowColor: color,
                  shadowOpacity: 0.16,
                  shadowOffset: { width: 0, height: 2 },
                  shadowRadius: 4,
                  elevation: 2,
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
        } catch {}
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
          keyExtractor={(_, i) => String(i)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: new Animated.Value(0) } } }],
            {
              useNativeDriver: false,
              listener: (event: any) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                // More accurate bottom detection - check if within 50px of bottom
                const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
                const isCloseToBottom = distanceFromBottom <= 50; // Within 50px of bottom
                setIsAtBottom(isCloseToBottom);
                // Reset force hide only when user manually scrolls (not when scrolling to bottom via button)
                if (!isCloseToBottom && !isScrollingToBottom) {
                  setForceHideButton(false);
                }
                // Reset scrolling flag when reached bottom
                if (isCloseToBottom) {
                  setIsScrollingToBottom(false);
                }
              },
            }
          )}
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
            },
            [colors, mode, items, t, editingTx]
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
            <SafeAreaView
              style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 20,
                maxHeight: "80%",
              }}
              edges={["bottom"]}
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
                    style={{
                      marginRight: 8,
                      transform: [{ rotate: spin }],
                    }}
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
          {/* Nút Voice (ẩn khi đang ghi âm) */}
          {!isRecording && (
            <Pressable
              style={[
                styles.iconBtn,
                {
                  backgroundColor:
                    mode === "dark" ? colors.background : "#F3F4F6",
                  borderColor: colors.divider,
                  opacity: isProcessingVoice ? 0.4 : 1,
                },
              ]}
              onPress={startVoice}
              disabled={isProcessingVoice}
            >
              <Ionicons name={"mic"} size={22} color={colors.icon} />
            </Pressable>
          )}

          {/* Nút Image - ẩn khi đang ghi âm */}
          {!isRecording && (
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
              disabled={isProcessingVoice}
            >
              <Ionicons name="image" size={22} color={colors.icon} />
            </Pressable>
          )}

          {/* Vùng giữa: TextInput <-> RecordingBar */}
          <View
            style={{
              flex: 1,
              marginHorizontal: 4,
              position: "relative",
              minHeight: 44,
              justifyContent: "center",
            }}
          >
            {/* TextInput (hiện khi không ghi) */}
            <Animated.View
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
                  <View style={{ padding: 8 }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "700",
                        color: "#111",
                        marginBottom: 8,
                      }}
                    >
                      📝 Nhập giao dịch
                    </Text>
                    <Text
                      style={{
                        fontSize: 14,
                        color: "#666",
                        marginBottom: 12,
                      }}
                    >
                      Nhập nội dung giao dịch của bạn tại đây. Ví dụ: "Trà sữa
                      60k" rồi nhấn nút gửi.
                    </Text>
                    <TouchableOpacity
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
                    } catch (e) {}

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
                    } catch (e) {}
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
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.divider,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  backgroundColor:
                    mode === "dark" ? "rgba(37, 99, 235, 0.15)" : "#E5F5F9",
                }}
              >
                {/* small mic icon at the start while recording */}
                <View
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

                <View style={{ flex: 1, marginHorizontal: 8 }}>
                  <VoiceWaveformLite
                    isRecording={isRecording}
                    color={mode === "dark" ? "#60A5FA" : "#3B82F6"}
                  />
                </View>

                {/* X – hủy (framed button) */}
                <Pressable
                  onPress={cancelRecording}
                  disabled={isSubmitting}
                  style={[
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
                  style={[
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
          {!isRecording && (
            <Tooltip
              isVisible={shouldShowTour && currentStep === 3}
              content={
                <View style={{ padding: 8 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "700",
                      color: "#111",
                      marginBottom: 8,
                    }}
                  >
                    🚀 Gửi tin nhắn
                  </Text>
                  <Text
                    style={{
                      fontSize: 14,
                      color: "#666",
                      marginBottom: 12,
                    }}
                  >
                    Nhấn nút "Gửi" để AI xử lý giao dịch của bạn. AI sẽ tự động
                    phân loại và tạo giao dịch mới.
                  </Text>
                  <TouchableOpacity
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
            </Tooltip>
          )}
        </Animated.View>

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

        {/* Floating Scroll to Bottom Button */}
        {!isAtBottom && !forceHideButton && (
          <Animated.View
          style={{
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
          }}
        >
          <Pressable
            style={{
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
            }}
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
            }}
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
