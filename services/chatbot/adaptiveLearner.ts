// Adaptive learner scaffold: collects corrections and triggers small fine-tune jobs
// Implementation must debounce and batch updates to avoid blocking UI.
import { transactionClassifier } from "./transactionClassifier";

type Correction = { text: string; categoryId: string; sampleId?: string };

class AdaptiveLearner {
  private queue: Correction[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 3000;

  enqueue(corr: Correction) {
    this.queue.push(corr);
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private async flush() {
    this.timer = null;
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, 5); // small-batch
    try {
      // Convert batch to training tensors and fine-tune classifier
      for (const c of batch) {
        await transactionClassifier.learnFromCorrection(c.text, c.categoryId);
      }
    } catch (e) {
      console.warn("AdaptiveLearner flush failed:", e);
    }
  }
}

export const adaptiveLearner = new AdaptiveLearner();

