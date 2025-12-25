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
  vector: number[]; // Vector TF-IDF trung bình cho danh mục này
  sampleCount: number;
}

const MODEL_STORAGE_KEY = "transaction_classifier_model";
const VOCAB_STORAGE_KEY = "transaction_classifier_vocab";
const MIN_TRAINING_SAMPLES = 10; // Số mẫu tối thiểu để huấn luyện

class TransactionClassifier {
  private vocabulary: Map<string, number> = new Map();
  private categoryProfiles: CategoryProfile[] = [];
  private isModelReady = false;
  private isTraining = false;

  constructor() {
    this.initialize();
  }

  /**
   * Khởi tạo bộ phân loại - tải mô hình hiện có hoặc chuẩn bị cho huấn luyện
   */
  async initialize(): Promise<void> {
    try {
      await this.loadModel();
      if (!this.isModelReady) {
        console.log("No existing model found. Will train on first use.");
      }
    } catch (error) {
      console.error("Lỗi khi khởi tạo bộ phân loại:", error);
    }
  }

  /**
   * Lấy dữ liệu huấn luyện từ cơ sở dữ liệu
   * Ưu tiên: Sửa của người dùng (chosen_category_id) > Giao dịch
   */
  private async fetchTrainingData(): Promise<{
    data: TrainingData[];
    corrections: Set<string>; // Track which notes are from corrections
    categories: Category[];
  }> {
    await openDb();

    // Lấy tất cả danh mục chi tiêu và thu nhập
    const categories: Category[] = await db.getAllAsync<Category>(
      "SELECT * FROM categories WHERE type = 'expense' OR type = 'income'"
    );

    // Lấy các sửa của người dùng (ưu tiên cao nhất để học)
    // Đây là phản hồi rõ ràng khi họ sửa dự đoán sai
    const corrections = await db.getAllAsync<{
      text: string;
      chosen_category_id: string;
    }>(`
      SELECT text, chosen_category_id 
      FROM ml_training_samples
      WHERE chosen_category_id IS NOT NULL
        AND text IS NOT NULL 
        AND text != ''
      ORDER BY created_at DESC
      LIMIT 500
    `);

    // Theo dõi ghi chú từ sửa để xây dựng có trọng số
    const correctionNotes = new Set(corrections.map((c) => c.text));

    // Lấy các giao dịch có ghi chú (chi/thu) làm dữ liệu phụ
    const transactions = await db.getAllAsync<{
      note: string;
      category_id: string;
    }>(`
      SELECT t.note, t.category_id 
      FROM transactions t
      WHERE (t.type = 'expense' OR t.type = 'income')
        AND t.note IS NOT NULL 
        AND t.note != ''
        AND t.category_id IS NOT NULL
      ORDER BY t.occurred_at DESC
      LIMIT 1000
    `);

    // Kết hợp dữ liệu: sửa trước (phản hồi), rồi giao dịch
    // QUAN TRỌNG: Khử trùng lặp để tránh đếm một ghi chú hai lần
    const dataMap = new Map<string, TrainingData>();

    // Thêm sửa trước (ưu tiên cao hơn)
    corrections.forEach((c) => {
      const key = `${c.text}||${c.chosen_category_id}`;
      dataMap.set(key, {
        note: c.text,
        categoryId: c.chosen_category_id,
      });
    });

    // Add transactions (skip if already in corrections)
    transactions.forEach((t) => {
      const key = `${t.note}||${t.category_id}`;
      if (!dataMap.has(key)) {
        dataMap.set(key, {
          note: t.note,
          categoryId: t.category_id,
        });
      }
    });

    const data: TrainingData[] = Array.from(dataMap.values());

    return { data, corrections: correctionNotes, categories };
  }

