# 账号状态排查

本次读取了通过 USB 连接的手机中已安装的 WhatsApp Business APK，版本 2.26.40.73。手机停在官方欢迎注册页，无法现场验证受限账号或审核结果。分析使用公开安装文件和官方页面，没有读取登录凭据。

## APK 中确认的逻辑

- 账号申诉页面为 com.whatsapp.userban.ui.BanAppealActivity。onStart 和通知入口会请求更新审核状态，并避免重复的在途查询。
- BanAppealViewModel 的状态分支包含 UNKNOWN_IN_CLIENT、NO_APPEAL_OPENED、IN_REVIEW、BANNED 和 UNBANNED。
- 状态查询前检查号码是否完成验证。查询需要手机端保存的 request token，缺失时进入失败分支。
- 新联系人限制使用独立的 reachout timelock 查询。响应有 enforcement_type、time_enforcement_ends 和 is_active，手机还保存了相应状态和显示标记。
- EnumC207299Gt 中包含 RESTRICT_ALL_COMPANIONS。官方存在专门限制所有关联设备的类型，但一次网页掉线本身仍不能证明封号。
- 反编译工具对部分混淆方法报告了失败；结论以实际可读的方法为限。

原始 APK 和反编译文件位于本机 /tmp/haia-whatsapp-public，未纳入仓库。

## HaiA 处理

网页进入配对状态时保留当前进程已缓存的消息和预览，明确更换账号身份时再清理。受限账号暂停断网重试和电脑唤醒触发的自动页面刷新，继续读取原页面状态。发消息仍取决于官方连接状态。收到新联系人限制后跨断连保留该状态，倒计时到期只表示等待确认。

账号状态对话框提供官方申诉说明、查看原网页状态、恢复连接监控及读取手机审核状态。恢复连接仅表示网页可连接，不能当作官方申诉结果。手机审核状态需通过 USB 调试授权，ADB 可执行文件位于 Android SDK 或 PATH 中。

手机读取只接受官方 BanAppealActivity 且完整号码一致的页面。初次成功核对后每分钟读取一次，展示识别结果及最后核对时间。页面隐藏、语言无法识别、号码不匹配、设备断开时保留上一次核对时间。成功绑定后会记住已授权手机，重启 HaiA 后继续核对，也可点击「停止手机监控」。提交申诉仍在官方手机 App 中完成。

官方说明 https://faq.whatsapp.com/465883178708358/
