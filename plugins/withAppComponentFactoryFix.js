// plugins/withAppComponentFactoryFix.js
const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withAppComponentFactoryFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application?.[0];

    if (!app) return config;

    app.$ = app.$ || {};

    // Thêm namespace tools nếu chưa có
    app.$["xmlns:tools"] =
      app.$["xmlns:tools"] || "http://schemas.android.com/tools";

    // Ghép thêm android:appComponentFactory vào tools:replace
    const currentReplace = (app.$["tools:replace"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!currentReplace.includes("android:appComponentFactory")) {
      currentReplace.push("android:appComponentFactory");
    }

    app.$["tools:replace"] = currentReplace.join(",");

    // Chọn AndroidX làm giá trị cuối cùng
    app.$["android:appComponentFactory"] =
      "androidx.core.app.CoreComponentFactory";

    return config;
  });
};
