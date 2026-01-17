// Lightweight tokenizer utilities for chatbot classifier
// NOTE: This is a scaffold. Implement robust normalization/tokenization later.
import AsyncStorage from "@react-native-async-storage/async-storage";

export type WordIndex = Record<string, number>;

const TOKENIZER_KEY = "chatbot_tokenizer_v1";

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const n = normalizeText(text);
  if (!n) return [];
  return n.split(" ");
}

export function textToSequence(
  text: string,
  wordIndex: WordIndex,
  maxLen: number
): number[] {
  const tokens = tokenize(text);
  const seq = tokens.map((t) => wordIndex[t] ?? 1); // 1 = OOV
  if (seq.length >= maxLen) return seq.slice(0, maxLen);
  const pad = new Array(maxLen - seq.length).fill(0);
  return [...seq, ...pad];
}

export async function saveWordIndex(wordIndex: WordIndex) {
  try {
    await AsyncStorage.setItem(TOKENIZER_KEY, JSON.stringify(wordIndex));
  } catch (e) {
    console.warn("Failed to save tokenizer:", e);
  }
}

export async function loadWordIndex(): Promise<WordIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKENIZER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WordIndex;
  } catch (e) {
    console.warn("Failed to load tokenizer:", e);
    return null;
  }
}

