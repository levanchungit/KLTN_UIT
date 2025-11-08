// iconMapper.ts - Map invalid icon names to valid MaterialCommunityIcons names

/**
 * Maps invalid or non-existent MaterialCommunityIcons names to valid ones
 */
export function fixIconName(iconName: string | null | undefined): string {
  if (!iconName) return "help-circle-outline";

  // Remove prefix if exists
  const cleanName = iconName.replace(/^(mc:|mi:|mci:)/, "");

  // Map of invalid/non-existent icons to valid alternatives
  const iconMap: Record<string, string> = {
    // Invalid icons from warnings
    "piggy-bank-outline": "piggy-bank",
    noodles: "food",
    "flight-takeoff": "airplane-takeoff",
    "directions-car": "car",
    "credit-card": "credit-card-outline",

    // Additional common mistakes
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

  // Check if icon needs mapping
  const mappedName = iconMap[cleanName] || cleanName;

  return mappedName;
}

/**
 * Ensures icon name has mc: prefix for MaterialCommunityIcons
 */
export function ensureIconPrefix(iconName: string | null | undefined): string {
  const fixed = fixIconName(iconName);
  return fixed.startsWith("mc:") ? fixed : `mc:${fixed}`;
}
