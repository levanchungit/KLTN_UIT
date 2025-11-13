/**
 * Transaction Classifier using Lightweight ML
 * AI-powered automatic category prediction based on transaction notes
 * Using TF-IDF + Cosine Similarity (no TensorFlow.js dependency)
 */

import { db, openDb } from "@/db";
import type { Category } from "@/repos/categoryRepo";
import {
  buildVocabulary,
  cosineSimilarity,
  normalizeVector,
  textToVector,
} from "@/utils/textPreprocessing";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface TrainingData {
  note: string;
  categoryId: string;
}

interface PredictionResult {
  categoryId: string;
  confidence: number;
  categoryName?: string;
  categoryIcon?: string;
}

interface CategoryProfile {
  categoryId: string;
  categoryName: string;
  vector: number[]; // Average TF-IDF vector for this category
  sampleCount: number;
}

const MODEL_STORAGE_KEY = "transaction_classifier_model";
const VOCAB_STORAGE_KEY = "transaction_classifier_vocab";
const MIN_TRAINING_SAMPLES = 10; // Minimum samples needed to train

class TransactionClassifier {
  private vocabulary: Map<string, number> = new Map();
  private categoryProfiles: CategoryProfile[] = [];
  private isModelReady = false;
  private isTraining = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the classifier - load existing model or prepare for training
   */
  async initialize(): Promise<void> {
    try {
      await this.loadModel();
      if (!this.isModelReady) {
        console.log("No existing model found. Will train on first use.");
      }
    } catch (error) {
      console.error("Error initializing classifier:", error);
    }
  }

  /**
   * Fetch training data from database
   */
  private async fetchTrainingData(): Promise<{
    data: TrainingData[];
    categories: Category[];
  }> {
    await openDb();

    // Get all expense categories
    const categories: Category[] = await db.getAllAsync<Category>(
      "SELECT * FROM categories WHERE type = ?",
      "expense"
    );

    // Get all transactions with notes
    const transactions = await db.getAllAsync<{
      note: string;
      category_id: string;
    }>(`
      SELECT t.note, t.category_id 
      FROM transactions t
      WHERE t.type = 'expense' 
        AND t.note IS NOT NULL 
        AND t.note != ''
        AND t.category_id IS NOT NULL
      ORDER BY t.occurred_at DESC
      LIMIT 1000
    `);

    const data: TrainingData[] = transactions.map((t) => ({
      note: t.note,
      categoryId: t.category_id,
    }));

    return { data, categories };
  }

  /**
   * Build category profiles (average vectors for each category)
   */
  private buildCategoryProfiles(
    data: TrainingData[],
    categories: Category[]
  ): CategoryProfile[] {
    const profiles: Map<string, { vectors: number[][]; name: string }> =
      new Map();

    // Initialize profiles for all categories
    categories.forEach((cat) => {
      profiles.set(cat.id, { vectors: [], name: cat.name });
    });

    // Convert each transaction note to vector and group by category
    data.forEach((sample) => {
      const vector = textToVector(sample.note, this.vocabulary);
      const normalized = normalizeVector(vector);

      const profile = profiles.get(sample.categoryId);
      if (profile) {
        profile.vectors.push(normalized);
      }
    });

    // Calculate average vector for each category
    const categoryProfiles: CategoryProfile[] = [];

    profiles.forEach((profile, categoryId) => {
      if (profile.vectors.length === 0) return;

      const vectorSize = profile.vectors[0].length;
      const avgVector = new Array(vectorSize).fill(0);

      // Sum all vectors
      profile.vectors.forEach((vec) => {
        vec.forEach((val, idx) => {
          avgVector[idx] += val;
        });
      });

      // Divide by count to get average
      const count = profile.vectors.length;
      avgVector.forEach((val, idx) => {
        avgVector[idx] = val / count;
      });

      categoryProfiles.push({
        categoryId,
        categoryName: profile.name,
        vector: normalizeVector(avgVector),
        sampleCount: count,
      });
    });

    return categoryProfiles;
  }

