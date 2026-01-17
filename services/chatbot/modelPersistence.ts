import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as tf from "@tensorflow/tfjs";

const MODEL_DIR = `${FileSystem.documentDirectory}chatbot_model/`;
const METADATA_KEY = "chatbot_model_metadata_v1";

export type ModelMetadata = {
  version: string;
  savedAt: number;
  vocabHash?: string;
};

export async function ensureModelDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    }
  } catch (e) {
    console.warn("Failed to ensure model dir:", e);
  }
}

export async function saveMetadata(meta: ModelMetadata) {
  try {
    await AsyncStorage.setItem(METADATA_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn("Failed to save model metadata:", e);
  }
}

export async function loadMetadata(): Promise<ModelMetadata | null> {
  try {
    const raw = await AsyncStorage.getItem(METADATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ModelMetadata;
  } catch (e) {
    console.warn("Failed to load model metadata:", e);
    return null;
  }
}

// NOTE: actual model save/load will use tfjs' model.save(modelUrl)
// These helpers provide filesystem paths for that purpose.
export function modelSaveUrl(): string {
  return `${MODEL_DIR}model.json`;
}

export async function saveModel(model: tf.LayersModel) {
  try {
    await ensureModelDir();
    const saveUrl = `file://${modelSaveUrl()}`;
    await model.save(saveUrl);
  } catch (e) {
    console.warn("Failed to save model:", e);
  }
}

export async function loadModel(): Promise<tf.LayersModel | null> {
  try {
    const info = await FileSystem.getInfoAsync(modelSaveUrl());
    if (!info.exists) return null;
    const loadUrl = `file://${modelSaveUrl()}`;
    const m = await tf.loadLayersModel(loadUrl);
    return m;
  } catch (e) {
    console.warn("Failed to load model:", e);
    return null;
  }
}

