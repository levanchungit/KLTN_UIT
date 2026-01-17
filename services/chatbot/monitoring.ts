// Lightweight metrics helper for chatbot module
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "chatbot_metrics_v1:";

export async function logLatency(name: string, ms: number) {
  try {
    const key = KEY_PREFIX + "latency";
    const entry = { name, ms, ts: Date.now() };
    const raw = (await AsyncStorage.getItem(key)) || "[]";
    const arr = JSON.parse(raw);
    arr.push(entry);
    await AsyncStorage.setItem(key, JSON.stringify(arr.slice(-200))); // keep last 200
  } catch (e) {
    // ignore
  }
  console.log(`[chatbot][latency] ${name} = ${ms}ms`);
}

export async function logAccuracy(sampleId: string, predicted: string, chosen: string) {
  try {
    const key = KEY_PREFIX + "accuracy";
    const entry = { sampleId, predicted, chosen, ts: Date.now() };
    const raw = (await AsyncStorage.getItem(key)) || "[]";
    const arr = JSON.parse(raw);
    arr.push(entry);
    await AsyncStorage.setItem(key, JSON.stringify(arr.slice(-500)));
  } catch (e) {
    // ignore
  }
  console.log(`[chatbot][accuracy] sample=${sampleId} pred=${predicted} chosen=${chosen}`);
}

