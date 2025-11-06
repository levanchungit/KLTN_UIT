import { openDb } from ".";

type TxType = "expense" | "income";

export async function seedSampleMonth({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const db = await openDb();
  // ... giữ nguyên nội dung seedSampleMonth bạn đang có
}

export async function seedSampleMonthRandom({
  year,
  month,
  count = 15,
}: {
  year: number;
  month: number;
  count?: number;
}) {
  const db = await openDb();
  // ... hàm random nếu bạn có
}
