// Danh sách stopwords tiếng Việt (các từ không mang nhiều ý nghĩa)
const VIETNAMESE_STOPWORDS = [
  "và",
  "của",
  "có",
  "cho",
  "với",
  "từ",
  "được",
  "đã",
  "sẽ",
  "đang",
  "các",
  "những",
  "một",
  "cái",
  "chiếc",
  "cũng",
  "như",
  "để",
  "khi",
  "này",
  "đó",
  "thì",
  "là",
  "ở",
  "tại",
  "trên",
  "dưới",
  "trong",
  "ngoài",
];

// Mẫu nhận diện số tiền — chính xác hơn để tránh khớp sai
// Định dạng hợp lệ: "500k", "1 triệu 2", "4tr8", "750.000 đồng", "5tr873"
// Không hợp lệ (quá phức tạp): "5tr873k387d" — để AI xử lý
const MONEY_PATTERN =
  /\d+(?:[.,]\d{3})*\s*(?:k|nghìn|ngan|ng|tr|triệu|trieu|m|tỷ|ty|b|đồng|dong|đ|₫|d|vnd|vnđ)(?:\s*\d{1,3})?(?!\d)/gi;

// Các mẫu cần loại bỏ khỏi văn bản trước khi phân loại
const NOISE_PATTERNS = [
  // Số kèm đơn vị (tiền, thời gian, v.v.)
  MONEY_PATTERN,
  // Số đơn thuần
  /\b\d+[.,]?\d*\b/g,
  // Mẫu ngày/giờ
  /tháng\s*\d+/gi,
  /ngày\s*\d+/gi,
  /\/\d+\/\d+/g,
  /\d+\/\d+/g,
  // Từ nhiễu phổ biến trong giao dịch
  /\btháng\b/gi,
  /\bngày\b/gi,
  /\bnăm\b/gi,
];

/**
 * Extract amount and clean note from transaction text
 * Example: "Tiền điện tháng 7 450k" → { amount: 450000, note: "Tiền điện" }
 */
export function parseTransactionText(text: string): {
  amount: number | null;
  note: string;
} {
  // Extract amount first
  const amountMatch = text.match(MONEY_PATTERN);
  let amount: number | null = null;

  if (amountMatch && amountMatch.length > 0) {
    // Parse the first money amount found
    const amountText = amountMatch[0];
    amount = parseAmountVN(amountText);
  }

  // Clean the note by removing amount and other noise
  let note = text;

  // Loại bỏ các mẫu số tiền
  note = note.replace(MONEY_PATTERN, " ");

  // Loại bỏ ngày tháng
  note = note.replace(/tháng\s*\d+/gi, " ");
  note = note.replace(/ngày\s*\d+/gi, " ");
  note = note.replace(/\/\d+\/\d+/g, " ");
  note = note.replace(/\d+\/\d+/g, " ");

  // Loại bỏ số đứng riêng lẻ
  note = note.replace(/\b\d+[.,]?\d*\b/g, " ");

  // Loại bỏ từ khoá thời gian nếu đứng riêng
  note = note.replace(/\s+(tháng|ngày|năm)\s+/gi, " ");

  // Làm sạch khoảng trắng
  note = note.replace(/\s+/g, " ").trim();

  return { amount, note };
}

/**
 * Parse Vietnamese money amount
 * Exported for use in chatbox and other components
 */
