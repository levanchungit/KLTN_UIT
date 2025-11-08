import { db, openDb } from "@/db";

export type MLTrainingSample = {
  id: string;
  user_id: string;
  text: string;
  amount: number | null;
  io: "IN" | "OUT";
  predicted_category_id: string | null;
  chosen_category_id: string | null;
  confidence: number | null;
  created_at: number;
};

function makeId() {
  return "ml_" + Math.random().toString(36).slice(2, 10);
}

export async function logPrediction(sample: {
  text: string;
  amount: number | null;
  io: "IN" | "OUT";
  predictedCategoryId: string | null;
  confidence: number | null;
}) {
  await openDb();
  const id = makeId();
  // Use string interpolation to avoid binding type inference issues in this TS setup
  const amountVal = sample.amount != null ? sample.amount : "NULL";
  const predVal = sample.predictedCategoryId
    ? `'${sample.predictedCategoryId}'`
    : "NULL";
  const confVal = sample.confidence != null ? sample.confidence : "NULL";
  const sql = `INSERT INTO ml_training_samples(id,user_id,text,amount,io,predicted_category_id,confidence)
               VALUES('${id}','u_demo','${sample.text.replace(
    /'/g,
    "''"
  )}','${amountVal}','${sample.io}',${predVal},${confVal})`;
  await db.execAsync(sql);
  return id;
}

export async function logCorrection(params: {
  id: string; // existing ml_training_samples id
  chosenCategoryId: string;
}) {
  await openDb();
  const sql = `UPDATE ml_training_samples SET chosen_category_id='${params.chosenCategoryId}' WHERE id='${params.id}'`;
  await db.execAsync(sql);
}

export async function listRecentSamples(
  limit = 200
): Promise<MLTrainingSample[]> {
  await openDb();
  return db.getAllAsync<MLTrainingSample>(
    `SELECT * FROM ml_training_samples
     WHERE user_id='u_demo'
     ORDER BY created_at DESC
     LIMIT ${limit}`
  );
}

// Aggregate counts per (predicted_category_id, chosen_category_id) to evaluate accuracy
export async function confusionPairs() {
  await openDb();
  return db.getAllAsync<{
    predicted_category_id: string | null;
    chosen_category_id: string | null;
    cnt: number;
  }>(
    `SELECT predicted_category_id, chosen_category_id, COUNT(*) as cnt
     FROM ml_training_samples
     WHERE user_id='u_demo'
     GROUP BY predicted_category_id, chosen_category_id`
  );
}
