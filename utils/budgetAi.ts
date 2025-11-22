// utils/budgetAi.ts

export type GroupType = "needs" | "wants" | "savings";
export type Persona = "SAVE" | "BALANCE" | "ENJOY";

export type BudgetRatio = { needs: number; wants: number; savings: number };

export type ParsedExpense = {
  rawText: string; // "tiền nhà 2tr"
  label: string; // "tiền nhà"
  amount: number; // 2000000
  category: string; // "rent" / "fuel" / ...
  groupType: GroupType; // "needs" | "wants" | "savings"
};

export type LifestyleFlags = {
  hasDebt: boolean;
  hasDependents: boolean;
  incomeStable: boolean;
};

export type GroupSummary = {
  target: number; // mục tiêu theo ratio đã điều chỉnh
  fixed: number; // tổng chi cố định parse được
  flexible: number; // phần còn lại = max(target - fixed, 0)
  overshoot: boolean; // fixed > target ?
};

export type FullBudgetSuggestion = {
  incomeAfterTax: number;
  persona: Persona;
  ratio: BudgetRatio; // ratio cuối cùng sau khi đã adjust & constraints
  fixedExpenses: ParsedExpense[];
  flags: LifestyleFlags;
  groupSummary: {
    needs: GroupSummary;
    wants: GroupSummary;
    savings: GroupSummary;
  };
  explanation: string;
};

// ================== Helpers ==================

const normalize = (text: string) =>
  text.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();

const moneyRegex =
  /([0-9]+(?:[.,][0-9]+)?)\s*(k|nghìn|ngan|ngàn|tr|triệu|trieu|m)/i;

function parseMoney(value: string, unit: string): number {
  const num = parseFloat(value.replace(",", "."));
  if (isNaN(num)) return 0;
  const u = unit.toLowerCase();

  if (
    u === "k" ||
    u.includes("nghìn") ||
    u.includes("ngan") ||
    u.includes("ngàn")
  ) {
    return Math.round(num * 1_000);
  }
  if (u === "tr" || u.includes("triệu") || u.includes("trieu") || u === "m") {
    return Math.round(num * 1_000_000);
  }
  return Math.round(num);
}

function normalizeRatio(r: BudgetRatio): BudgetRatio {
  const sum = r.needs + r.wants + r.savings;
  if (sum <= 0) {
    return { needs: 0.5, wants: 0.3, savings: 0.2 };
  }
  return {
    needs: r.needs / sum,
    wants: r.wants / sum,
    savings: r.savings / sum,
  };
}

// ================== 1. Parse fixed expenses ==================

export function parseFixedExpenses(lifestyleDesc: string): ParsedExpense[] {
  const text = normalize(lifestyleDesc);
  const chunks = text
    .split(/,|\n|;/)
    .map((c) => c.trim())
    .filter(Boolean);

  const CATEGORY_KEYWORDS: {
    category: string;
    groupType: GroupType;
    keywords: string[];
  }[] = [
    // NEEDS
    {
      category: "rent",
      groupType: "needs",
      keywords: ["tiền nhà", "nhà trọ", "thuê nhà", "phòng trọ", "rent"],
    },
    {
      category: "utilities",
      groupType: "needs",
      keywords: ["điện", "nước", "điện nước", "wifi", "internet", "net"],
    },
    {
      category: "fuel",
      groupType: "needs",
      keywords: ["xăng", "gas", "fuel"],
    },
    {
      category: "groceries",
      groupType: "needs",
      keywords: ["ăn uống", "siêu thị", "chợ", "bếp"],
    },
    {
      category: "transport",
      groupType: "needs",
      keywords: ["xe bus", "bus", "grab", "taxi", "xe ôm", "gửi xe"],
    },
    // WANTS
    {
      category: "eatingOut",
      groupType: "wants",
      keywords: ["ăn ngoài", "đi ăn", "nhậu", "cafe", "coffee", "trà sữa"],
    },
    {
      category: "shopping",
      groupType: "wants",
      keywords: ["mua sắm", "shopping", "quần áo", "giày dép", "hàng hiệu"],
    },
    {
      category: "entertainment",
      groupType: "wants",
      keywords: ["giải trí", "xem phim", "netflix", "game"],
    },
    // SAVINGS
    {
      category: "savingManual",
      groupType: "savings",
      keywords: ["tiết kiệm", "gửi tiết kiệm", "đầu tư"],
    },
  ];

  const result: ParsedExpense[] = [];

  for (const rawChunk of chunks) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;

    const m = chunk.match(moneyRegex);
    if (!m) continue;

    const [, value, unit] = m;
    const amount = parseMoney(value, unit);
    if (!amount) continue;

    let bestMatch: {
      category: string;
      groupType: GroupType;
      label: string;
    } | null = null;

    for (const def of CATEGORY_KEYWORDS) {
      for (const kw of def.keywords) {
        if (chunk.includes(kw)) {
          bestMatch = {
            category: def.category,
            groupType: def.groupType,
            label: kw,
          };
          break;
        }
      }
      if (bestMatch) break;
    }

    if (!bestMatch) {
      bestMatch = {
        category: "otherNeeds",
        groupType: "needs",
        label: "chi tiêu cố định",
      };
    }

    result.push({
      rawText: rawChunk.trim(),
      label: bestMatch.label,
      amount,
      category: bestMatch.category,
      groupType: bestMatch.groupType,
    });
  }

  return result;
}

