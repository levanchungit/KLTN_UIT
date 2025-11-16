import { useUser } from "@/context/userContext";
import { db, openDb } from "@/db";
import { fixIconName } from "@/utils/iconMapper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const expenseSuggestions = [
  { id: "cat_food", name: "Thức ăn & Đồ uống", icon: "mc:food" },
  { id: "cat_house", name: "Nhà", icon: "mc:home" },
  { id: "cat_shopping", name: "Mua sắm", icon: "mc:shopping" },
  { id: "cat_transport", name: "Giao thông", icon: "mc:car" },
  { id: "cat_travel", name: "Du lịch", icon: "mc:airplane" },
  { id: "cat_entertain", name: "Giải trí", icon: "mc:gamepad-variant" },
  { id: "cat_health", name: "Sức khỏe", icon: "mc:pill" },
];

const incomeSuggestions = [
  { id: "cat_salary", name: "Lương", icon: "mc:cash" },
];

// Template IDs for built-in suggestions (used to create per-user DB ids)
const TEMPLATE_IDS = new Set<string>([
  ...expenseSuggestions.map((s) => s.id),
  ...incomeSuggestions.map((s) => s.id),
]);

const ICON_OPTIONS = [
  { name: "Thức ăn", icon: "mc:food" },
  { name: "Du lịch", icon: "mc:airplane" },
  { name: "Mua sắm", icon: "mc:shopping" },
  { name: "Nhà", icon: "mc:home" },
  { name: "Xe", icon: "mc:car" },
  { name: "Giải trí", icon: "mc:gamepad-variant" },
  { name: "Sức khỏe", icon: "mc:pill" },
  { name: "Giáo dục", icon: "mc:school" },
  { name: "Thể thao", icon: "mc:run" },
  { name: "Quà tặng", icon: "mc:gift" },
  { name: "Tiền lương", icon: "mc:cash" },
  { name: "Cafe", icon: "mc:coffee" },
  { name: "Điện thoại", icon: "mc:cellphone" },
  { name: "Laptop", icon: "mc:laptop" },
  { name: "Sách", icon: "mc:book" },
  { name: "Âm nhạc", icon: "mc:music" },
  { name: "Phim", icon: "mc:movie" },
  { name: "Camera", icon: "mc:camera" },
  { name: "Đồng hồ", icon: "mc:watch" },
  { name: "Ví", icon: "mc:wallet" },
  { name: "Thú cưng", icon: "mc:paw" },
  { name: "Hoa", icon: "mc:flower" },
  { name: "Cây", icon: "mc:tree" },
  { name: "Bãi biển", icon: "mc:beach" },
  { name: "Núi", icon: "mc:image-filter-hdr" },
  { name: "Khách sạn", icon: "mc:bed" },
  { name: "Nhà hàng", icon: "mc:silverware-fork-knife" },
  { name: "Pizza", icon: "mc:pizza" },
  { name: "Bia", icon: "mc:beer" },
  { name: "Cocktail", icon: "mc:glass-cocktail" },
  { name: "Bánh ngọt", icon: "mc:cake" },
  { name: "Kem", icon: "mc:ice-cream" },
  { name: "Bác sĩ", icon: "mc:doctor" },
  { name: "Bệnh viện", icon: "mc:hospital-building" },
  { name: "Gym", icon: "mc:dumbbell" },
  { name: "Bóng đá", icon: "mc:soccer" },
  { name: "Xe đạp", icon: "mc:bike" },
  { name: "Xe máy", icon: "mc:motorbike" },
  { name: "Xe buýt", icon: "mc:bus" },
  { name: "Tàu hỏa", icon: "mc:train" },
  { name: "Xăng", icon: "mc:gas-station" },
  { name: "Công cụ", icon: "mc:tools" },
  { name: "Sơn", icon: "mc:format-paint" },
  { name: "Điện", icon: "mc:flash" },
  { name: "Nước", icon: "mc:water" },
  { name: "Tiết kiệm", icon: "mc:piggy-bank" },
  { name: "Đầu tư", icon: "mc:chart-line" },
  { name: "Ngân hàng", icon: "mc:bank" },
  { name: "Thẻ tín dụng", icon: "mc:credit-card-outline" },
];

