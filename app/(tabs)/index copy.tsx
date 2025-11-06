import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { styled } from "nativewind";

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

const HeaderSection = () => (
  <StyledView className="p-4 bg-white">
    <StyledText className="text-xl font-bold">Xin chào! 👋</StyledText>
    <StyledView className="flex-row justify-between mt-2">
      <StyledTouchableOpacity className="bg-yellow-100 px-4 py-2 rounded-lg mr-2">
        <StyledText className="text-yellow-700">🏆 Những cột mốc</StyledText>
      </StyledTouchableOpacity>
      <StyledTouchableOpacity className="bg-blue-100 px-4 py-2 rounded-lg">
        <StyledText className="text-blue-700">📊 Phân tích thêm</StyledText>
      </StyledTouchableOpacity>
    </StyledView>
  </StyledView>
);

const AssetOverviewSection = () => (
  <StyledView className="flex-row items-center justify-around p-4">
    <StyledView className="bg-cyan-100 px-6 py-4 rounded-lg">
      <StyledText className="font-semibold">Tiền mặt: 1.743.123₫</StyledText>
    </StyledView>
    <StyledTouchableOpacity className="bg-gray-100 px-6 py-4 rounded-lg">
      <StyledText className="text-gray-700">+ Ví mới</StyledText>
    </StyledTouchableOpacity>
    <StyledView className="ml-2">
      <StyledText className="text-gray-500">Tuần ▼</StyledText>
    </StyledView>
  </StyledView>
);

const NetChangeCard = () => (
  <StyledView className="bg-blue-50 m-4 p-4 rounded-lg">
    <StyledText className="font-bold text-base">Thay đổi ròng: 5.743.123₫</StyledText>
    <StyledView className="flex-row justify-between mt-2">
      <StyledText className="text-red-500">Chi phí: 14.256.877₫ ▼</StyledText>
      <StyledText className="text-green-600">Thu nhập: 20.000.000₫ ▲</StyledText>
    </StyledView>
  </StyledView>
);

const ExpenseDonutChart = () => (
  <StyledView className="items-center m-4 p-4 bg-gray-50 rounded-lg">
    <StyledText>Biểu đồ donut (placeholder)</StyledText>
  </StyledView>
);

const ExpenseGroupList = () => (
  <StyledView className="mx-4 mb-20">
    <StyledView className="mb-2 flex-row items-center">
      <StyledText className="mr-2">🍔</StyledText>
      <StyledText className="font-semibold">Thức ăn & Đồ uống:</StyledText>
      <StyledText className="ml-auto">5.110.000₫ (36%)</StyledText>
    </StyledView>
    <StyledView className="mb-2 flex-row items-center">
      <StyledText className="mr-2">🛫</StyledText>
      <StyledText className="font-semibold">Du lịch:</StyledText>
      <StyledText className="ml-auto">5.000.000₫ (35%)</StyledText>
    </StyledView>
    <StyledView className="mb-2 flex-row items-center">
      <StyledText className="mr-2">👕</StyledText>
      <StyledText className="font-semibold">Mua sắm:</StyledText>
      <StyledText className="ml-auto">3.740.000₫ (26%)</StyledText>
    </StyledView>
    <StyledView className="mb-2 flex-row items-center">
      <StyledText className="mr-2">❓</StyledText>
      <StyledText className="font-semibold">Chưa phân loại:</StyledText>
      <StyledText className="ml-auto">406.877₫ (3%)</StyledText>
    </StyledView>
  </StyledView>
);

const FloatingAddButton = () => (
  <StyledTouchableOpacity className="absolute right-6 bottom-20 bg-cyan-500 w-14 h-14 rounded-full items-center justify-center shadow-lg">
    <StyledText className="text-white text-3xl font-bold">+</StyledText>
  </StyledTouchableOpacity>
);

const BottomTabNavigator = () => (
  <StyledView className="absolute left-0 right-0 bottom-0 flex-row justify-around items-center h-14 bg-white border-t border-gray-200">
    <StyledText className="text-cyan-500 font-bold">Trang chủ</StyledText>
    <StyledText>Giao dịch</StyledText>
    <StyledText>Công cụ tiền</StyledText>
    <StyledText>Cài đặt</StyledText>
  </StyledView>
);

export default function DashboardScreen() {
  return (
    <StyledView className="flex-1 bg-white">
      <ScrollView>
        <HeaderSection />
        <AssetOverviewSection />
        <NetChangeCard />
        <ExpenseDonutChart />
        <ExpenseGroupList />
      </ScrollView>
      <FloatingAddButton />
      <BottomTabNavigator />
    </StyledView>
  );
}