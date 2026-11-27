# HaiA 本地数据目录

HaiA 从本机读取账号清单、会话快照和草稿。异常退出后，打开原账号即可翻页、搜索和预览已经保存的内容。界面会标出只读状态。重新关联同一号码后继续同步，关联另一号码时原账号的历史保留为单独的只读条目。

## 目录与部署

「设置 → 关于 → 打开数据目录」可查看当前实例的实际位置。macOS 的默认目录为 `~/Library/Application Support/HaiA`，Windows 为 `%APPDATA%\HaiA`。升级安装会沿用同一位置下已有 `accounts.json` 的 `Relay Desk` 目录。可以用绝对路径环境变量 `HAIA_DATA_DIR` 指定数据目录，账号目录与 Electron 的持久会话都会使用这个位置。

例如，在 macOS 上退出 HaiA 后，指定独立数据目录启动应用：

```sh
HAIA_DATA_DIR="$HOME/HaiA-data" /Applications/HaiA.app/Contents/MacOS/HaiA
```

在 Windows PowerShell 中可以设置当前进程的环境变量，然后启动已安装的 HaiA：

```powershell
$env:HAIA_DATA_DIR = 'D:\HaiA-data'
Start-Process "$env:LOCALAPPDATA\Programs\HaiA\HaiA.exe"
```

如果安装位置不同，使用实际的可执行文件路径。指定空目录会得到新的工作区。要在同一电脑上移动数据，应彻底退出 HaiA，再把整个原目录复制到目标位置。备份时一起复制 SQLite 数据库及同目录的 WAL 文件。每个运行实例使用独占数据目录。

## 已持久化的数据

| 数据 | 本机位置 | 恢复方式 |
| --- | --- | --- |
| 账号名称、顺序、号码、关联与异常退出状态 | `accounts.json` | 启动读取，写入临时文件后同步并替换 |
| WhatsApp Web 的授权资料 | `Partitions/wa-<账号 ID>/` | 由每个账号的 Electron 持久会话维护，继续使用 WhatsApp 的设备授权校验 |
| 会话目录、最近有正文的预览、未读数、会话标记 | `chat-snapshots/<账号 ID>/history.sqlite` | 启动从会话索引恢复，断开连接可继续查看 |
| 收发正文、消息类型、发件人、引用、编辑、撤回、已读回执、表情回应、投票 | 同一数据库 | 按消息 ID 更新，按会话与时间分页；提前到达的变更按 ID 保存并在正文到达时合并 |
| 已取得的头像、群资料、联系人详情、消息详情 | 同一数据库的 `meta` 表 | 离线可读取最近一次成功取得的值 |
| 已成功翻译的聊天消息 | 同一数据库的 `translations` 表 | 按消息、原文摘要、语言、引擎读取；编辑或撤回会清理旧译文 |
| 附件元数据和缩略图 | 同一数据库的消息记录 | 聊天打开时读取 |
| 已从本机发送或下载的附件原件、旧备份含有的附件 | 账号快照目录中的 `file-<摘要>` | 依据账号、会话和消息 ID 查找文件。远端尚未下载的原件需联网取得。一次性媒体沿用 WhatsApp 的限制 |
| 草稿正文、提及对象、引用、待发送附件 | 工作区 Electron 配置目录的 IndexedDB，库名 `HaiA-composer` | 以账号和会话为键，附件用 Blob 存储；升级时迁移旧文本草稿 |
| 通知偏好、快捷回复和翻译授权 | `preferences.json`、`translation.json` | 翻译 API 密钥使用系统密钥服务加密 |
| 发送快捷键、翻译显示模式、资料面板偏好 | 工作区 Electron 配置目录的 Local Storage | 界面启动时读取 |
| 已导入的旧聊天备份 | `account-backups/<账号 ID>/` | 升级和后续导入时补入相应账号的聊天快照 |

授权仍由平台决定有效性。系统钥匙串、Windows 用户密钥保护以及设备关联状态会影响授权资料能否在另一台电脑使用。正文快照采用本机 SQLite，文件访问权限随操作系统用户目录管理。屏幕上的输入状态、正在通话状态、二维码和短时关联码属于临时状态。

## 回溯与核查

首次升级先读取已登记账号的旧聊天库和已导入备份。有效授权上线后，按会话分页补读 WhatsApp 返回的历史。每一页的记录与同步游标在同一事务中提交。旧库仍有可读正文时会自动纳入快照，旧库只留有不可读记录时，正文恢复取决于关联设备之后实际返回的内容。

`events` 表记录写入时间（Unix 毫秒）、操作、来源和关联 ID。来源包括实时同步 `web-sync`、历史补读 `web-history`、历史搜索 `web-search`、本机发送结果 `send-result`、旧库回溯 `legacy-local`、备份导入 `backup-import`、回执 `web-receipt` 和消息变更 `web-change`。审计事件记录来源，聊天正文只存于消息表，登录凭据留在持久会话中。撤回和删除会更新当前快照；操作时间与来源可查。

对某个账号的数据库副本以只读方式执行以下参数化查询，即可核对一条消息的写入顺序。此查询使用 `events_record(ref,seq)` 索引，并最多读取 20 条事件：

```sql
SELECT at, operation, source, ref
FROM events
WHERE ref = ?
ORDER BY seq DESC
LIMIT 20;
```

聊天分页和最近预览分别使用 `history_page` 与 `history_preview` 索引。正文包含匹配使用独立文字表，按账号或会话搜索，最多返回 80 个命中结果；宽范围的无匹配搜索需要遍历候选文字。运行 `npm test` 可复验索引计划、写入失败重试、重启读取、数据隔离和删除行为。
