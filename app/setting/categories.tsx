import { useTheme } from "@/app/providers/ThemeProvider";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  type Category,
} from "@/repos/categoryRepo";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Modal, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Tab = "expense" | "income";

export default function CategoriesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const [activeTab, setActiveTab] = useState<Tab>("expense");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [iconPickerVisible, setIconPickerVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formName, setFormName] = useState("");
  const [formIcon, setFormIcon] = useState("");
  const [formColor, setFormColor] = useState("#3B82F6");

  // Icon options
  const ICON_OPTIONS = [
    { name: "Thức ăn", icon: "mc:food", emoji: "🍔" },
    { name: "Du lịch", icon: "mc:airplane", emoji: "✈️" },
    { name: "Mua sắm", icon: "mc:shopping", emoji: "🛍️" },
    { name: "Nhà", icon: "mc:home", emoji: "🏠" },
    { name: "Xe", icon: "mc:car", emoji: "🚗" },
    { name: "Giải trí", icon: "mc:gamepad-variant", emoji: "🎮" },
    { name: "Sức khỏe", icon: "mc:heart", emoji: "❤️" },
    { name: "Giáo dục", icon: "mc:school", emoji: "🎓" },
    { name: "Thể thao", icon: "mc:run", emoji: "🏃" },
    { name: "Quà tặng", icon: "mc:gift", emoji: "🎁" },
    { name: "Tiền lương", icon: "mc:cash", emoji: "💰" },
    { name: "Cafe", icon: "mc:coffee", emoji: "☕" },
  ];

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const cats = await listCategories({ type: activeTab, parent_id: null });
      setCategories(cats);
    } catch (error) {
      console.error("Error loading categories:", error);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
    }, [loadCategories])
  );

  const handleAdd = () => {
    setEditingCategory(null);
    setFormName("");
    setFormIcon("");
    setFormColor("#3B82F6");
    setModalVisible(true);
  };

  const handleEdit = (cat: Category) => {
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormIcon(cat.icon || "");
    setFormColor(cat.color || "#3B82F6");
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập tên danh mục");
      return;
    }

    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: formName,
          icon: formIcon || null,
          color: formColor,
        });
      } else {
        await createCategory({
          name: formName,
          type: activeTab,
          icon: formIcon || null,
          color: formColor,
        });
      }
      setModalVisible(false);
      loadCategories();
    } catch (error) {
      Alert.alert("Lỗi", "Không thể lưu danh mục");
      console.error(error);
    }
  };

  const handleDelete = (cat: Category) => {
    Alert.alert("Xác nhận", `Xóa danh mục "${cat.name}"?`, [
      { text: "Hủy", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteCategory(cat.id);
            loadCategories();
          } catch (error) {
            Alert.alert("Lỗi", "Không thể xóa danh mục");
            console.error(error);
          }
        },
      },
    ]);
  };

  const getIconComponent = (iconStr: string | null) => {
    if (!iconStr)
      return (
        <Ionicons name="help-circle-outline" size={24} color={colors.icon} />
      );

    const [prefix, name] = iconStr.split(":");
    if (prefix === "mc") {
      return (
        <MaterialCommunityIcons
          name={name as any}
          size={24}
          color={colors.icon}
        />
      );
    }
    return <Ionicons name={name as any} size={24} color={colors.icon} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quản lý danh mục</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "expense" && styles.tabActive]}
          onPress={() => setActiveTab("expense")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "expense" && styles.tabTextActive,
            ]}
          >
            Chi phí
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "income" && styles.tabActive]}
          onPress={() => setActiveTab("income")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "income" && styles.tabTextActive,
            ]}
          >
            Thu nhập
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {loading && (
          <Text style={[styles.emptyText, { color: colors.subText }]}>
            Đang tải...
          </Text>
        )}
        {!loading && categories.length === 0 && (
          <Text style={[styles.emptyText, { color: colors.subText }]}>
            Chưa có danh mục nào
          </Text>
        )}
        {categories.map((cat) => (
          <View key={cat.id} style={styles.item}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: cat.color || colors.divider },
              ]}
            >
              {getIconComponent(cat.icon || null)}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.itemName}>{cat.name}</Text>
              <Text style={styles.itemType}>
                {cat.type === "expense" ? "Chi phí" : "Thu nhập"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleEdit(cat)}
              style={styles.actionBtn}
            >
              <Ionicons name="create-outline" size={20} color={colors.icon} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(cat)}
              style={styles.actionBtn}
            >
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* Add Button */}
      <View
        style={[
          styles.addButtonContainer,
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
          <Ionicons name="add" size={24} color="#fff" />
          <Text style={styles.addButtonText}>Thêm danh mục</Text>
        </TouchableOpacity>
      </View>

      {/* Modal Bottom Sheet */}
      <Portal>
        <Modal
          visible={modalVisible}
          onDismiss={() => setModalVisible(false)}
          contentContainerStyle={styles.modal}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingCategory ? "Sửa danh mục" : "Thêm danh mục"}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.label, { color: colors.text }]}>
                Tên danh mục
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: colors.divider,
                  },
                ]}
                placeholder="Nhập tên danh mục"
                placeholderTextColor={colors.subText}
                value={formName}
                onChangeText={setFormName}
              />

              <Text style={[styles.label, { color: colors.text }]}>
                Chọn biểu tượng
              </Text>
              <View style={styles.iconGrid}>
                {ICON_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.icon}
                    style={[
                      styles.iconOption,
                      {
                        backgroundColor:
                          formIcon === option.icon
                            ? "#3B82F6"
                            : colors.background,
                        borderColor:
                          formIcon === option.icon ? "#3B82F6" : colors.divider,
                      },
                    ]}
                    onPress={() => setFormIcon(option.icon)}
                  >
                    <Text style={styles.iconEmoji}>{option.emoji}</Text>
                    <Text
                      style={[
                        styles.iconOptionName,
                        {
                          color:
                            formIcon === option.icon ? "#fff" : colors.subText,
                        },
                      ]}
                    >
                      {option.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text
                style={[styles.label, { color: colors.text, marginTop: 16 }]}
              >
                Màu sắc
              </Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {[
                  "#EF4444",
                  "#F59E0B",
                  "#10B981",
                  "#3B82F6",
                  "#8B5CF6",
                  "#EC4899",
                ].map((color) => (
                  <TouchableOpacity
                    key={color}
                    onPress={() => setFormColor(color)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: color,
                      borderWidth: formColor === color ? 3 : 0,
                      borderColor: colors.text,
                    }}
                  />
                ))}
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btnCancel, { borderColor: colors.divider }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: colors.text }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSave} onPress={handleSave}>
                <Text style={{ color: "#fff", fontWeight: "600" }}>Lưu</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const makeStyles = (c: {
  background: string;
  card: string;
  text: string;
  subText: string;
  divider: string;
  icon: string;
}) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.text },
    tabs: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
    },
    tab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: "center",
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.divider,
    },
    tabActive: {
      backgroundColor: "#3B82F6",
      borderColor: "#3B82F6",
    },
    tabText: { fontSize: 15, color: c.text },
    tabTextActive: { color: "#fff", fontWeight: "600" },
    list: { flex: 1, paddingHorizontal: 16 },
    emptyText: {
      textAlign: "center",
      marginTop: 40,
      fontSize: 16,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.card,
      padding: 12,
      borderRadius: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: c.divider,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    itemName: { fontSize: 16, fontWeight: "600", color: c.text },
    itemType: { fontSize: 13, color: c.subText, marginTop: 2 },
    actionBtn: { padding: 8 },
    addButtonContainer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.divider,
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#3B82F6",
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    addButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    modal: {
      margin: 0,
      justifyContent: "flex-end",
    },
    modalContent: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      maxHeight: "80%",
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "700",
      marginBottom: 16,
      textAlign: "center",
    },
    label: {
      fontSize: 14,
      fontWeight: "600",
      marginTop: 12,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    iconPickerButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    iconGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      marginTop: 8,
    },
    iconOption: {
      width: "22%",
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      borderWidth: 1,
    },
    iconOptionSelected: {
      backgroundColor: "#3B82F6",
      borderColor: "#3B82F6",
    },
    iconEmoji: {
      fontSize: 32,
    },
    iconOptionName: {
      fontSize: 10,
      marginTop: 4,
      textAlign: "center",
    },
    modalActions: {
      flexDirection: "row",
      gap: 12,
      marginTop: 20,
    },
    btnCancel: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
      borderWidth: 1,
    },
    btnSave: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
      backgroundColor: "#3B82F6",
    },
  });
