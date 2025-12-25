import { openDb } from "@/db";
import { scheduleSyncDebounced } from "@/services/syncTrigger";
import { getCurrentUserId } from "@/utils/auth";

/** ===== Types ===== */
export type Category = {
  id: string;
  user_id?: string | null;
  name: string;
  type: "expense" | "income";
  icon?: string | null; // "mi:assignment" | "mc:gift-outline"
  color?: string | null;
  parent_id?: string | null;
};

/** ===== Helpers ===== */
const genId = () => "cat_" + Math.random().toString(36).slice(2, 10);

// Chuẩn hoá icon để lưu DB (tránh undefined)
function normalizeIconForDb(icon?: string | null): string | null {
  if (!icon) return null;
  if (icon.startsWith("mci:")) return icon.replace(/^mci:/, "mc:");
  if (!icon.includes(":")) return `mi:${icon}`;
  return icon;
}

/** ===== Queries ===== */
export async function listCategories(opts?: {
  type?: "expense" | "income";
  parent_id?: string | null;
}): Promise<Category[]> {
  const db = await openDb();
  const userId = await getCurrentUserId();

  const where: string[] = [];
  const vals: any[] = [];

  if (opts?.type) {
    where.push("type=?");
    vals.push(opts.type);
  }
  // Only list categories that belong to current user
  if (userId) {
    where.push("user_id=?");
    vals.push(userId);
  }
  if (opts && "parent_id" in opts) {
    if (opts.parent_id === null) {
      where.push("parent_id IS NULL");
    } else if (opts.parent_id) {
      where.push("parent_id=?");
      vals.push(opts.parent_id);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return db.getAllAsync<Category>(
    `SELECT id, user_id, name, type, icon, color, parent_id
     FROM categories
     ${whereSql}
     ORDER BY name ASC`,
    vals
  );
}

export async function getCategoryById(id: string) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  return db.getFirstAsync<Category>(
    `SELECT id, user_id, name, type, icon, color, parent_id
     FROM categories WHERE id=? AND user_id=?`,
    [id, userId]
  );
}

export async function createCategory(input: {
  name: string;
  type: "expense" | "income";
  icon?: string | null;
  color?: string | null;
  parent_id?: string | null;
}) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  const id = genId();
  const icon = normalizeIconForDb(input.icon ?? null);
  const color = input.color ?? null;
  const parent_id = input.parent_id ?? null;

  await db.runAsync(
    `INSERT INTO categories(
        id, user_id, name, type, icon, color, parent_id, created_at, updated_at
      )
      VALUES(?,?,?,?,?,?,?, strftime('%s','now'), strftime('%s','now'))`,
    [id, userId, input.name.trim(), input.type, icon, color, parent_id]
  );
  try {
    scheduleSyncDebounced(userId);
  } catch (e) {
    scheduleSyncDebounced();
  }
  return id;
}

export async function updateCategory(
  id: string,
  input: {
    name?: string;
    type?: "expense" | "income";
    icon?: string | null;
    color?: string | null;
    parent_id?: string | null;
  }
) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  const set: string[] = [];
  const vals: any[] = [];

  if (input.name != null) {
    set.push("name=?");
    vals.push(input.name.trim());
  }
  if (input.type != null) {
    set.push("type=?");
    vals.push(input.type);
  }
  if (input.icon !== undefined) {
    set.push("icon=?");
    vals.push(normalizeIconForDb(input.icon ?? null));
  }
  if (input.color !== undefined) {
    set.push("color=?");
    vals.push(input.color ?? null);
  }
  if (input.parent_id !== undefined) {
    set.push("parent_id=?");
    vals.push(input.parent_id ?? null);
  }

  // luôn cập nhật updated_at
  set.push("updated_at=strftime('%s','now')");

  await db.runAsync(
    `UPDATE categories SET ${set.join(",")} WHERE id=? AND user_id=?`,
    [...vals, id, userId]
  );
  // schedule sync
  scheduleSyncDebounced(userId);
}

export async function deleteCategory(id: string) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  await db.runAsync(`DELETE FROM categories WHERE id=? AND user_id=?`, [
    id,
    userId,
  ]);
  scheduleSyncDebounced(userId);
  // write tombstone to Firestore so other clients can delete
  try {
    const s = await import("@/services/firestoreSync");
    s.markRemoteDeleted("categories", id, userId).catch((e) => console.warn(e));
  } catch (e) {
    // ignore if firestore not available
  }
}

