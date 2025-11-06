import type { SQLiteDatabase } from "expo-sqlite";

type TxType = "expense" | "income";

export async function seedIfEmpty(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) c FROM accounts"
  );
  if ((row?.c ?? 0) > 0) return;

  await db.execAsync("BEGIN");
  try {
    await db.runAsync("INSERT INTO users(id,name) VALUES('u_demo','Me')");
    await db.runAsync(`INSERT INTO accounts(id,user_id,name,icon,color,include_in_total,balance_cached)
      VALUES('acc_wallet','u_demo','Wallet','wallet','red',1,12000)`);
    await db.runAsync(`INSERT INTO accounts(id,user_id,name,icon,color,include_in_total,balance_cached)
      VALUES('acc_bank','u_demo','Bank','bank','green',1,3210000000)`);

    await db.runAsync(`INSERT INTO categories(id,user_id,name,type,icon,color)
      VALUES('cat_4g','u_demo','4G','expense','wifi','#2ca9ff')`);
    await db.runAsync(`INSERT INTO categories(id,user_id,name,type,icon,color)
      VALUES('cat_salary','u_demo','Phiếu lương','income','banknote','#2563eb')`);

    const now = Math.floor(Date.now() / 1000);
    await db.runAsync(
      `INSERT INTO transactions(id,user_id,account_id,category_id,type,amount,note,occurred_at)
       VALUES('tx_1','u_demo','acc_bank','cat_4g','expense',150000,'Mạng 5g Viettel',?)`,
      [now]
    );

    await db.execAsync("COMMIT");
  } catch (e) {
    await db.execAsync("ROLLBACK");
    throw e;
  }
}