  /**
   * Train the model with transaction history
   */
  async trainModel(forceRetrain = false): Promise<{
    success: boolean;
    accuracy?: number;
    samples?: number;
    message?: string;
  }> {
    if (this.isTraining) {
      return { success: false, message: "Model is already training" };
    }

    if (this.isModelReady && !forceRetrain) {
      return { success: true, message: "Model is already trained" };
    }

    this.isTraining = true;

    try {
      // Clear old model data before retraining
      if (forceRetrain) {
        console.log("🗑️  Clearing old model before retrain...");
        this.vocabulary.clear();
        this.categoryProfiles = [];
      }

      // Fetch training data
      const { data, categories } = await this.fetchTrainingData();

      if (data.length < MIN_TRAINING_SAMPLES) {
        this.isTraining = false;
        return {
          success: false,
          message: `Need at least ${MIN_TRAINING_SAMPLES} transactions with notes to train. Currently have ${data.length}.`,
        };
      }

      console.log(
        `Training with ${data.length} samples from ${categories.length} categories`
      );

      // Build vocabulary
      const notes = data.map((d) => d.note);
      this.vocabulary = buildVocabulary(notes, 2);

      console.log(`Vocabulary size: ${this.vocabulary.size}`);

      // Build category profiles
      this.categoryProfiles = this.buildCategoryProfiles(data, categories);

      console.log(`Built ${this.categoryProfiles.length} category profiles`);

      // Save the model
      await this.saveModel();

      this.isModelReady = true;
      this.isTraining = false;

      // Calculate approximate accuracy using cross-validation on sample
      let correct = 0;
      const testSamples = data.slice(0, Math.min(50, data.length));

      for (const sample of testSamples) {
        const prediction = await this.predictCategory(sample.note);
        if (prediction && prediction.categoryId === sample.categoryId) {
          correct++;
        }
      }

      const accuracy =
        testSamples.length > 0 ? correct / testSamples.length : 0;

      return {
        success: true,
        accuracy,
        samples: data.length,
        message: `Model trained successfully with ${(accuracy * 100).toFixed(
          1
        )}% accuracy`,
      };
    } catch (error) {
      this.isTraining = false;
      console.error("Error training model:", error);
      return {
        success: false,
        message: `Training failed: ${error}`,
      };
    }
  }

  /**
   * Predict category for a transaction note
   */
  async predictCategory(note: string): Promise<PredictionResult | null> {
    if (!this.isModelReady) {
      console.log("Model not ready. Training...");
      const result = await this.trainModel();
      if (!result.success) {
        return null;
      }
    }

    try {
      console.log(`🔍 Predicting for: "${note}"`);
      console.log(
        `📊 Current model: ${this.vocabulary.size} words, ${this.categoryProfiles.length} categories`
      );

      // Convert note to vector
      const vector = textToVector(note, this.vocabulary);
      const normalized = normalizeVector(vector);

      // Calculate similarity with each category profile
      let maxSimilarity = 0;
      let bestCategory: CategoryProfile | null = null;

      for (const profile of this.categoryProfiles) {
        const similarity = cosineSimilarity(normalized, profile.vector);

        // Weight by sample count (categories with more samples get slight boost)
        const weightedSimilarity =
          similarity * (1 + Math.log(profile.sampleCount) * 0.1);

        if (weightedSimilarity > maxSimilarity) {
          maxSimilarity = weightedSimilarity;
          bestCategory = profile;
        }
      }

      if (!bestCategory || maxSimilarity < 0.1) {
        console.log("❌ No confident prediction (max similarity < 0.1)");
        return null;
      }

      console.log(
        `✅ Predicted: ${bestCategory.categoryName} (confidence: ${(
          maxSimilarity * 100
        ).toFixed(1)}%)`
      );

      // Get category details
      await openDb();
      const category = await db.getFirstAsync<Category>(
        "SELECT * FROM categories WHERE id = ?",
        bestCategory.categoryId
      );

      return {
        categoryId: bestCategory.categoryId,
        confidence: maxSimilarity,
        categoryName: category?.name || bestCategory.categoryName,
        categoryIcon: category?.icon || undefined,
      };
    } catch (error) {
      console.error("Error predicting category:", error);
      return null;
    }
  }

