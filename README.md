# 回声 Echo

一个以“记忆、关系和声音”为核心的开源 AI 陪伴应用。回声可以从聊天素材中学习表达风格，支持图片理解、三层记忆、主动联系、提醒、多人群聊、语音通话和可选的声音克隆。

> 本项目生成的是 AI 模拟角色，不是真人。导入他人的聊天记录、照片或声音前，请先获得本人明确授权。

## 功能

- 豆包视觉语言模型驱动的文字与图片对话
- 短期上下文、生活事件和长期记忆三层记忆
- 可查看、修改、删除的记忆中心
- 本地通知、定时提醒与主动联系
- 多智能体群聊、自然输入节奏和图片分享
- 共同相册与生活连续性
- Android 本地两阶段中文语音识别
- 阿里云 CosyVoice 云端音色克隆与语音合成
- 深色/浅色主题、流式生成、聊天列表虚拟化和手势交互

## 技术结构

- `mobile/`：Vite + Capacitor 移动端界面
- `android/`：Android 原生插件、离线语音识别和 APK 工程
- `bridge/`：Node.js 公网桥接、云端语音代理及旧版本地语音兼容层
- `ios/`：iOS Capacitor 工程（实验性）
- `tests/`：渲染、游乐场与云端语音接口测试

## 环境要求

- Node.js 22.13 或更高版本
- JDK 21
- Android SDK（构建 Android 版时）
- 火山方舟 API Key（文字和图片理解）
- 可选：阿里云百炼 API Key 与 Workspace ID（云端声音）
- 可选：Cloudflare Tunnel（公网访问自托管桥接服务）

## 开始使用

```powershell
npm ci
Copy-Item mobile/private-config.example.js mobile/private-config.js
npm run mobile:build
```

同步并构建 Android：

```powershell
npm run mobile:sync
Set-Location android
./gradlew.bat assembleEchoDebug
```

## 私有配置

客户端开发配置：

```powershell
Copy-Item mobile/private-config.example.js mobile/private-config.js
```

桥接服务配置：

```powershell
Copy-Item bridge/.env.example bridge/.env.local
```

云端语音至少需要：

```dotenv
ECHO_VOICE_PROVIDER=aliyun
ECHO_PUBLIC_BASE_URL=https://your-domain.example
DASHSCOPE_API_KEY=your-key
DASHSCOPE_WORKSPACE_ID=your-workspace-id
ECHO_ALLOW_LOCAL_VOICE_FALLBACK=false
```

所有真实密钥文件都已加入 `.gitignore`。不要把生产密钥打包进公开 APK；正式部署建议让客户端只访问你自己的受保护桥接服务。

## 离线语音模型

仓库保留兼容用的基础离线模型。新的 Sherpa-ONNX 两阶段模型体积较大，不直接提交到 Git：

- `sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01`
- `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09`
- `itn_zh_number.fst`

下载后放入 `android/app/src/main/assets/` 对应目录。缺少它们时应用会回退到兼容的离线识别路径。

## 测试

```powershell
npm run mobile:build
node --test tests/cloud-voice.test.mjs
```

## 隐私与伦理

- 聊天记录、声音、照片和记忆默认都应视为敏感个人数据。
- 不得在未授权情况下克隆或冒充他人声音与身份。
- 面向公众分发时，应提供清晰的 AI 身份提示、数据删除入口和隐私政策。
- 服务端不得记录完整聊天、密钥或原始声音样本。

## 许可证

[MIT](LICENSE)
