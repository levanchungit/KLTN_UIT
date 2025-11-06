import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

const Row = ({ label, value }: { label: string; value: number }) => (
  <View className="flex-row items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3 mb-2">
    <Text className="text-slate-700">{label}</Text>
    <Text className="text-slate-700">{value.toLocaleString("vi-VN")}đ</Text>
  </View>
);

export default function SuggestScreen() {
  const router = useRouter();
  const { income } = useLocalSearchParams<{ income?: string }>();
  const base = Number(income || 100000000); // ví dụ ảnh 100,000 VND
  const need = Math.round(base * 0.5);
  const want = Math.round(base * 0.3);
  const save = Math.round(base * 0.2);

  return (
    <View className="flex-1 bg-slate-50">
      <View className="px-4 pt-4 pb-2 bg-white border-b border-slate-100">
        <Text className="text-base font-semibold">
          Gợi ý ngân sách hằng tháng
        </Text>
      </View>

      <ScrollView className="px-4 pt-3">
        <View className="rounded-2xl border border-slate-200 bg-white p-3">
          <Text className="text-slate-600 text-[13px] leading-5">
            Gợi ý theo quy tắc 50/30/20 cho thu nhập{" "}
            {base.toLocaleString("vi-VN")}đ/tháng: 50% nhu cầu, 30% mong muốn,
            20% tiết kiệm. Bạn có thể chỉnh để phù hợp thực tế.
          </Text>
        </View>

        {/* Nhu cầu */}
        <View className="mt-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-slate-800">Nhu cầu</Text>
            <Text className="font-semibold text-slate-800">
              {need.toLocaleString("vi-VN")}đ
            </Text>
          </View>
          <Row label="Thức ăn & Đồ uống" value={Math.round(need * 0.4)} />
          <Row label="Nhà" value={Math.round(need * 0.6)} />
        </View>

        {/* Mong muốn */}
        <View className="mt-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-slate-800">Mong muốn</Text>
            <Text className="font-semibold text-slate-800">
              {want.toLocaleString("vi-VN")}đ
            </Text>
          </View>
          <Row label="Mua sắm" value={want} />
        </View>

        {/* Tiết kiệm */}
        <View className="mt-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-slate-800">Tiết kiệm</Text>
            <Text className="font-semibold text-slate-800">
              {save.toLocaleString("vi-VN")}đ
            </Text>
          </View>
          <Row label="Tiết kiệm khẩn cấp" value={save} />
        </View>

        <Pressable
          onPress={() => router.back()}
          className="mt-5 h-12 rounded-full bg-teal-600 items-center justify-center"
        >
          <Text className="text-white font-semibold">Xác nhận</Text>
        </Pressable>

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
