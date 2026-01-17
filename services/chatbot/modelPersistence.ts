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

const LABELMAP_KEY = "chatbot_labelmap_v1";

export async function saveLabelMap(map: Record<number, string>) {
  try {
    await AsyncStorage.setItem(LABELMAP_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn("Failed to save label map:", e);
  }
}

export async function loadLabelMap(): Promise<Record<number, string> | null> {
  try {
    const raw = await AsyncStorage.getItem(LABELMAP_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<number, string>;
  } catch (e) {
    console.warn("Failed to load label map:", e);
    return null;
  }
}

const LABELMETA_KEY = "chatbot_labelmeta_v1";

export type LabelMeta = {
  id: string;
  name: string;
};

export async function saveLabelMeta(map: Record<number, LabelMeta>) {
  try {
    await AsyncStorage.setItem(LABELMETA_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn("Failed to save label meta:", e);
  }
}

export async function loadLabelMeta(): Promise<Record<number, LabelMeta> | null> {
  try {
    const raw = await AsyncStorage.getItem(LABELMETA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<number, LabelMeta>;
  } catch (e) {
    console.warn("Failed to load label meta:", e);
    return null;
  }
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