  /**
   * Incremental learning - retrain with new transaction
   */
  async learnFromNewTransaction(
    note: string,
    categoryId: string
  ): Promise<void> {
    // Get current transaction count
    await openDb();
    const result = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions WHERE type = "expense" AND note IS NOT NULL'
    );

    // Retrain every 10 new transactions
    if (result && result.count % 10 === 0) {
      console.log("Triggering model retrain after 10 new transactions");
      await this.trainModel(true);
    }
  }

  /**
   * Learn from user correction (immediate retrain)
   * Called when user edits a transaction to fix wrong category
   */
  async learnFromCorrection(note: string, categoryId: string): Promise<void> {
    console.log(`🔄 User corrected: "${note}" → category ${categoryId}`);
    console.log("⏳ Retraining AI immediately with new data...");

    // Force retrain immediately and WAIT for completion
    const result = await this.trainModel(true);

    if (result.success) {
      console.log(
        `✅ AI retrained successfully! Accuracy: ${
          result.accuracy ? (result.accuracy * 100).toFixed(1) : "N/A"
        }%`
      );
      console.log(
        `📊 Vocabulary size: ${this.vocabulary.size}, Categories: ${this.categoryProfiles.length}`
      );
    } else {
      console.error("❌ AI retrain failed:", result.message);
    }
  }

  /**
   * Save model to storage
   */
  private async saveModel(): Promise<void> {
    try {
      // Save vocabulary
      await AsyncStorage.setItem(
        VOCAB_STORAGE_KEY,
        JSON.stringify(Array.from(this.vocabulary.entries()))
      );

      // Save category profiles
      await AsyncStorage.setItem(
        MODEL_STORAGE_KEY,
        JSON.stringify(this.categoryProfiles)
      );

      console.log("Model saved successfully");
    } catch (error) {
      console.error("Error saving model:", error);
    }
  }

  /**
   * Load model from storage
   */
  private async loadModel(): Promise<void> {
    try {
      // Load vocabulary
      const vocabData = await AsyncStorage.getItem(VOCAB_STORAGE_KEY);
      if (vocabData) {
        this.vocabulary = new Map(JSON.parse(vocabData));
      }

      // Load category profiles
      const profileData = await AsyncStorage.getItem(MODEL_STORAGE_KEY);
      if (profileData) {
        this.categoryProfiles = JSON.parse(profileData);
      }

      if (this.vocabulary.size > 0 && this.categoryProfiles.length > 0) {
        this.isModelReady = true;
        console.log("Model loaded successfully");
      }
    } catch (error) {
      console.error("Error loading model:", error);
      this.isModelReady = false;
    }
  }

  /**
   * Clear saved model and reset
   */
  async clearModel(): Promise<void> {
    this.vocabulary.clear();
    this.categoryProfiles = [];
    this.isModelReady = false;

    await AsyncStorage.multiRemove([MODEL_STORAGE_KEY, VOCAB_STORAGE_KEY]);

    console.log("Model cleared");
  }

  /**
   * Get model status
   */
  getStatus(): {
    isReady: boolean;
    isTraining: boolean;
    vocabularySize: number;
    numCategories: number;
  } {
    return {
      isReady: this.isModelReady,
      isTraining: this.isTraining,
      vocabularySize: this.vocabulary.size,
      numCategories: this.categoryProfiles.length,
    };
  }
}

// Export singleton instance
export const transactionClassifier = new TransactionClassifier();

// Export types
export type { PredictionResult, TrainingData };
