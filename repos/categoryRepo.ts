// categoryRepo.ts
import { openDb } from "@/db";

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

  const where: string[] = [];
  const vals: any[] = [];

  if (opts?.type) {
    where.push("type=?");
    vals.push(opts.type);
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
  return db.getFirstAsync<Category>(
    `SELECT id, user_id, name, type, icon, color, parent_id
     FROM categories WHERE id=?`,
    [id]
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
  const id = genId();
  const icon = normalizeIconForDb(input.icon ?? null);
  const color = input.color ?? null;
  const parent_id = input.parent_id ?? null;

  await db.runAsync(
    `INSERT INTO categories(
        id, user_id, name, type, icon, color, parent_id, created_at, updated_at
      )
      VALUES(?,?,?,?,?,?,?, strftime('%s','now'), strftime('%s','now'))`,
    [id, "u_demo", input.name.trim(), input.type, icon, color, parent_id]
  );
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

  await db.runAsync(`UPDATE categories SET ${set.join(",")} WHERE id=?`, [
    ...vals,
    id,
  ]);
}

export async function deleteCategory(id: string) {
  const db = await openDb();
  await db.runAsync(`DELETE FROM categories WHERE id=?`, [id]);
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
    { name: "Trả nợ", type: "expense", icon: "mi:money-off", color: "#7EC5E8" },
    { name: "Điện", type: "expense", icon: "mi:flash-on", color: "#66C2A3" },
    { name: "Wifi", type: "expense", icon: "mi:wifi", color: "#3A78D0" },
    { name: "4G", type: "expense", icon: "mi:sim-card", color: "#7EC5E8" },
    {
      name: "Đám tiệc",
      type: "expense",
      icon: "mi:celebration",
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
      icon: "mc:piggy-bank-outline",
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
