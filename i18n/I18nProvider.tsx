// i18n/I18nProvider.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type SupportedLang = "vi" | "en";

const translations: Record<SupportedLang, Record<string, string>> = {
  vi: {
    // General
    language: "Ngôn ngữ",
    accountSettings: "Cài đặt tài khoản",
    walletAndCategories: "Cài đặt ví và danh mục",
    walletAndCategories_desc: "Thể loại, Tiền tệ, Số dư ban đầu",
    accountSettings_desc: "Ngôn ngữ, Xuất/Nhập CSV",
    home: "Trang chủ",
    transactions: "Giao dịch",
    budget: "Ngân sách",
    setting: "Cài đặt",
    exportImportCSV: "Xuất / Nhập CSV",
    exportData: "Xuất dữ liệu",
    importData: "Nhập dữ liệu",
    exportCSVFile: "Xuất file CSV",
    importCSVFile: "Nhập file CSV",
    exportDesc:
      "Xuất tất cả giao dịch ra file CSV để sao lưu hoặc phân tích dữ liệu",
    importDesc:
      "Nhập giao dịch từ file CSV. File phải có đúng định dạng: ID, Số tiền, Loại, Danh mục, Tài khoản, Ghi chú, Ngày",
    warning: "Lưu ý",
    warningImport:
      "Nhập dữ liệu sẽ thêm giao dịch mới vào cơ sở dữ liệu hiện tại, không ghi đè dữ liệu cũ.",
    success: "Thành công",
    error: "Lỗi",
    exportSuccess: "Đã xuất {count} giao dịch",
    exportFail: "Không thể xuất file CSV",
    shareFail: "Không thể chia sẻ file trên thiết bị này",
    importFeaturePending:
      "Tính năng nhập CSV sẽ được cập nhật trong phiên bản tiếp theo",
    selectLanguage: "Chọn ngôn ngữ",
    infoLanguage: "Thay đổi ngôn ngữ áp dụng ngay lập tức",
    vietnamese: "Tiếng Việt",
    english: "Tiếng Anh",
    // Chatbox
    back: "Quay lại",
    chatWelcome: "Xin chào!👋 Hãy bắt đầu thêm giao dịch của bạn tại đây nhé!",
    askAmount: "Bạn cho mình biết số tiền cụ thể nhé 💬",
    recorded: "Đã ghi nhận:",
    expense: "Chi phí",
    income: "Thu nhập",
    send: "Gửi",
    inputPlaceholder: "ví dụ: trà sữa 60k · lương tháng 10 10tr…",
    edit: "Sửa",
    delete: "Xóa",
    confirmDelete: "Xác nhận xóa",
    confirmDeleteMsg: "Bạn chắc chắn muốn xóa giao dịch này?",
    cancel: "Hủy",
    editTransaction: "Chỉnh sửa giao dịch",
    amount: "Số tiền",
    note: "Ghi chú",
    category: "Danh mục",
    saveChanges: "Lưu thay đổi",
    // Add Transaction
    addTransaction: "Thêm giao dịch",
    expenditure: "Chi tiêu",
    revenue: "Thu nhập",
    time: "Thời gian",
    enterAmount: "Nhập số tiền",
    enterNotes: "Nhập ghi chú",
    selectCategory: "Chọn danh mục",
    save: "Lưu",
    editCategory: "Sửa",
    today: "Hôm nay",
    yesterday: "Hôm qua",
    thisWeek: "Tuần này",
    lastWeek: "Tuần trước",
    thisMonth: "Tháng này",
    lastMonth: "Tháng trước",
    customRange: "Tùy chỉnh",
  },
  en: {
    language: "Language",
    accountSettings: "Account Settings",
    walletAndCategories: "Wallet & Categories",
    walletAndCategories_desc: "Categories, Currency, Opening Balance",
    accountSettings_desc: "Language, Export/Import CSV",
    home: "Home",
    transactions: "Transactions",
    budget: "Budget",
    setting: "Settings",
    exportImportCSV: "Export / Import CSV",
    exportData: "Export Data",
    importData: "Import Data",
    exportCSVFile: "Export CSV File",
    importCSVFile: "Import CSV File",
    exportDesc: "Export all transactions to a CSV file for backup or analysis",
    importDesc:
      "Import transactions from CSV. File must have columns: ID, Amount, Type, Category, Account, Note, Date",
    warning: "Notice",
    warningImport:
      "Import will append new transactions, existing data is not overwritten.",
    success: "Success",
    error: "Error",
    exportSuccess: "Exported {count} transactions",
    exportFail: "Unable to export CSV file",
    shareFail: "Sharing is not available on this device",
    importFeaturePending: "CSV import feature will arrive in a future version",
    selectLanguage: "Select language",
    infoLanguage: "Language changes apply immediately",
    vietnamese: "Vietnamese",
    english: "English",
    // Chatbox
    back: "Back",
    chatWelcome: "Hello!👋 Start adding your transactions here!",
    askAmount: "Please tell me the exact amount 💬",
    recorded: "Recorded:",
    expense: "Expense",
    income: "Income",
    send: "Send",
    inputPlaceholder: "e.g., milk tea 60k · Oct salary 10m…",
    edit: "Edit",
    delete: "Delete",
    confirmDelete: "Confirm Delete",
    confirmDeleteMsg: "Are you sure you want to delete this transaction?",
    cancel: "Cancel",
    editTransaction: "Edit Transaction",
    amount: "Amount",
    note: "Note",
    category: "Category",
    saveChanges: "Save Changes",
    // Add Transaction
    addTransaction: "Add Transaction",
    expenditure: "Expenditure",
    revenue: "Revenue",
    time: "Time",
    enterAmount: "Enter the amount",
    enterNotes: "Enter notes",
    selectCategory: "Select category",
    save: "Save",
    editCategory: "Edit",
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This Week",
    lastWeek: "Last Week",
    thisMonth: "This Month",
    lastMonth: "Last Month",
    customRange: "Custom Range",
  },
};

interface I18nContextValue {
  lang: SupportedLang;
  setLanguage: (l: SupportedLang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "vi",
  setLanguage: () => {},
  t: (k) => k,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lang, setLang] = useState<SupportedLang>("vi");

  useEffect(() => {
    AsyncStorage.getItem("@app-language").then((stored) => {
      if (stored === "vi" || stored === "en") setLang(stored);
    });
  }, []);

  const setLanguage = (l: SupportedLang) => {
    setLang(l);
    AsyncStorage.setItem("@app-language", l).catch(() => {});
  };

  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string | number>) => {
      const table = translations[lang] || translations.vi;
      let value = table[key] || key;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          value = value.replace(`{${k}}`, String(v));
        });
      }
      return value;
    };
  }, [lang]);

  const ctx = useMemo(() => ({ lang, setLanguage, t }), [lang, t]);

  return <I18nContext.Provider value={ctx}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
