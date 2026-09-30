# 回声 iOS 构建说明

## 环境

- macOS
- Xcode 16 或更新版本
- Node.js 22.13 或更新版本
- Apple ID；真机长期安装或发布需要 Apple Developer 账号
- iPhone 与运行 WeClone 的电脑处于同一局域网

## 首次构建

```bash
pnpm install
pnpm ios:sync
pnpm ios:open
```

在 Xcode 中：

1. 选择 `App` Target。
2. 打开 `Signing & Capabilities`，选择自己的 Team。
3. 确认 Bundle Identifier 为 `com.huisheng.echo`；如果已被占用，改成自己的唯一标识。
4. 连接 iPhone，选择该设备后点击 Run。
5. 首次访问专业档时，允许“本地网络”权限；使用录音时允许“麦克风”权限。

## 日常同步

网页或功能更新后执行：

```bash
pnpm ios:sync
```

然后在 Xcode 中重新运行或归档。

## 局域网专业档

电脑端桥接地址默认为 `http://192.168.1.103:8006`。请先启动电脑端 WeClone、语音服务和 Echo Bridge，并确保 Windows 防火墙允许 8006 端口。

如果电脑 IP 发生变化，在 App 的连接设置中填写新的局域网地址。

## 导出 IPA

在 Xcode 中依次选择 `Product > Archive`，归档完成后通过 Organizer 选择 Development、Ad Hoc 或 App Store Connect 分发方式。Windows 无法完成 Apple 签名与 IPA 导出。