export function parseAmountVN(text: string): number | null {
  if (!text || typeof text !== "string") return null;

  const cleaned = text.toLowerCase().trim();
  console.log(`🔍 parseAmountVN input: "${text}" → cleaned: "${cleaned}"`);

  // ƯU TIÊN 1: Xử lý số đã định dạng với dấu phân tách hàng nghìn (vd: "750.000", "1,500,000")
  // This must come BEFORE unit-based parsing to avoid confusion
  const formattedMatch = cleaned.match(
    /(\d{1,3}(?:[.,]\d{3})+)(?:\s*(?:đồng|dong|đ|₫|d|vnd|vnđ))?/i
  );
  if (formattedMatch) {
    const numStr = formattedMatch[1].replace(/[.,]/g, ""); // Loại bỏ tất cả dấu phân tách
    const n = parseInt(numStr, 10);
    if (!isNaN(n) && n >= 1000) {
      // Only apply if it's a reasonable amount with separators
      console.log(`✅ Parsed formatted number: ${formattedMatch[1]} → ${n}`);
      return n;
    }
  }

  // ƯU TIÊN 2: Định dạng viết tắt tiếng Việt

  // Định dạng 0: phức tạp "8tr354k238d" = 8.354.238 (8 triệu + 354 nghìn + 238)
  const complexFullMatch = cleaned.match(
    /(\d+)tr(\d+)k(\d+)(?:đ|d|dong|đồng)?/i
  );
  if (complexFullMatch) {
    const millions = parseInt(complexFullMatch[1], 10);
    const thousands = parseInt(complexFullMatch[2], 10);
    const ones = parseInt(complexFullMatch[3], 10);
    const result = millions * 1000000 + thousands * 1000 + ones;
    console.log(`✅ Parsed complex tr+k+d: ${complexFullMatch[0]} → ${result}`);
    return result;
  }

  // Định dạng 0.5: "8tr476k" = 8.476.000 (8 triệu + 476 nghìn)
  const trKFormat2 = cleaned.match(/(\d+)tr(\d+)k(?![\d])/i);
  if (trKFormat2) {
    const millions = parseInt(trKFormat2[1], 10);
    const thousands = parseInt(trKFormat2[2], 10);
    const result = millions * 1000000 + thousands * 1000;
    console.log(`✅ Parsed tr+k: ${trKFormat2[0]} → ${result}`);
    return result;
  }

  // Định dạng A: "5tr873" = 5.873.000 (5 triệu 873 nghìn)
  // Định dạng A2: "4tr8" = 4.800.000 (4 triệu 8 trăm nghìn)
  // NOT "5 triệu 873" with space (that's handled separately)
  const trKFormat = cleaned.match(/(\d+)tr(\d+)(?!k)/i);
  if (trKFormat) {
    const millions = parseInt(trKFormat[1], 10);
    const extra = parseInt(trKFormat[2], 10);

    let result: number;
    if (extra < 10) {
      // Một chữ số sau "tr" = hàng trăm nghìn
      // "4tr8" = 4.800.000 (4 triệu + 800 nghìn)
      result = millions * 1000000 + extra * 100000;
    } else {
      // Nhiều chữ số = số nghìn chính xác
      // "5tr873" = 5.873.000 (5 triệu + 873 nghìn)
      result = millions * 1000000 + extra * 1000;
    }

    console.log(`✅ Parsed tr+number: ${trKFormat[0]} → ${result}`);
    return result;
  }

  // Định dạng B: "1 triệu 2" có khoảng trắng = 1.200.000 (1 triệu + 2 trăm nghìn)
  const spacedTrieuMatch = cleaned.match(
    /(\d+)\s+(triệu|trieu|m)\s+(\d+)(?!\d)/i
  );
  if (spacedTrieuMatch) {
    const millions = parseInt(spacedTrieuMatch[1], 10);
    const extra = parseInt(spacedTrieuMatch[3], 10);
    // With space: "1 triệu 2" = 1,200,000 (1 million + 200k)
    const result = millions * 1000000 + extra * 100000;
    console.log(`✅ Parsed spaced 'triệu': ${spacedTrieuMatch[0]} → ${result}`);
    return result;
  }

  // Định dạng C: "4tr8k" = 4.800.000 (4 triệu 8 trăm nghìn)
  const trWithK = cleaned.match(/(\d+)tr(\d+)k/i);
  if (trWithK) {
    const millions = parseInt(trWithK[1], 10);
    const hundreds = parseInt(trWithK[2], 10);
    // "4tr8k" = 4,800,000
    const result = millions * 1000000 + hundreds * 100000;
    console.log(`✅ Parsed tr+k format: ${trWithK[0]} → ${result}`);
    return result;
  }

  // Định dạng D: "847k948" = 847.948
  const complexMatch2 = cleaned.match(/(\d+)k(\d+)/i);
  if (complexMatch2) {
    const thousands = parseInt(complexMatch2[1], 10);
    const ones = parseInt(complexMatch2[2], 10);
    // 847k948 = 847,948
    const result = thousands * 1000 + ones;
    console.log(`✅ Parsed k+number format: ${complexMatch2[0]} → ${result}`);
    return result;
  }

  // ƯU TIÊN 3: Số kèm đơn vị (75k, 500k, 2tr, 750000đ)
  // Match: number + unit (k/tr/đ/etc)
  const unitMatch = cleaned.match(
    /(\d+(?:[.,]\d+)?)\s*([kdđ₫]|nghìn|ngan|ng|tr|triệu|trieu|m|tỷ|ty|b|dong|đồng|vnd|vnđ)/i
  );

  if (unitMatch) {
    const numStr = unitMatch[1].replace(",", ".");
    const n = parseFloat(numStr);

    if (isNaN(n)) {
      console.log(`❌ Failed to parse number: ${unitMatch[1]}`);
      return null;
    }

    const unit = (unitMatch[2] || "").toLowerCase();
    console.log(`🔍 Found unit match: number=${n}, unit="${unit}"`);

    // Determine multiplier based on unit
    let factor = 1;
    if (unit === "k" || unit.startsWith("ng")) {
      factor = 1000; // k, nghìn, ngàn
    } else if (unit.startsWith("tr") || unit === "m") {
      factor = 1000000; // tr, triệu, m (million)
    } else if (unit.startsWith("tỷ") || unit.startsWith("ty") || unit === "b") {
      factor = 1000000000; // tỷ, billion
    } else if (
      unit === "đ" ||
      unit === "₫" ||
      unit === "d" ||
      unit === "dong" ||
      unit === "đồng" ||
      unit === "vnd" ||
      unit === "vnđ"
    ) {
      factor = 1; // đồng = VND (no conversion needed)
    }

    const result = Math.round(n * factor);
    console.log(`✅ Parsed with unit: ${n} × ${factor} = ${result}`);
    return result;
  }

  // ƯU TIÊN 4: Số thuần không có đơn vị (phương án cuối)
  const plainMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)$/);
  if (plainMatch) {
    const numStr = plainMatch[1].replace(/[.,]/g, "");
    const n = parseInt(numStr, 10);
    if (!isNaN(n)) {
      console.log(`⚠️ Plain number without unit: ${n}`);
      return n;
    }
  }

  console.log(`❌ No amount pattern matched for: "${cleaned}"`);
  return null;
}

