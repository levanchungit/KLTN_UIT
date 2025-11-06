import { View } from "react-native";

import BudgetSetupScreen from "./budget/setup";

export default function Budget() {
  return (
    <View className="flex-1 items-center justify-center">
      <BudgetSetupScreen />
    </View>
  );
}
