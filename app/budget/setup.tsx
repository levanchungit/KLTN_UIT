import { Link } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

export default function BudgetSetupScreen() {
  const [income, setIncome] = useState("");
  const [desc, setDesc] = useState("");
  const [repeat, setRepeat] = useState("Hằng tháng");

  return (
    <View className="flex-1 bg-white">
      <ScrollView className="px-4 pt-4">
        <Text className="text-slate-800 font-semibold text-base mb-2">
          🧾 Tiền mặt
        </Text>
        <Text className="text-slate-600 text-[13px] leading-5 mb-4">
          Chúng tôi sẽ giúp bạn xây dựng kế hoạch thông minh theo quy tắc
          50/30/20 – 50% nhu cầu, 30% mong muốn, 20% tiết kiệm. Hãy cho biết thu
          nhập và lối sống của bạn.
        </Text>

        <Text className="text-slate-600 mb-2">Thu nhập (sau thuế)</Text>
        <View className="rounded-xl border border-slate-200 bg-white px-4">
          <TextInput
            keyboardType="numeric"
            placeholder="vd: 10,000,000"
            value={income}
            onChangeText={setIncome}
            className="h-12"
          />
        </View>
        <Text className="text-slate-400 text-[12px] mt-1">Hằng tháng</Text>

        <Text className="text-slate-600 mt-4 mb-2">Mô tả lối sống của bạn</Text>
        <View className="rounded-xl border border-slate-200 bg-white px-4">
          <TextInput
            multiline
            numberOfLines={4}
            placeholder="Ví dụ: thuê nhà 10 triệu, ăn ngoài 2 lần/tuần…"
            value={desc}
            onChangeText={setDesc}
            className="py-3"
          />
        </View>
        <Text className="text-slate-400 text-[12px] mt-1">
          {desc.length}/500
        </Text>

        <Text className="text-slate-600 mt-4 mb-2">
          Ngân sách lặp lại bao lâu?
        </Text>
        <Pressable className="rounded-xl border border-slate-200 bg-white px-4 h-12 justify-center">
          <Text className="text-slate-700">{repeat}</Text>
        </Pressable>

        <Link
          href={{
            pathname: "/budget/suggest",
            params: { income: income || "100000000" },
          }}
          asChild
        >
          <Pressable className="mt-6 h-12 rounded-full bg-teal-600 items-center justify-center">
            <Text className="text-white font-semibold">
              Tạo ngân sách của tôi
            </Text>
          </Pressable>
        </Link>

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
