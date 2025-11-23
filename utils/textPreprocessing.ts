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

// Patterns to remove from text before classification
const NOISE_PATTERNS = [
  // Plain numbers (but keep money amounts for GPT)
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
 */
export function parseTransactionText(text: string): {
  amount: number | null;
  note: string;
} {
  // Extract amount using regex
  const amount = parseAmountVN(text);

  // Clean the note by removing dates and other noise (but keep money for regex)
  let note = text;

  // Remove dates
  note = note.replace(/tháng\s*\d+/gi, " ");
  note = note.replace(/ngày\s*\d+/gi, " ");
  note = note.replace(/\/\d+\/\d+/g, " ");
  note = note.replace(/\d+\/\d+/g, " ");

  // Remove time keywords if standalone
  note = note.replace(/\s+(tháng|ngày|năm)\s+/gi, " ");

  // Clean up spaces
  note = note.replace(/\s+/g, " ").trim();

  return { amount, note };
}

/**
 * Parse Vietnamese money amount - handles concatenated formats
 */
export function parseAmountVN(text: string): number | null {
  const t = text.toLowerCase().replace(/\s+/g, "").replace(/[,\.](?=\d{3}\b)/g, "");

  // Handle concatenated formats like "74tr480k"
  const concatMatch = t.match(/^(\d+)(tr|triệu|trieu|tỷ|ty)(\d+)(k|nghìn|ngan)?/);
  if (concatMatch) {
    const [_, mainNum, mainUnit, subNum, subUnit] = concatMatch;
    const mainFactor = (mainUnit.startsWith("tr") || mainUnit.startsWith("tri")) ? 1e6 :
                      (mainUnit.startsWith("tỷ") || mainUnit.startsWith("ty")) ? 1e9 : 1;
    const subFactor = subUnit && (subUnit.startsWith("k") || subUnit.startsWith("ng")) ? 1e3 : 1;

    const mainAmount = parseFloat(mainNum) * mainFactor;
    const subAmount = parseFloat(subNum) * subFactor;
    return Math.round(mainAmount + subAmount);
  }

  // Handle single amounts
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngan|tr|triệu|trieu|tỷ|ty|đ|d|vnd)?/i);
  if (!m) return null;

  const n = parseFloat(m[1].replace(",", "."));
  const unit = (m[2] || "").toLowerCase();

  const factor =
    unit.startsWith("k") || unit.startsWith("ng")
      ? 1e3
      : unit.startsWith("tr") || unit.startsWith("tri")
      ? 1e6
      : unit.startsWith("tỷ") || unit.startsWith("ty")
      ? 1e9
      : 1;

  return Math.round(n * factor);
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