/** ===== Seed (tùy chọn) ===== */
export async function seedCategoryDefaults() {
  const db = await openDb();
  const count = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM categories"
  );
  if ((count?.c ?? 0) > 0) return;

  const defaults: {
    name: string;
    type: "expense" | "income";
    icon: string;
    color: string;
  }[] = [
    {
      name: "Trả nợ",
      type: "expense",
      icon: "mc:cash-remove",
      color: "#7EC5E8",
    },
    {
      name: "Điện",
      type: "expense",
      icon: "mc:lightning-bolt",
      color: "#66C2A3",
    },
    { name: "Wifi", type: "expense", icon: "mc:wifi", color: "#3A78D0" },
    { name: "4G", type: "expense", icon: "mc:sim", color: "#7EC5E8" },
    {
      name: "Đám tiệc",
      type: "expense",
      icon: "mc:party-popper",
      color: "#EE4DB4",
    },
    {
      name: "Mỹ phẩm chăm sóc",
      type: "expense",
      icon: "mc:bottle-tonic-outline",
      color: "#F6C33E",
    },
    {
      name: "Hớt tóc",
      type: "expense",
      icon: "mc:content-cut",
      color: "#7AC15B",
    },
    {
      name: "Tiết kiệm",
      type: "income",
      icon: "mc:piggy-bank",
      color: "#F6C33E",
    },
    {
      name: "Khác",
      type: "expense",
      icon: "mc:help-circle-outline",
      color: "#E84A3C",
    },
    {
      name: "Tạp phẩm",
      type: "expense",
      icon: "mc:basket-outline",
      color: "#7EC5E8",
    },
    {
      name: "Di chuyển",
      type: "expense",
      icon: "mc:car-outline",
      color: "#3A78D0",
    },
    {
      name: "Giáo dục",
      type: "expense",
      icon: "mc:school-outline",
      color: "#EE4DB4",
    },
    {
      name: "Giải trí",
      type: "expense",
      icon: "mc:gamepad-circle-outline",
      color: "#7AC15B",
    },
    {
      name: "Sức khỏe",
      type: "expense",
      icon: "mc:heart-outline",
      color: "#E84A3C",
    },
    {
      name: "Tập thể dục",
      type: "expense",
      icon: "mc:arm-flex-outline",
      color: "#7FBF5B",
    },
    {
      name: "Gia đình",
      type: "expense",
      icon: "mc:account-group-outline",
      color: "#E84A3C",
    },
    {
      name: "Cafe",
      type: "expense",
      icon: "mc:coffee-outline",
      color: "#F6C33E",
    },
    {
      name: "Trang chủ",
      type: "expense",
      icon: "mc:home-outline",
      color: "#3A78D0",
    },
    {
      name: "Quà tặng",
      type: "expense",
      icon: "mc:gift-outline",
      color: "#7AC15B",
    },
  ];

  for (const d of defaults) {
    await createCategory({
      name: d.name,
      type: d.type,
      icon: d.icon,
      color: d.color,
    });
  }
}

/** Đảm bảo danh mục ngân sách demo tồn tại với biểu tượng/màu sắc phù hợp */
export async function ensureDemoBudgetCategories() {
  const base: Array<{
    name: string;
    type: "expense" | "income";
    icon: string;
    color: string;
  }> = [
    { name: "Ăn uống", type: "expense", icon: "mc:food", color: "#F29F3F" },
    { name: "Hóa đơn", type: "expense", icon: "mc:receipt", color: "#B19CD9" },
    { name: "Bảo hiểm", type: "expense", icon: "mc:shield", color: "#2E86C1" },
    {
      name: "Di chuyển",
      type: "expense",
      icon: "mc:car-outline",
      color: "#3A78D0",
    },
    {
      name: "Mua sắm",
      type: "expense",
      icon: "mc:cart-outline",
      color: "#18A689",
    },
    { name: "Giải trí", type: "expense", icon: "mc:film", color: "#C7CEEA" },
    {
      name: "Thể thao",
      type: "expense",
      icon: "mc:dumbbell",
      color: "#FF8B94",
    },
    { name: "Học tập", type: "expense", icon: "mc:book", color: "#95E1D3" },
    { name: "Lương", type: "income", icon: "mc:cash", color: "#52C41A" },
  ];

  const existing = await listCategories();
  const names = new Set(existing.map((c) => c.name));

  for (const d of base) {
    if (!names.has(d.name)) {
      await createCategory({
        name: d.name,
        type: d.type,
        icon: d.icon,
        color: d.color,
      });
    }
  }
}
