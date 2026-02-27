import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.matrixsystems.traqs",
  appName: "TRAQS",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#0f172a",
      androidSplashResourceName: "splash",
      iosContentMode: "fill",
      showSpinner: false,
    },
    Keyboard: {
      resize: "body",
      style: "dark",
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#0f172a",
    },
  },
};

export default config;