  /**
   * Build category profiles (average vectors for each category)
   * Corrections get 3x weight to prioritize user feedback
   */
  private buildCategoryProfiles(
    data: TrainingData[],
    corrections: Set<string>,
    categories: Category[]
  ): CategoryProfile[] {
    const profiles: Map<
      string,
      { vectors: number[][]; weights: number[]; name: string }
    > = new Map();

    // Initialize profiles for all categories
    categories.forEach((cat) => {
      profiles.set(cat.id, { vectors: [], weights: [], name: cat.name });
    });

    // Convert each transaction note to vector and group by category
    data.forEach((sample) => {
      const vector = textToVector(sample.note, this.vocabulary);
      const normalized = normalizeVector(vector);

      const profile = profiles.get(sample.categoryId);
      if (profile) {
        profile.vectors.push(normalized);
        // Corrections get 3x weight (stronger signal)
        const weight = corrections.has(sample.note) ? 3.0 : 1.0;
        profile.weights.push(weight);
      }
    });

    // Calculate WEIGHTED average vector for each category
    const categoryProfiles: CategoryProfile[] = [];

    profiles.forEach((profile, categoryId) => {
      if (profile.vectors.length === 0) return;

      const vectorSize = profile.vectors[0].length;
      const weightedVectors: number[][] = [];
      let totalWeight = 0;
      let correctionCount = 0;

      // Apply weights to each vector BEFORE averaging
      profile.vectors.forEach((vec, idx) => {
        const weight = profile.weights[idx];
        if (weight > 1.0) correctionCount++;

        // Scale vector by weight
        const weightedVec = vec.map((val) => val * weight);
        weightedVectors.push(weightedVec);
        totalWeight += weight;
      });

      // Calculate simple average of weighted vectors
      const avgVector = new Array(vectorSize).fill(0);
      weightedVectors.forEach((vec) => {
        vec.forEach((val, idx) => {
          avgVector[idx] += val;
        });
      });

      // Divide by total weight to get proper weighted average
      avgVector.forEach((val, idx) => {
        avgVector[idx] = val / totalWeight;
      });

      // Normalize the final averaged vector to unit length
      const normalized = normalizeVector(avgVector);

      categoryProfiles.push({
        categoryId,
        categoryName: profile.name,
        vector: normalized,
        sampleCount: profile.vectors.length, // Original count (not weighted)
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
        this.vocabulary.clear();
        this.categoryProfiles = [];
      }

      // Fetch training data
      const { data, corrections, categories } = await this.fetchTrainingData();

      if (data.length < MIN_TRAINING_SAMPLES) {
        console.warn(
          `Warning: Only ${data.length} transactions with notes. Model may be less accurate.`
        );
        // Vẫn tiếp tục train với số lượng ít
      }

      // Build vocabulary with minFrequency = 1 to learn from single corrections
      // This allows the model to immediately recognize new words after just one correction
      const notes = data.map((d) => d.note);
      this.vocabulary = buildVocabulary(notes, 1);

      // Build category profiles with weighted corrections
      this.categoryProfiles = this.buildCategoryProfiles(
        data,
        corrections,
        categories
      );

      // Log per-category sample counts
      const samplesByCategory = new Map<string, number>();
      data.forEach((d) => {
        const count = samplesByCategory.get(d.categoryId) || 0;
        samplesByCategory.set(d.categoryId, count + 1);
      });

      // Save the model
      await this.saveModel();

      this.isModelReady = true;

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
      console.warn("Error training model:", error);
      return {
        success: false,
        message: `Training failed: ${error}`,
      };
    } finally {
      // Always reset training flag, even if an error occurred
      this.isTraining = false;
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
      // Debug: Show which words from note are in vocabulary
      const words = note.toLowerCase().split(/\s+/);
      const knownWords = words.filter((w) => this.vocabulary.has(w));

      // Convert note to vector
      const vector = textToVector(note, this.vocabulary);
      const normalized = normalizeVector(vector);

      // Calculate similarity with each category profile
      let maxSimilarity = 0;
      let bestCategory: CategoryProfile | null = null;

      // Calculate similarity for ALL categories and show top candidates
      const scores: {
        name: string;
        score: number;
        samples: number;
        rawSim: number;
      }[] = [];

      for (const profile of this.categoryProfiles) {
        const similarity = cosineSimilarity(normalized, profile.vector);

        // Use similarity directly (0-1 range), apply minimal sample boost ONLY for tie-breaking
        // Prevent multiplying > 1.0 which breaks similarity semantics
        let finalScore = similarity;

        // Only boost if similarity is high (> 0.5) and sampleCount provides evidence
        // This prevents high sample counts from dominating low similarity
        if (similarity > 0.5) {
          const sampleBoost = Math.min(
            0.1,
            Math.log(profile.sampleCount + 1) * 0.01
          );
          finalScore = Math.min(1.0, similarity + sampleBoost); // CAP AT 1.0!
        }

        scores.push({
          name: profile.categoryName,
          score: finalScore,
          samples: profile.sampleCount,
          rawSim: similarity,
        });

        if (finalScore > maxSimilarity) {
          maxSimilarity = finalScore;
          bestCategory = profile;
        }
      }

      // Lower threshold (0.05) to allow predictions even with sparse training data
      // This is important for learning from single corrections
      if (!bestCategory || maxSimilarity < 0.05) {
        return null;
      }

      // Get category details
      await openDb();
      const category = await db.getFirstAsync<Category>(
        "SELECT * FROM categories WHERE id = ?",
        bestCategory.categoryId
      );

      return {
        categoryId: bestCategory.categoryId,
        confidence: Math.min(1.0, maxSimilarity), // Cap at 1.0 (100%)
        categoryName: category?.name || bestCategory.categoryName,
        categoryIcon: category?.icon || undefined,
      };
    } catch (error) {
      console.error("Error predicting category:", error);
      return null;
    }
  }

  /**
   * Predict top 3 categories with confidence scores (multi-label)
   * Used for showing user alternative suggestions
   */
  async predictCategoryWithAlternatives(
    note: string
  ): Promise<{ primary: PredictionResult; alternatives: PredictionResult[] }> {
    if (!this.isModelReady) {
      console.log("Model not ready. Training...");
      const result = await this.trainModel();
      if (!result.success) {
        return {
          primary: {
            categoryId: "",
            confidence: 0,
            categoryName: "Unknown",
          },
          alternatives: [],
        };
      }
    }

    try {
      console.log(`🔍 Predicting alternatives for: "${note}"`);

      // Convert note to vector
      const vector = textToVector(note, this.vocabulary);
      const normalized = normalizeVector(vector);

      // Calculate similarity with each category profile
      const similarities: Array<{
        profile: CategoryProfile;
        similarity: number;
      }> = [];

      for (const profile of this.categoryProfiles) {
        const similarity = cosineSimilarity(normalized, profile.vector);

        // Apply same logic as predictCategory: add-on boost instead of multiply
        let finalScore = similarity;
        if (similarity > 0.5) {
          const sampleBoost = Math.min(
            0.1,
            Math.log(profile.sampleCount + 1) * 0.01
          );
          finalScore = similarity + sampleBoost;
        }

        similarities.push({
          profile,
          similarity: finalScore,
        });
      }

      // Sort by similarity descending
      similarities.sort((a, b) => b.similarity - a.similarity);

      if (similarities.length === 0) {
        return {
          primary: {
            categoryId: "",
            confidence: 0,
            categoryName: "Unknown",
          },
          alternatives: [],
        };
      }

      // Get category details from DB
      await openDb();
      const categories = await db.getAllAsync<Category>(
        "SELECT * FROM categories"
      );
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      // Convert to confidence scores (0-100%)
      const topPredictions = similarities
        .slice(0, 3)
        .filter((s) => s.similarity > 0.05)
        .map((s) => {
          const category = categoryMap.get(s.profile.categoryId);
          return {
            categoryId: s.profile.categoryId,
            confidence: Math.min(Math.round(s.similarity * 100), 100),
            categoryName: category?.name || s.profile.categoryName,
            categoryIcon: category?.icon || undefined,
          };
        });

      if (topPredictions.length === 0) {
        return {
          primary: {
            categoryId: "",
            confidence: 0,
            categoryName: "Unknown",
          },
          alternatives: [],
        };
      }

      const primary = topPredictions[0];
      const alternatives = topPredictions.slice(1);

      console.log(
        `✅ Primary: ${primary.categoryName} (${primary.confidence}%)`
      );
      if (alternatives.length > 0) {
        console.log(
          `🔄 Alternatives: ${alternatives
            .map((a) => `${a.categoryName} (${a.confidence}%)`)
            .join(", ")}`
        );
      }

      return { primary, alternatives };
    } catch (error) {
      console.error("Error predicting alternatives:", error);
      return {
        primary: {
          categoryId: "",
          confidence: 0,
          categoryName: "Unknown",
        },
        alternatives: [],
      };
    }
  }

  /**
   * Incremental learning - retrain with new transaction
   * Train continuously after every transaction for immediate learning
   */
  async learnFromNewTransaction(
    note: string,
    categoryId: string
  ): Promise<void> {
    // Get current transaction count
    await openDb();
    const result = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions WHERE (type = "expense" OR type = "income") AND note IS NOT NULL'
    );

    const count = result?.count || 0;

    await this.trainModel(true);
  }

  /**
   * Learn from user correction (immediate retrain)
   * Called when user edits a transaction to fix wrong category
   */
  async learnFromCorrection(note: string, categoryId: string): Promise<void> {
    await this.trainModel(true);
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
    } catch (error) {
      console.warn("Error saving model:", error);
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
      }
    } catch (error) {
      console.warn("Error loading model:", error);
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
