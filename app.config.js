export default ({ config }) => ({
  ...config,
  // This name and slug will be pulled from app.json if it exists,
  // but we'll ensure they are defined here just in case.
  name: config.name || "my-supabase-app",
  slug: config.slug || "my-supabase-app",
  version: config.version || "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  // This is where your secrets live
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_KEY,
    eas: {
      projectId: "your-project-id-here", // Add this if you use EAS Build
    },
  },
});
