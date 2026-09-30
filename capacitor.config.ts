import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.huisheng.echo",
  appName: "回声",
  webDir: "mobile-dist",
  server: { androidScheme: "https", cleartext: true },
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;