/**
 * Clean text by removing money amounts, dates, and other noise
 * This helps focus on actual category keywords
 */
export function cleanTransactionText(text: string): string {
  let cleaned = text;

  // Loại bỏ các mẫu nhiễu
  NOISE_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, " ");
  });

  // Loại bỏ khoảng trắng thừa
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

// Chuẩn hoá văn bản tiếng Việt
export function normalizeVietnameseText(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Loại ký tự đặc biệt nhưng giữ lại ký tự tiếng Việt
      .replace(
        /[^\w\sáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/gi,
        " "
      )
      // Loại bỏ khoảng trắng thừa
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Token hoá văn bản thành các từ
export function tokenize(text: string): string[] {
  // Trước tiên làm sạch văn bản để loại bỏ nhiễu
  const cleaned = cleanTransactionText(text);
  const normalized = normalizeVietnameseText(cleaned);
  return normalized.split(" ").filter((word) => word.length > 0);
}

// Loại bỏ stopwords
export function removeStopwords(tokens: string[]): string[] {
  return tokens.filter((token) => !VIETNAMESE_STOPWORDS.includes(token));
}

// Xây dựng từ vựng từ dữ liệu huấn luyện
export function buildVocabulary(
  texts: string[],
  minFrequency = 2
): Map<string, number> {
  const wordFrequency = new Map<string, number>();

  // Count word frequencies
  texts.forEach((text) => {
    const tokens = removeStopwords(tokenize(text));
    tokens.forEach((token) => {
      wordFrequency.set(token, (wordFrequency.get(token) || 0) + 1);
    });
  });

  // Filter by minimum frequency and create vocabulary
  const vocabulary = new Map<string, number>();
  let index = 0;

  wordFrequency.forEach((freq, word) => {
    if (freq >= minFrequency) {
      vocabulary.set(word, index++);
    }
  });

  return vocabulary;
}

// Convert text to Bag of Words vector
export function textToVector(
  text: string,
  vocabulary: Map<string, number>,
  vectorSize?: number
): number[] {
  const size = vectorSize || vocabulary.size;
  const vector = new Array(size).fill(0);

  const tokens = removeStopwords(tokenize(text));

  tokens.forEach((token) => {
    const index = vocabulary.get(token);
    if (index !== undefined && index < size) {
      vector[index] += 1;
    }
  });

  return vector;
}

// Tính TF-IDF (Term Frequency - Inverse Document Frequency)
export function calculateTFIDF(
  texts: string[],
  vocabulary: Map<string, number>
): number[][] {
  const numDocs = texts.length;
  const vocabSize = vocabulary.size;

  // Tính tần suất tài liệu cho mỗi từ
  const docFrequency = new Array(vocabSize).fill(0);

  texts.forEach((text) => {
    const tokens = new Set(removeStopwords(tokenize(text)));
    tokens.forEach((token) => {
      const index = vocabulary.get(token);
      if (index !== undefined) {
        docFrequency[index] += 1;
      }
    });
  });

  // Tính vector TF-IDF
  return texts.map((text) => {
    const tfVector = textToVector(text, vocabulary);

    // Apply IDF weighting
    return tfVector.map((tf, idx) => {
      if (tf === 0 || docFrequency[idx] === 0) return 0;
      const idf = Math.log(numDocs / docFrequency[idx]);
      return tf * idf;
    });
  });
}

// Chuẩn hoá vector (chuẩn L2)
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vector;
  return vector.map((val) => val / magnitude);
}

// Trích đặc trưng từ ghi chú giao dịch
export function extractFeatures(note: string): {
  tokens: string[];
  wordCount: number;
  hasNumber: boolean;
  hasCurrency: boolean;
} {
  const tokens = removeStopwords(tokenize(note));

  return {
    tokens,
    wordCount: tokens.length,
    hasNumber: /\d/.test(note),
    hasCurrency: /đ|vnd|k|tr|triệu|nghìn/i.test(note),
  };
}

// Độ tương tự giữa hai văn bản (Cosine similarity)
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) return 0;

  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
  }

  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);

  if (mag1 === 0 || mag2 === 0) return 0;

  return dotProduct / (mag1 * mag2);
}
