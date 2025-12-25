/**
 * Ánh xạ các tên biểu tượng MaterialCommunityIcons không tồn tại/không hợp lệ sang tên hợp lệ
 */
export function fixIconName(iconName: string | null | undefined): string {
  if (!iconName) return "help-circle-outline";

  // Loại bỏ tiền tố nếu có
  const cleanName = iconName.replace(/^(mc:|mi:|mci:)/, "");

  // Bảng ánh xạ các biểu tượng không hợp lệ sang lựa chọn hợp lệ
  const iconMap: Record<string, string> = {
    // Biểu tượng không hợp lệ từ cảnh báo
    "piggy-bank-outline": "piggy-bank",
    noodles: "food",
    "flight-takeoff": "airplane-takeoff",
    "directions-car": "car",
    "credit-card": "credit-card-outline",
    assignment: "file-document-outline",

    // Một số lỗi thường gặp khác
    "food-variant": "food",
    home: "home-outline",
    shopping: "cart-outline",
    shop: "store-outline",
    transport: "bus",
    "transport-car": "car",
    flight: "airplane",
    card: "credit-card-outline",
    money: "cash",
    savings: "piggy-bank",
  };

  // Kiểm tra xem biểu tượng có cần ánh xạ không
  const mappedName = iconMap[cleanName] || cleanName;

  return mappedName;
}

/**
 * Đảm bảo tên biểu tượng có tiền tố mc: cho MaterialCommunityIcons
 */
export function ensureIconPrefix(iconName: string | null | undefined): string {
  const fixed = fixIconName(iconName);
  return fixed.startsWith("mc:") ? fixed : `mc:${fixed}`;
}
