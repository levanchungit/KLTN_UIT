// Simple preprocessing helpers for chatbot classifier
import { parseAmountVN } from "@/utils/textPreprocessing";
import { phobertExtractor } from "@/services/phobertAmountExtractor";

export async function extractAmountHybrid(text: string) {
  // Try phobert first (if available), fallback to regex-based parse
  try {
    const res = await phobertExtractor.extractAmount(text);
    if (res && res.amount != null) return res.amount;
  } catch (e) {
    // ignore and fallback
  }
  const parsed = parseAmountVN(text);
  return parsed ?? null;
}

export function normalizeForModel(text: string) {
  // Light normalization; tokenizer will handle more.
  return text.replace(/\s+/g, " ").trim();
}