export default function CategoriesSetup() {
  const { user } = useUser();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );
  };

  const [suggestions, setSuggestions] = useState(() => [
    ...expenseSuggestions.map((s) => ({ ...s, type: "expense" })),
    ...incomeSuggestions.map((s) => ({ ...s, type: "income" })),
  ]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"expense" | "income">("expense");
  const [newIcon, setNewIcon] = useState<string>("mc:help-circle-outline");
  const insets = useSafeAreaInsets();

  const openAdd = (type: "expense" | "income") => {
    setNewType(type);
    setNewName("");
    setNewIcon("mc:help-circle-outline");
    setShowAddModal(true);
  };

  const createCategoryInline = async () => {
    if (!newName.trim()) {
      Alert.alert("Lỗi", "Tên danh mục không được để trống");
      return;
    }
    const slug = newName.trim().toLowerCase().replace(/\s+/g, "_");
    const id = `cat_${slug}_${Date.now()}`;
    const newCat = {
      id,
      name: newName.trim(),
      type: newType,
      icon: newIcon || "mc:help-circle-outline",
    };
    const pickColor = () => {
      const palette = [
        "#EF4444",
        "#F59E0B",
        "#10B981",
        "#3B82F6",
        "#8B5CF6",
        "#EC4899",
      ];
      return palette[Math.floor(Math.random() * palette.length)];
    };

    try {
      if (!user || !user.id) {
        router.replace("/auth/login");
        return;
      }
      await openDb();
      // Inline-created categories already get a unique id and are stored per-user
      await db.runAsync(
        `INSERT OR IGNORE INTO categories(id,user_id,name,type,icon,color,created_at,updated_at) VALUES(?,?,?,?,?,?,strftime('%s','now'),strftime('%s','now'))`,
        [
          newCat.id,
          user.id,
          newCat.name,
          newCat.type,
          newCat.icon,
          pickColor(),
        ] as any
      );
      setSuggestions((s) => [newCat, ...s]);
      setSelected((s) => [newCat.id, ...s]);
      setShowAddModal(false);
    } catch (e) {
      console.error(e);
      Alert.alert("Lỗi", "Không thể tạo danh mục mới");
    }
  };

  const finish = async () => {
    if (selected.length < 3) {
      Alert.alert("Lỗi", "Vui lòng chọn ít nhất 3 danh mục");
      return;
    }
    try {
      await openDb();
      await db.execAsync("BEGIN");
      // Insert selected suggestions (includes built-ins and inline-created)
      const allSuggestions = suggestions;
      const pickColor = () => {
        const palette = [
          "#EF4444",
          "#F59E0B",
          "#10B981",
          "#3B82F6",
          "#8B5CF6",
          "#EC4899",
        ];
        return palette[Math.floor(Math.random() * palette.length)];
      };

      if (!user || !user.id) {
        router.replace("/auth/login");
        return;
      }
      const ownerId = user.id;
      for (const c of allSuggestions) {
        if (selected.includes(c.id)) {
          const type = (c as any).type || "expense";
          // If this is a built-in template, create a per-user id to avoid shared categories
          const dbId = TEMPLATE_IDS.has(c.id) ? `${ownerId}_${c.id}` : c.id;
          await db.runAsync(
            `INSERT OR IGNORE INTO categories(id,user_id,name,type,icon,color,created_at,updated_at)
             VALUES(?,?,?,?,?,?,strftime('%s','now'),strftime('%s','now'))`,
            [
              dbId,
              ownerId,
              (c as any).name,
              type,
              (c as any).icon || "",
              pickColor(),
            ] as any
          );
        }
      }
      //log info row insert
      await db.execAsync("COMMIT");
      await AsyncStorage.setItem("onboarding_step", "categories_done");
      router.push("/onboarding/chatbox-intro");
    } catch (e) {
      await db.execAsync("ROLLBACK");
      console.error(e);
      Alert.alert("Lỗi", "Tạo danh mục thất bại");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.inner}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>
          Chọn danh mục hoặc tạo danh mục tùy chỉnh
        </Text>
        <Text style={styles.sectionTitle}>Đề xuất chi phí</Text>

        <View style={styles.chipsRow}>
          {suggestions
            .filter((s) => s.type === "expense")
            .map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.chip,
                  selected.includes(c.id) && styles.chipActive,
                ]}
                onPress={() => toggle(c.id)}
              >
                <MaterialCommunityIcons
                  name={fixIconName((c as any).icon) as any}
                  size={28}
                  color="#256D7B"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.chipLabel}>{c.name}</Text>
              </TouchableOpacity>
            ))}
        </View>

        <TouchableOpacity
          style={styles.addButton}
          onPress={() => openAdd("expense")}
        >
          <Text style={styles.addButtonText}>+ Thêm mới</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { marginTop: 18 }]}>
          Đề xuất thu nhập
        </Text>

        <View style={styles.chipsRow}>
          {suggestions
            .filter((s) => s.type === "income")
            .map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.chip,
                  selected.includes(c.id) && styles.chipActive,
                ]}
                onPress={() => toggle(c.id)}
              >
                <MaterialCommunityIcons
                  name={fixIconName((c as any).icon) as any}
                  size={28}
                  color="#256D7B"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.chipLabel}>{c.name}</Text>
              </TouchableOpacity>
            ))}
        </View>

        <TouchableOpacity
          style={[styles.addButton, { marginTop: 8 }]}
          onPress={() => openAdd("income")}
        >
          <Text style={styles.addButtonText}>+ Thêm mới</Text>
        </TouchableOpacity>

        {/* CTA moved to fixed footer for visibility */}

        <Modal visible={showAddModal} animationType="slide" transparent>
          <View style={modalStyles.modalWrap}>
            <View
              style={[
                modalStyles.modalCard,
                { paddingBottom: Math.max(20, insets.bottom) },
              ]}
            >
              <Text style={modalStyles.modalTitle}>Tạo danh mục mới</Text>
              <TextInput
                placeholder="Tên danh mục"
                value={newName}
                onChangeText={setNewName}
                style={modalStyles.input}
              />

              <Text
                style={{ marginTop: 12, marginBottom: 8, fontWeight: "600" }}
              >
                Chọn biểu tượng
              </Text>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={modalStyles.modalContentScroll}
              >
                <View style={modalStyles.iconGridCompact}>
                  {ICON_OPTIONS.map((opt) => (
                    <View style={modalStyles.iconItem} key={opt.icon}>
                      <TouchableOpacity
                        style={[
                          modalStyles.iconCircle,
                          newIcon === opt.icon && modalStyles.iconCircleActive,
                        ]}
                        onPress={() => setNewIcon(opt.icon)}
                      >
                        <MaterialCommunityIcons
                          name={fixIconName(opt.icon) as any}
                          size={22}
                          color={newIcon === opt.icon ? "#fff" : "#256D7B"}
                        />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </ScrollView>

              <View style={modalStyles.modalFooterWrap}>
                <View style={modalStyles.modalFooter}>
                  <TouchableOpacity
                    style={modalStyles.cancelBtn}
                    onPress={() => setShowAddModal(false)}
                  >
                    <Text style={modalStyles.cancelText}>Hủy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={modalStyles.saveBtn}
                    onPress={createCategoryInline}
                  >
                    <Text style={modalStyles.saveText}>Tạo</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>

      <View style={[styles.footer]}>
        <TouchableOpacity style={styles.cta} onPress={finish}>
          <Text style={styles.ctaText}>Tiếp tục</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: { padding: 24 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 8,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#f0f0f0",
    marginRight: 10,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  chipActive: { backgroundColor: "#fff", borderColor: "#16A34A" },
  chipIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E6F6F6",
    marginRight: 10,
  },
  chipLabel: { fontSize: 16 },
  addButton: {
    backgroundColor: "#111",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 28,
    alignSelf: "flex-start",
    marginTop: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  addButtonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  cta: {
    backgroundColor: "#06b6d4",
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: "center",
    marginTop: 10,
    alignSelf: "stretch",
  },
  ctaText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  footer: { paddingHorizontal: 24, backgroundColor: "#fff" },
});

const modalStyles = StyleSheet.create({
  modalWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  modalCard: {
    backgroundColor: "#fff",
    padding: 20,
    width: "92%",
    maxHeight: "80%",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  modalContentScroll: { paddingBottom: 6 },
  iconScrollWrap: {
    maxHeight: 180,
    marginTop: 6,
    paddingBottom: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#eee",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fafafa",
  },
  typeBtnActive: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  typeLabel: { color: "#111", fontWeight: "600" },
  cancelBtn: { flex: 1, paddingVertical: 8, alignItems: "center" },
  cancelText: { color: "#666" },
  saveBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#06b6d4",
    borderRadius: 8,
  },
  saveText: { color: "#fff", fontWeight: "700" },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  iconOption: {
    width: "30%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#eee",
    padding: 6,
    marginBottom: 8,
  },
  iconOptionName: { fontSize: 11, marginTop: 6, textAlign: "center" },
  iconGridCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  iconItem: {
    width: "20%",
    alignItems: "center",
    paddingVertical: 6,
    marginBottom: 12,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E6F6F6",
  },
  iconCircleActive: { backgroundColor: "#256D7B", borderColor: "#256D7B" },
  modalFooterWrap: {
    marginTop: 8,
  },
  modalFooter: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#f2f2f2",
    paddingTop: 8,
  },
});
