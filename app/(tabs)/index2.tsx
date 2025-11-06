import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { PieChart } from "react-native-gifted-charts";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Dashboard() {
  const chartData = [
    { value: 36, color: "#3B82F6" },
    { value: 32, color: "#10B981" },
    { value: 22, color: "#F59E0B" },
    { value: 10, color: "#A78BFA" },
  ];

  return (
    <SafeAreaView className="flex-1 bg-[#fefefe]">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* ==== HEADER CHIPS ==== */}
        <View className="flex-row justify-between items-center px-5 mt-2">
          <View className="flex-row space-x-2">
            <View className="bg-[#FEF3C7] px-3 py-1.5 rounded-full flex-row items-center space-x-1">
              <Ionicons name="trophy-outline" size={14} color="#F59E0B" />
              <Text className="text-[12px] text-[#92400E] font-medium">
                Những cột mốc
              </Text>
            </View>
            <View className="bg-[#DBEAFE] px-3 py-1.5 rounded-full flex-row items-center space-x-1">
              <Ionicons name="stats-chart-outline" size={14} color="#2563EB" />
              <Text className="text-[12px] text-[#1E40AF] font-medium">
                Phân tích thêm
              </Text>
            </View>
          </View>

          <TouchableOpacity className="p-2">
            <Ionicons name="settings-outline" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* ==== WELCOME ==== */}
        <View className="items-center mt-5">
          <View className="flex-row items-center bg-[#F3E8FF] px-4 py-2 rounded-2xl">
            <Ionicons name="hand-left-outline" size={18} color="#8B5CF6" />
            <Text className="ml-2 text-[#6B21A8] font-medium text-sm">
              Xin chào!
            </Text>
          </View>
          <Image
            source={{
              uri: "https://cdn-icons-png.flaticon.com/512/4712/4712109.png",
            }}
            className="w-14 h-14 mt-3"
          />
        </View>

        {/* ==== BALANCE ==== */}
        <View className="px-5 mt-5 flex-row justify-between">
          <LinearGradient
            colors={["#60A5FA", "#A78BFA"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="flex-1 mr-3 rounded-2xl p-4 shadow-md"
          >
            <Text className="text-white text-[13px] font-medium">Tiền mặt</Text>
            <Text className="text-white text-[22px] font-semibold mt-1">
              1.743.123đ
            </Text>
            <TouchableOpacity className="absolute top-3 right-3">
              <Ionicons
                name="checkmark-circle-outline"
                size={20}
                color="#fff"
              />
            </TouchableOpacity>
          </LinearGradient>

          <View className="w-[90px] bg-[#F3F4F6] rounded-2xl justify-center items-center shadow-sm">
            <Ionicons name="add" size={26} color="#6B7280" />
            <Text className="text-gray-500 text-xs mt-1 font-medium">
              Ví mới
            </Text>
          </View>
        </View>

        {/* ==== FILTER BAR ==== */}
        <View className="px-5 mt-6 flex-row items-center justify-between">
          <View className="flex-row bg-[#F3F4F6] rounded-xl px-3 py-1.5 items-center">
            <Ionicons name="calendar-outline" size={16} color="#4B5563" />
            <Text className="ml-2 text-gray-600 text-sm font-medium">Tuần</Text>
            <Ionicons name="chevron-down-outline" size={16} color="#4B5563" />
          </View>
          <Text className="text-gray-500 text-[13px] font-medium">
            Th 2, 3 thg 11 - CN, 9 thg 11
          </Text>
        </View>

        {/* ==== SUMMARY ==== */}
        <View className="px-5 mt-6">
          <LinearGradient
            colors={["#E0F2FE", "#F3E8FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="rounded-2xl p-4 shadow-sm"
          >
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-gray-700 font-semibold text-base">
                Thay đổi ròng
              </Text>
              <Ionicons name="ellipsis-horizontal" size={18} color="#6B7280" />
            </View>
            <Text className="text-lg font-bold text-gray-800">+5.743.123đ</Text>

            <View className="flex-row justify-between mt-4">
              <View className="flex-1 bg-white/90 mr-2 rounded-xl p-3 items-center">
                <Ionicons name="arrow-down-outline" size={18} color="#EF4444" />
                <Text className="text-red-500 font-semibold text-[13px] mt-1">
                  Chi phí
                </Text>
                <Text className="text-gray-800 font-bold text-[12px]">
                  -14.256.877đ
                </Text>
              </View>
              <View className="flex-1 bg-white/90 ml-2 rounded-xl p-3 items-center">
                <Ionicons name="arrow-up-outline" size={18} color="#10B981" />
                <Text className="text-green-600 font-semibold text-[13px] mt-1">
                  Thu nhập
                </Text>
                <Text className="text-gray-800 font-bold text-[12px]">
                  +20.000.000đ
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* ==== CHART ==== */}
        <View className="px-5 mt-6 items-center">
          <PieChart
            data={chartData}
            donut
            radius={90}
            innerRadius={60}
            innerCircleColor="#fff"
            centerLabelComponent={() => (
              <Text className="text-gray-700 text-lg font-semibold">36%</Text>
            )}
          />
        </View>

        {/* ==== CATEGORY LIST ==== */}
        <View className="px-5 mt-4 space-y-3">
          {[
            {
              icon: "fast-food-outline",
              name: "Thức ăn & Đồ uống",
              color: "#3B82F6",
              amount: "5.110.000đ",
              percent: 36,
            },
            {
              icon: "airplane-outline",
              name: "Du lịch",
              color: "#10B981",
              amount: "5.000.000đ",
              percent: 35,
            },
            {
              icon: "cart-outline",
              name: "Mua sắm",
              color: "#F59E0B",
              amount: "3.740.000đ",
              percent: 28,
            },
            {
              icon: "medkit-outline",
              name: "Chưa phân loại",
              color: "#A78BFA",
              amount: "406.877đ",
              percent: 8,
            },
          ].map((item, i) => (
            <View
              key={i}
              className="flex-row justify-between items-center bg-white rounded-xl px-4 py-2 shadow-sm"
            >
              <View className="flex-row items-center space-x-3">
                <View
                  className="w-10 h-10 rounded-full justify-center items-center"
                  style={{ backgroundColor: `${item.color}1A` }}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={item.color}
                  />
                </View>
                <View>
                  <Text className="text-gray-700 font-medium text-sm">
                    {item.name}
                  </Text>
                  <Text className="text-gray-400 text-xs">{item.percent}%</Text>
                </View>
              </View>
              <Text className="text-gray-800 font-semibold text-sm">
                {item.amount}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity
        className="absolute bottom-8 right-8 bg-blue-500 w-14 h-14 rounded-full justify-center items-center shadow-lg"
        activeOpacity={0.9}
      >
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}