// ================== 2. Flags & persona ==================

export function detectLifestyleFlags(desc: string): LifestyleFlags {
  const text = normalize(desc);

  const hasDebt = /nợ|vay|trả góp|thế chấp|thẻ tín dụng|credit card/.test(text);
  const hasDependents =
    /gia đình|vợ|chồng|con |con nhỏ|con học|gia đình nhỏ/.test(text);
  const incomeStable =
    !/freelance|tự do|bấp bênh|hoa hồng|tháng cao tháng thấp|không ổn định/.test(
      text
    );

  return { hasDebt, hasDependents, incomeStable };
}

export function classifyPersonaFromText(desc: string): Persona {
  const text = normalize(desc);

  const score = { SAVE: 0, ENJOY: 0 };

  // SAVE nghiêng về an toàn, tiết kiệm
  if (text.match(/tiết kiệm|tích lũy|tích luỹ|gửi tiết kiệm|đầu tư|an toàn/g)) {
    score.SAVE += 2;
  }
  if (text.match(/tối giản|giản dị|ít tiêu|không thích mua sắm/g)) {
    score.SAVE += 2;
  }
  if (text.match(/trả nợ|trả góp|trả hết nợ/g)) {
    score.SAVE += 2;
  }

  // ENJOY nghiêng về trải nghiệm, hưởng thụ
  if (text.match(/du lịch|đi chơi|ăn ngoài|nhậu|giải trí/g)) {
    score.ENJOY += 2;
  }
  if (text.match(/shopping|mua sắm|hàng hiệu|sang chảnh|sống chill/g)) {
    score.ENJOY += 2;
  }

  if (score.SAVE === 0 && score.ENJOY === 0) return "BALANCE";
  if (score.SAVE > score.ENJOY) return "SAVE";
  if (score.ENJOY > score.SAVE) return "ENJOY";
  return "BALANCE";
}

function getBaseRatioFromPersona(persona: Persona): BudgetRatio {
  switch (persona) {
    case "SAVE":
      return { needs: 0.45, wants: 0.2, savings: 0.35 };
    case "ENJOY":
      return { needs: 0.45, wants: 0.4, savings: 0.15 };
    case "BALANCE":
    default:
      return { needs: 0.5, wants: 0.3, savings: 0.2 };
  }
}

function adjustRatioWithFlags(
  base: BudgetRatio,
  flags: LifestyleFlags
): BudgetRatio {
  let r: BudgetRatio = { ...base };

  if (!flags.incomeStable) {
    // thu nhập bấp bênh → tăng savings, giảm wants
    r.savings += 0.05;
    r.wants -= 0.05;
  }

  if (flags.hasDependents) {
    // có gia đình / con cái → tăng needs, giảm wants
    r.needs += 0.05;
    r.wants -= 0.05;
  }

  if (flags.hasDebt) {
    // đang nợ → ưu tiên savings (trả nợ)
    r.savings += 0.05;
    r.wants -= 0.05;
  }

  // Không cho wants âm
  if (r.wants < 0.05) r.wants = 0.05;

  return normalizeRatio(r);
}

// ================== 3. Smart ratio + constraints ==================

type SmartRatioResult = {
  persona: Persona;
  flags: LifestyleFlags;
  ratio: BudgetRatio; // ratio cuối cùng
  target: { needs: number; wants: number; savings: number };
  fixed: { needs: number; wants: number; savings: number };
  fixedExpenses: ParsedExpense[];
};

