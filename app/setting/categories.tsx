import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
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

// Dynamic import for color picker to avoid bundling issues
let ColorPicker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const colorPickerModule = require("react-native-wheel-color-picker");
  ColorPicker = colorPickerModule.default || colorPickerModule;
} catch (e) {
  console.warn("Color picker not available:", e);
}

type Tab = "expense" | "income";

export default function CategoriesScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const [activeTab, setActiveTab] = useState<Tab>("expense");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [showAllIcons, setShowAllIcons] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formName, setFormName] = useState("");
  const [formIcon, setFormIcon] = useState("");
  const [formColor, setFormColor] = useState("");
  const [customColorVisible, setCustomColorVisible] = useState(false);
  const [wheelColor, setWheelColor] = useState("#3B82F6");
  const [customColors, setCustomColors] = useState<string[]>([]);

  const ICON_OPTIONS = [
    { name: "Thức ăn", icon: "mc:food" },
    { name: "Du lịch", icon: "mc:airplane" },
    { name: "Mua sắm", icon: "mc:shopping" },
    { name: "Nhà", icon: "mc:home" },
    { name: "Xe", icon: "mc:car" },
    { name: "Giải trí", icon: "mc:gamepad-variant" },
    { name: "Sức khỏe", icon: "mc:heart" },
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
    { name: "Thuốc", icon: "mc:pill" },
    { name: "Bệnh viện", icon: "mc:hospital-building" },
    { name: "Gym", icon: "mc:dumbbell" },
    { name: "Bóng đá", icon: "mc:soccer" },
    { name: "Bóng rổ", icon: "mc:basketball" },
    { name: "Bơi lội", icon: "mc:swim" },
    { name: "Xe đạp", icon: "mc:bike" },
    { name: "Xe máy", icon: "mc:motorbike" },
    { name: "Xe buýt", icon: "mc:bus" },
    { name: "Tàu hỏa", icon: "mc:train" },
    { name: "Tàu thủy", icon: "mc:ferry" },
    { name: "Xăng", icon: "mc:gas-station" },
    { name: "Công cụ", icon: "mc:tools" },
    { name: "Búa", icon: "mc:hammer" },
    { name: "Sơn", icon: "mc:format-paint" },
    { name: "Điện", icon: "mc:flash" },
    { name: "Nước", icon: "mc:water" },
    { name: "Lửa", icon: "mc:fire" },
    { name: "Thời tiết", icon: "mc:weather-cloudy" },
    { name: "Mặt trời", icon: "mc:white-balance-sunny" },
    { name: "Mưa", icon: "mc:weather-rainy" },
    { name: "Tuyết", icon: "mc:weather-snowy" },
    { name: "Bảo hiểm", icon: "mc:shield-check" },
    { name: "Tiết kiệm", icon: "mc:piggy-bank" },
    { name: "Đầu tư", icon: "mc:chart-line" },
    { name: "Ngân hàng", icon: "mc:bank" },
    { name: "Thẻ tín dụng", icon: "mc:credit-card-outline" },
  ];
  const MAX_VISIBLE_ICONS = 11;
  const displayedIcons = showAllIcons
    ? ICON_OPTIONS
    : ICON_OPTIONS.slice(0, MAX_VISIBLE_ICONS);

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
    setFormColor("");
    setCustomColors([]);
    setShowAllIcons(false);
    setModalVisible(true);
  };

  const handleEdit = (cat: Category) => {
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormIcon(cat.icon || "");
    setFormColor(cat.color || "");
    setCustomColors([]);
    setShowAllIcons(false);
    setModalVisible(true);
  };

  const openCustomPicker = () => {
    setWheelColor(formColor || "#3B82F6");
    setCustomColorVisible(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      Alert.alert(t("error"), t("enterCategoryName"));
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
      setShowAllIcons(false);
      loadCategories();
    } catch (error) {
      Alert.alert(t("error"), t("cannotSaveCategory"));
      console.error(error);
    }
  };

  const handleDelete = (cat: Category) => {
    Alert.alert(t("confirm"), t("confirmDeleteCategory", { name: cat.name }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteCategory"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteCategory(cat.id);
            loadCategories();
          } catch (deleteError) {
            Alert.alert(t("error"), t("cannotDeleteCategory"));
            console.error(error);
          }
        },
      },
    ]);
  };

  const getIconComponent = (
    iconStr: string | null,
    iconColor: string | null,
    size: number = 24
  ) => {
    const finalColor = iconColor || colors.icon;

    if (!iconStr)
      return (
        <Ionicons name="help-circle-outline" size={size} color={finalColor} />
      );

    const iconMap: Record<string, string> = {
      "directions-car": "car",
      "flight-takeoff": "airplane-takeoff",
      pets: "paw",
      "credit-card": "credit-card-outline",
      assignment: "file-document-outline",
      "piggy-bank-outline": "piggy-bank",
      noodles: "food",
    };

    const [prefix, name] = iconStr.split(":");
    if (prefix === "mc") {
      const mappedName = iconMap[name] || name;
      return (
        <MaterialCommunityIcons
          name={mappedName as any}
          size={size}
          color={finalColor}
        />
      );
    }
    if (prefix === "mi") {
      const mappedName = iconMap[name] || name;
      return (
        <MaterialCommunityIcons
          name={mappedName as any}
          size={size}
          color={finalColor}
        />
      );
    }
    const mappedName = iconMap[iconStr] || name || iconStr;

    if (iconMap[iconStr]) {
      return (
        <MaterialCommunityIcons
          name={mappedName as any}
          size={size}
          color={finalColor}
        />
      );
    }

    return (
      <Ionicons
        name={(name || iconStr) as any}
        size={size}
        color={finalColor}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("manageCategories")}</Text>
        <View style={{ width: 24 }} />
      </View>

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
            {t("expense")}
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
            {t("income")}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {loading && (
          <Text style={[styles.emptyText, { color: colors.subText }]}>
            {t("loading")}
          </Text>
        )}
        {!loading && categories.length === 0 && (
          <Text style={[styles.emptyText, { color: colors.subText }]}>
            {t("noCategories")}
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
              {getIconComponent(cat.icon || null, "#FFFFFF")}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.itemName}>{cat.name}</Text>
              <Text style={styles.itemType}>
                {cat.type === "expense" ? t("expense") : t("income")}
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

      <View
        style={[styles.addButtonContainer, { paddingBottom: insets.bottom }]}
      >
        <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
          <Ionicons name="add" size={24} color="#fff" />
          <Text style={styles.addButtonText}>{t("addCategory")}</Text>
        </TouchableOpacity>
      </View>

      <Portal>
        <Modal
          style={{ margin: 0, justifyContent: "flex-end" }}
          visible={modalVisible}
          onDismiss={() => {
            setModalVisible(false);
            setShowAllIcons(false);
          }}
          contentContainerStyle={styles.modal}
        >
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                paddingBottom: 0,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingCategory ? t("editCategoryTitle") : t("addCategory")}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.label, { color: colors.text }]}>
                {t("categoryName")}
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
                placeholder={t("categoryName")}
                placeholderTextColor={colors.subText}
                value={formName}
                onChangeText={setFormName}
              />

              <Text style={[styles.label, { color: colors.text }]}>
                {t("categoryIcon")}
              </Text>
              <View
                style={[
                  styles.iconGrid,
                  showAllIcons && { marginBottom: -200 },
                ]}
              >
                {displayedIcons.map((option) => (
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
                    {getIconComponent(
                      option.icon,
                      formIcon === option.icon ? "#FFFFFF" : colors.icon,
                      24
                    )}
                  </TouchableOpacity>
                ))}
                {!showAllIcons && (
                  <TouchableOpacity
                    style={[
                      styles.iconOption,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.divider,
                      },
                    ]}
                    onPress={() => setShowAllIcons(true)}
                  >
                    <MaterialCommunityIcons
                      name="dots-horizontal"
                      size={24}
                      color={colors.icon}
                    />
                    <Text
                      style={[styles.iconOptionName, { color: colors.subText }]}
                    >
                      {t("showMore")}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text
                style={[styles.label, { color: colors.text, marginTop: 6 }]}
              >
                {t("categoryColor")}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingVertical: 4,
                  gap: 8,
                  paddingRight: 4,
                }}
              >
                {/* 12 màu cơ bản */}
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
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: color,
                      borderWidth: formColor === color ? 3 : 1,
                      borderColor:
                        formColor === color ? colors.text : colors.divider,
                    }}
                  />
                ))}

                {/* Màu tùy chỉnh từ người dùng */}
                {customColors.map((color) => (
                  <TouchableOpacity
                    key={color}
                    onPress={() => setFormColor(color)}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: color,
                      borderWidth: formColor === color ? 3 : 1,
                      borderColor:
                        formColor === color ? colors.text : colors.divider,
                    }}
                  />
                ))}

                {/* Nút thêm màu */}
                <TouchableOpacity
                  onPress={openCustomPicker}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.divider,
                  }}
                  accessibilityLabel="Thêm màu"
                >
                  <MaterialCommunityIcons
                    name="plus"
                    size={18}
                    color={colors.icon}
                  />
                </TouchableOpacity>
              </ScrollView>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btnCancel, { borderColor: colors.divider }]}
                onPress={() => {
                  setModalVisible(false);
                  setShowAllIcons(false);
                }}
              >
                <Text style={{ color: colors.text }}>{t("cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnSave, !formColor && { opacity: 0.5 }]}
                disabled={!formColor}
                onPress={handleSave}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>
                  {t("save")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal
          visible={customColorVisible}
          onDismiss={() => setCustomColorVisible(false)}
          contentContainerStyle={[
            styles.colorPickerModal,
            { backgroundColor: colors.card },
          ]}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <View style={styles.colorPickerContent}>
              {/* Header */}
              <View style={styles.colorPickerHeader}>
                <Text
                  style={[
                    styles.modalTitle,
                    { color: colors.text, marginBottom: 0, flex: 1 },
                  ]}
                >
                  {t("customColor")}
                </Text>
                <TouchableOpacity
                  onPress={() => setCustomColorVisible(false)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={24} color={colors.icon} />
                </TouchableOpacity>
              </View>

              {/* Color Wheel Picker */}
              <View style={styles.colorWheelContainer}>
                {ColorPicker ? (
                  <ColorPicker
                    color={wheelColor}
                    onColorChangeComplete={(c: string) => setWheelColor(c)}
                    thumbSize={30}
                    sliderSize={30}
                    noSnap
                    row={false}
                    style={{ width: "100%", height: 280 }}
                  />
                ) : (
                  <View style={styles.colorPickerError}>
                    <Ionicons
                      name="color-palette-outline"
                      size={48}
                      color={colors.subText}
                    />
                    <Text
                      style={{
                        color: colors.subText,
                        marginTop: 12,
                        fontSize: 14,
                      }}
                    >
                      {t("colorPickerUnavailable")}
                    </Text>
                  </View>
                )}
              </View>

              {/* Màu đã chọn preview */}
              <View style={styles.colorPreviewContainer}>
                <View style={styles.colorPreviewBox}>
                  <View
                    style={[
                      styles.colorPreviewCircle,
                      {
                        backgroundColor: wheelColor,
                        borderColor: colors.divider,
                      },
                    ]}
                  >
                    <View style={styles.colorPreviewInner}>
                      <Ionicons name="checkmark" size={24} color="#FFFFFF" />
                    </View>
                  </View>
                  <View style={styles.colorPreviewInfo}>
                    <Text
                      style={[
                        styles.colorPreviewLabel,
                        { color: colors.subText },
                      ]}
                    >
                      {t("selectedColor")}
                    </Text>
                    <Text
                      style={[styles.colorPreviewHex, { color: colors.text }]}
                    >
                      {wheelColor.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Actions */}
              <View style={styles.colorPickerActions}>
                <TouchableOpacity
                  style={[
                    styles.btnCancel,
                    { borderColor: colors.divider, flex: 1 },
                  ]}
                  onPress={() => setCustomColorVisible(false)}
                >
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 15,
                      fontWeight: "600",
                    }}
                  >
                    {t("cancel")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnSave, { flex: 2, flexDirection: "row" }]}
                  onPress={() => {
                    if (wheelColor) {
                      setFormColor(wheelColor);
                      if (!customColors.includes(wheelColor)) {
                        setCustomColors([...customColors, wheelColor]);
                      }
                    }
                    setCustomColorVisible(false);
                  }}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                  <Text
                    style={{
                      color: "#fff",
                      fontWeight: "600",
                      fontSize: 15,
                      marginLeft: 6,
                    }}
                  >
                    {t("applyColor")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
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
    colorPickerModal: {
      margin: 20,
      borderRadius: 20,
      alignSelf: "center",
      width: "90%",
      maxWidth: 380,
      maxHeight: "85%",
    },
    colorPickerContent: {
      padding: 20,
    },
    colorPickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.background,
      marginLeft: 12,
    },
    colorWheelContainer: {
      alignItems: "center",
      marginBottom: 20,
    },
    colorPickerError: {
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    },
    colorPreviewContainer: {
      marginBottom: 20,
    },
    colorPreviewBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.background,
      padding: 14,
      borderRadius: 12,
    },
    colorPreviewCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      borderWidth: 3,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 14,
    },
    colorPreviewInner: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.15)",
    },
    colorPreviewInfo: {
      flex: 1,
    },
    colorPreviewLabel: {
      fontSize: 12,
      fontWeight: "500",
      marginBottom: 4,
    },
    colorPreviewHex: {
      fontSize: 17,
      fontWeight: "700",
      letterSpacing: 0.5,
    },
    colorPickerActions: {
      flexDirection: "row",
      gap: 10,
    },
    modalContent: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 16,
      maxHeight: "80%",
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      marginBottom: 12,
      textAlign: "center",
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      marginTop: 10,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 14,
    },
    iconGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 6,
      marginBottom: -24,
    },
    iconOption: {
      width: "22%",
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      borderWidth: 1,
    },
    iconOptionName: {
      fontSize: 9,
      marginTop: 3,
      textAlign: "center",
    },
    modalActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 16,
      paddingBottom: 12,
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
      justifyContent: "center",
      backgroundColor: "#3B82F6",
    },
  });
