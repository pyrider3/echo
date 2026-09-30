import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "回声 Echo｜让熟悉的声音，再次回应你",
  description: "从聊天记录创建专属 AI 智能体，用文字或经授权的声音继续对话。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "回声 Echo｜让熟悉的声音，再次回应你",
    description: "从聊天记录创建专属 AI 智能体，用文字或经授权的声音继续对话。",
    images: [{ url: "/og.png", width: 1732, height: 910 }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