function buildSmartRatioFromLifestyle(
  incomeAfterTax: number,
  lifestyleDesc: string
): SmartRatioResult {
  const fixedExpenses = parseFixedExpenses(lifestyleDesc);
  const persona = classifyPersonaFromText(lifestyleDesc);
  const flags = detectLifestyleFlags(lifestyleDesc);
  const baseRatio = getBaseRatioFromPersona(persona);
  const ratioAfterFlags = adjustRatioWithFlags(baseRatio, flags);

  let targetNeeds = Math.round(incomeAfterTax * ratioAfterFlags.needs);
  let targetWants = Math.round(incomeAfterTax * ratioAfterFlags.wants);
  let targetSavings = Math.round(incomeAfterTax * ratioAfterFlags.savings);

  let fixedNeeds = 0;
  let fixedWants = 0;
  let fixedSavings = 0;

  for (const e of fixedExpenses) {
    if (e.groupType === "needs") fixedNeeds += e.amount;
    else if (e.groupType === "wants") fixedWants += e.amount;
    else fixedSavings += e.amount;
  }

  // ---- Case 1: fixedNeeds > targetNeeds → needs ăn quá nhiều ----
  if (fixedNeeds > targetNeeds) {
    let extra = fixedNeeds - targetNeeds;

    let newWants = targetWants;
    let newSavings = targetSavings;

    // cắt tối đa 70% wants trước
    const cutFromWants = Math.min(extra, newWants * 0.7);
    newWants -= cutFromWants;
    extra -= cutFromWants;

    if (extra > 0) {
      const cutFromSavings = Math.min(extra, newSavings);
      newSavings -= cutFromSavings;
      extra -= cutFromSavings;
    }

    targetNeeds = fixedNeeds;
    targetWants = Math.max(0, Math.round(newWants));
    targetSavings = Math.max(0, Math.round(newSavings));
  }

  // ---- Case 2: fixedWants > targetWants → user "enjoy" quá ----
  if (fixedWants > targetWants) {
    if (persona === "ENJOY") {
      const extra = fixedWants - targetWants;
      const canPull = Math.min(extra, targetSavings * 0.5);
      targetWants += Math.round(canPull);
      targetSavings -= Math.round(canPull);
    }
    // persona SAVE / BALANCE thì giữ nguyên, chỉ warning ở phần giải thích
  }

  // Ratio cuối cùng dựa trên target đã adjust
  const totalTarget = targetNeeds + targetWants + targetSavings;
  let finalRatio: BudgetRatio;
  if (totalTarget > 0) {
    finalRatio = {
      needs: targetNeeds / totalTarget,
      wants: targetWants / totalTarget,
      savings: targetSavings / totalTarget,
    };
  } else {
    finalRatio = ratioAfterFlags;
  }

  return {
    persona,
    flags,
    ratio: finalRatio,
    target: { needs: targetNeeds, wants: targetWants, savings: targetSavings },
    fixed: { needs: fixedNeeds, wants: fixedWants, savings: fixedSavings },
    fixedExpenses,
  };
}

// ================== 4. Explanation text ==================

