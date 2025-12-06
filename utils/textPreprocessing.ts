/**
 * Text Preprocessing for Vietnamese Transaction Notes
 * Chuyển đổi text thành vectors để train model
 */

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

// Money pattern for extraction - more precise to avoid over-matching
// Valid formats: "500k", "1 triệu 2", "4tr8", "750.000 đồng", "5tr873"
// Invalid (too complex): "5tr873k387d" - let AI handle these
const MONEY_PATTERN =
  /\d+(?:[.,]\d{3})*\s*(?:k|nghìn|ngan|ng|tr|triệu|trieu|m|tỷ|ty|b|đồng|dong|đ|d|vnd|vnđ)(?:\s*\d{1,3})?(?!\d)/gi;

// Patterns to remove from text before classification
const NOISE_PATTERNS = [
  // Numbers with units (money, time, etc.)
  MONEY_PATTERN,
  // Plain numbers
  /\b\d+[.,]?\d*\b/g,
  // Date/time patterns
  /tháng\s*\d+/gi,
  /ngày\s*\d+/gi,
  /\/\d+\/\d+/g,
  /\d+\/\d+/g,
  // Generic noise words for transactions
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

  // Remove money amounts
  note = note.replace(MONEY_PATTERN, " ");

  // Remove dates
  note = note.replace(/tháng\s*\d+/gi, " ");
  note = note.replace(/ngày\s*\d+/gi, " ");
  note = note.replace(/\/\d+\/\d+/g, " ");
  note = note.replace(/\d+\/\d+/g, " ");

  // Remove standalone numbers
  note = note.replace(/\b\d+[.,]?\d*\b/g, " ");

  // Remove time keywords if standalone
  note = note.replace(/\s+(tháng|ngày|năm)\s+/gi, " ");

  // Clean up spaces
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

  // PRIORITY 1: Handle formatted numbers with thousand separators (e.g., "750.000", "1,500,000")
  // This must come BEFORE unit-based parsing to avoid confusion
  const formattedMatch = cleaned.match(
    /(\d{1,3}(?:[.,]\d{3})+)(?:\s*(?:đồng|dong|đ|d|vnd|vnđ))?/i
  );
  if (formattedMatch) {
    const numStr = formattedMatch[1].replace(/[.,]/g, ""); // Remove all separators
    const n = parseInt(numStr, 10);
    if (!isNaN(n) && n >= 1000) {
      // Only apply if it's a reasonable amount with separators
      console.log(`✅ Parsed formatted number: ${formattedMatch[1]} → ${n}`);
      return n;
    }
  }

  // PRIORITY 2: Vietnamese shorthand formats

  // Format A: "5tr873" = 5,873,000 (5 million 873 thousand)
  // NOT "5 triệu 873" with space (that's handled separately)
  const trKFormat = cleaned.match(/(\d+)tr(\d+)(?!k)/i);
  if (trKFormat) {
    const millions = parseInt(trKFormat[1], 10);
    const thousands = parseInt(trKFormat[2], 10);
    // "5tr873" = 5,873,000 (direct concatenation: 5 million + 873 thousand)
    const result = millions * 1000000 + thousands * 1000;
    console.log(`✅ Parsed tr+number: ${trKFormat[0]} → ${result}`);
    return result;
  }

  // Format B: "1 triệu 2" with SPACE = 1,200,000 (1 million + 2 hundred thousand)
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

  // Format C: "4tr8k" = 4,800,000 (4 million 8 hundred thousand)
  const trWithK = cleaned.match(/(\d+)tr(\d+)k/i);
  if (trWithK) {
    const millions = parseInt(trWithK[1], 10);
    const hundreds = parseInt(trWithK[2], 10);
    // "4tr8k" = 4,800,000
    const result = millions * 1000000 + hundreds * 100000;
    console.log(`✅ Parsed tr+k format: ${trWithK[0]} → ${result}`);
    return result;
  }

  // Format D: "847k948" = 847,948
  const complexMatch2 = cleaned.match(/(\d+)k(\d+)/i);
  if (complexMatch2) {
    const thousands = parseInt(complexMatch2[1], 10);
    const ones = parseInt(complexMatch2[2], 10);
    // 847k948 = 847,948
    const result = thousands * 1000 + ones;
    console.log(`✅ Parsed k+number format: ${complexMatch2[0]} → ${result}`);
    return result;
  }

  // PRIORITY 3: Numbers with units (75k, 500k, 2tr, 750000đ)
  // Match: number + unit (k/tr/đ/etc)
  const unitMatch = cleaned.match(
    /(\d+(?:[.,]\d+)?)\s*([kdđ]|nghìn|ngan|ng|tr|triệu|trieu|m|tỷ|ty|b|dong|đồng|vnd|vnđ)/i
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

  // PRIORITY 4: Plain numbers without units (last resort)
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

  // Remove noise patterns
  NOISE_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, " ");
  });

  // Remove extra spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

// Normalize Vietnamese text
export function normalizeVietnameseText(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Remove special characters but keep Vietnamese characters
      .replace(
        /[^\w\sáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/gi,
        " "
      )
      // Remove extra spaces
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Tokenize text into words
export function tokenize(text: string): string[] {
  // First clean the text to remove noise
  const cleaned = cleanTransactionText(text);
  const normalized = normalizeVietnameseText(cleaned);
  return normalized.split(" ").filter((word) => word.length > 0);
}

// Remove stopwords
export function removeStopwords(tokens: string[]): string[] {
  return tokens.filter((token) => !VIETNAMESE_STOPWORDS.includes(token));
}

// Build vocabulary from training data
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

// Calculate TF-IDF (Term Frequency - Inverse Document Frequency)
export function calculateTFIDF(
  texts: string[],
  vocabulary: Map<string, number>
): number[][] {
  const numDocs = texts.length;
  const vocabSize = vocabulary.size;

  // Calculate document frequency for each word
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

  // Calculate TF-IDF vectors
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

// Normalize vector (L2 normalization)
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vector;
  return vector.map((val) => val / magnitude);
}

// Extract features from transaction note
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

// Similarity between two texts (Cosine similarity)
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
