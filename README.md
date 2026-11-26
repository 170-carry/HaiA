# HaiA

HaiA 是 macOS 和 Windows 上的 WhatsApp 多账号收件箱。每个账号独立扫码或使用 8 位关联码登录。可以在全部账号之间统一查看未读会话，也可以切换到一个账号处理私聊和群消息。联系人搜索支持姓名、带区号和空格的手机号，以及连续数字。

## 安装

在 [GitHub Releases](https://github.com/170-carry/HaiA/releases) 下载对应平台的安装包。Apple 芯片 Mac 使用 arm64 DMG，Intel Mac 使用 x64 DMG，Windows 使用 x64 EXE。

从 0.9.12 起，设置中的「检查更新」可以直接下载安装包，校验通过后选择「重启并更新」。旧版需要先手动安装一次 0.9.12 或更高版本。

打开应用后点击「添加账号」，在主手机的 WhatsApp「已关联设备」中确认关联。历史记录的可见范围取决于 WhatsApp 同步到该设备的内容。

## 从源码运行

使用 Node.js 22.12 或更高版本以及 npm。

```sh
npm ci
npm start
```

`npm test` 运行单元测试。`npm run dist:mac` 在 macOS 上构建两种架构的 DMG，`npm run dist:win` 构建 Windows 安装包。输出位于 `dist/<版本号>/`。

### 发布应用内更新

两个平台打包完成后执行 `npm run update:manifest`，将生成的 `latest.json` 和三份安装包一起上传到同一个正式 GitHub Release，然后标为 Latest。清单签名涵盖版本、平台、文件名、大小和 SHA-256。已发布的客户端使用内置公钥校验清单。

签名脚本通过 `HAIA_UPDATE_KEY_FILE` 读取 HaiA 的 Ed25519 发布私钥。发布机的默认位置是 `~/Library/Application Support/HaiA Release/update-ed25519.pem`。请单独备份并保管发布私钥。自行发行的分支应替换更新源和 `src/main/updates/public.pem`。

## 账号迁移

在设置齿轮上方打开「账号迁移」，选择一个或多个已登录账号，导出为一个免密码的 `.haia` 文件。文件仅包含认证所需的本地数据，包含可用于登录的敏感凭据，请只交给自己的可信设备。

导入后使用复制的关联设备身份连接，历史记录由 WhatsApp 能同步的范围决定。此操作不会为另一台电脑注册独立的关联设备；需要两台电脑同时在线时，应在每台电脑通过手机分别关联。旧的加密文件仍可导入，读取时需要旧密码。

## 数据与翻译

HaiA 通过 Electron 中隔离的 WhatsApp Web 会话和 WA-JS 接收消息。登录状态和账号设置保存在本机。使用翻译或语音转文字时，相应文本或录音会提交给所选服务。自有翻译密钥在本机配置。

## 许可证

HaiA 源代码使用 [MIT 许可证](LICENSE)。Electron、WA-JS 等第三方组件使用各自的许可证。WhatsApp 名称和标识归其权利人所有。HaiA 是社区开发的独立客户端。
