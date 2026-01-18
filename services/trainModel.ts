// Simple training simulator for UI progress. Replace with real training logic.
export async function trainModel(onProgress: (p: number, stage?: string) => void) {
  // Simulate 10 batches
  const batches = 10;
  for (let i = 0; i <= batches; i++) {
    const percent = Math.round((i / batches) * 100);
    onProgress(percent, `batch_${i}`);
    // yield to UI thread
    await new Promise((r) => setTimeout(r, 400));
  }
  // Simulate finalization
  await new Promise((r) => setTimeout(r, 300));
}

