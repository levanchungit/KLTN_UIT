// Mẫu nhận diện số tiền — chính xác hơn để tránh khớp sai
// Định dạng hợp lệ: "500k", "1 triệu 2", "4tr8", "750.000 đồng", "5tr873"
const MONEY_PATTERN =
  /\d+(?:[.,]\d{3})*\s*(?:k|nghìn|ngan|ng|tr|triệu|trieu|m|tỷ|ty|b|đồng|dong|đ|₫|d|vnd|vnđ)(?:\s*\d{1,3})?(?!\d)/gi;

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