function buildExplanation(
  incomeAfterTax: number,
  persona: Persona,
  ratio: BudgetRatio,
  fixed: { needs: number; wants: number; savings: number },
  flags: LifestyleFlags,
  fixedExpenses: ParsedExpense[]
): string {
  const personaLabel: Record<Persona, string> = {
    SAVE: "ưu tiên tiết kiệm & an toàn tài chính",
    BALANCE: "cân bằng giữa chi tiêu và tiết kiệm",
    ENJOY: "ưa trải nghiệm & tận hưởng cuộc sống",
  };

  let text = `Dựa trên mô tả, mình hiểu bạn là kiểu người ${
    personaLabel[persona]
  }, nên gợi ý phân bổ khoảng ${(ratio.needs * 100).toFixed(
    0
  )}% cho nhu cầu thiết yếu, ${(ratio.wants * 100).toFixed(
    0
  )}% cho chi tiêu mong muốn và ${(ratio.savings * 100).toFixed(
    0
  )}% cho tiết kiệm/đầu tư. `;

  const extraNotes: string[] = [];

  if (!flags.incomeStable) {
    extraNotes.push(
      "Thu nhập của bạn có vẻ chưa ổn định, vì vậy mình tăng nhẹ tỷ lệ cho phần tiết kiệm để bạn có vùng đệm an toàn hơn."
    );
  }

  if (flags.hasDependents) {
    extraNotes.push(
      "Bạn có nhắc đến gia đình/con cái nên nhóm nhu cầu thiết yếu (nhà ở, sinh hoạt) được ưu tiên cao hơn một chút."
    );
  }

  if (flags.hasDebt) {
    extraNotes.push(
      "Bạn đang có các khoản nợ/vay, nên một phần ngân sách tiết kiệm được hiểu là để trả nợ dần dần."
    );
  }

  const fixedNeedsPct =
    incomeAfterTax > 0 ? (fixed.needs / incomeAfterTax) * 100 : 0;
  const fixedWantsPct =
    incomeAfterTax > 0 ? (fixed.wants / incomeAfterTax) * 100 : 0;

  if (fixedNeedsPct > 0) {
    extraNotes.push(
      `Các khoản cố định thuộc nhóm nhu cầu thiết yếu hiện đang chiếm khoảng ${fixedNeedsPct.toFixed(
        0
      )}% thu nhập của bạn.`
    );
  }

  if (fixedNeedsPct > ratio.needs * 100 + 5) {
    extraNotes.push(
      "Chi phí thiết yếu của bạn đang cao hơn mức gợi ý, nên mình giảm nhẹ phần mong muốn/giải trí để tránh bị âm tiền vào cuối kỳ."
    );
  }

  if (fixedWantsPct > ratio.wants * 100 + 5) {
    extraNotes.push(
      "Các khoản cố định cho phần mong muốn (ăn ngoài, mua sắm, cafe, ...) đang tương đối cao, nếu cần tăng tốc tiết kiệm bạn có thể cắt giảm bớt ở nhóm này."
    );
  }

  if (fixedExpenses.length) {
    const sample = fixedExpenses
      .slice(0, 3)
      .map((e) => e.rawText)
      .join(", ");
    extraNotes.push(
      `Một số khoản chi cố định mình nhận diện được là: ${sample}${
        fixedExpenses.length > 3 ? ", ..." : ""
      }. Bạn có thể tinh chỉnh thêm nếu số liệu thực tế khác.`
    );
  }

  if (!extraNotes.length) {
    extraNotes.push(
      "Tỷ lệ hiện tại khá hài hòa với mô tả của bạn, bạn có thể dùng thẳng kế hoạch này hoặc chỉnh sửa nhẹ cho sát hơn với thực tế."
    );
  }

  return text + " " + extraNotes.join(" ");
}

// ================== 5. Hàm chính cho app ==================

export function suggestFullBudget(params: {
  incomeAfterTax: number;
  lifestyleDesc?: string;
}): FullBudgetSuggestion {
  const { incomeAfterTax } = params;
  const lifestyleDesc = params.lifestyleDesc || "";

  const smart = buildSmartRatioFromLifestyle(incomeAfterTax, lifestyleDesc);

  const needsSummary: GroupSummary = {
    target: smart.target.needs,
    fixed: smart.fixed.needs,
    flexible: Math.max(smart.target.needs - smart.fixed.needs, 0),
    overshoot: smart.fixed.needs > smart.target.needs,
  };

  const wantsSummary: GroupSummary = {
    target: smart.target.wants,
    fixed: smart.fixed.wants,
    flexible: Math.max(smart.target.wants - smart.fixed.wants, 0),
    overshoot: smart.fixed.wants > smart.target.wants,
  };

  const savingsSummary: GroupSummary = {
    target: smart.target.savings,
    fixed: smart.fixed.savings,
    flexible: Math.max(smart.target.savings - smart.fixed.savings, 0),
    overshoot: smart.fixed.savings > smart.target.savings,
  };

  const explanation = buildExplanation(
    incomeAfterTax,
    smart.persona,
    smart.ratio,
    smart.fixed,
    smart.flags,
    smart.fixedExpenses
  );

  return {
    incomeAfterTax,
    persona: smart.persona,
    ratio: smart.ratio,
    fixedExpenses: smart.fixedExpenses,
    flags: smart.flags,
    groupSummary: {
      needs: needsSummary,
      wants: wantsSummary,
      savings: savingsSummary,
    },
    explanation,
  };
}

export function suggestSimpleBudget(params: {
  incomeAfterTax: number;
  lifestyleDesc?: string;
}) {
  const full = suggestFullBudget(params);
  return {
    persona: full.persona,
    ratio: full.ratio,
    amounts: {
      needs: full.groupSummary.needs.target,
      wants: full.groupSummary.wants.target,
      savings: full.groupSummary.savings.target,
    },
  };
}
