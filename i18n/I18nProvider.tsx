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
