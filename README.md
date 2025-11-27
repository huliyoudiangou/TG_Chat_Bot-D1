# 🚀 Telegram 双向机器人 Cloudflare Worker

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-FFC425?logo=cloudflare)](https://workers.cloudflare.com/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot_API-3AB3E0?logo=telegram)](https://core.telegram.org/bots/api)
[![D1 Database](https://img.shields.io/badge/D1-Database-FFC425?logo=cloudflare)](https://developers.cloudflare.com/d1)

> **企业级私聊托管与风控解决方案** - 通过 Cloudflare Worker + D1 数据库构建的高性能 Telegram 双向机器人，支持三模态验证、可视化协管系统和智能 CRM 管理

## ✨ 项目简介

这是一个基于 **Cloudflare Worker** 和 **D1 数据库** 构建的高性能 Telegram 双向机器人。  
**Telegram 双向机器人 Cloudflare Worker 混合验证版** 带来了质的飞跃：完美继承私聊消息转发到群组话题的 CRM 核心能力，更引入 **三模态混合验证系统**（Cloudflare/Google/关闭）与 **独立问题验证** 机制，配合全新可视化协管管理，为您提供企业级私聊托管与风控解决方案。

---

## 🔥 版本特性

| 特性 | 说明 |
|------|------|
| 🛡️ **混合验证架构** | 首创验证模式热切换，支持 Cloudflare Turnstile、Google Recaptcha 及关闭模式一键轮询，应对不同网络环境 |
| 🧩 **模块化风控** | “人机验证（Captcha）”与“问题验证（Q&A）”逻辑解耦，可双重开启加强防护，或仅开启问答降低门槛 |
| 👮 **可视化协管** | 重构协管管理逻辑，列表直接显示管理员 ID，支持精准删除与添加，权限管理更透明 |
| ⚡ **CRM 增强** | 支持通过回复 `/clear` 快速撤销用户备注，管理更灵活 |
| 🧠 **智能维护** | 保留数据库自动初始化、单人单卡聚合、双向状态同步等经典特性 |

---

## 🧰 核心功能详解

### 1. 🛡️ 多维安全验证系统（核心升级）
- **三模态一键切换**：在控制面板中随时切换 Cloudflare/Google Recaptcha/关闭验证模式，无需重新部署
- **独立问答验证**：即使关闭人机验证码，也能单独开启“数学题”或“自定义问答”拦截基础脚本攻击
- **组合防御**：支持“验证码 + 问答”双重验证，只有全部通过后用户才能发送消息

### 2. 👮 协管权限系统（优化）
- **权限下放**：主管理员可添加多名协管员，拥有回复消息、查看面板、管理黑名单权限
- **可视化管理**：在协管面板直观展示所有协管的 Telegram ID，点击 ID 一键删除，告别盲猜

### 3. 📨 双向消息中继
- **自动话题**：每个用户的私聊消息自动在管理员群组创建独立话题（Topic）
- **无感回复**：管理员在话题内直接回复，机器人自动转发给用户；用户回复自动转入对应话题

### 4. 📇 CRM 客户管理系统
- **智能备注**：管理员点击资料卡 ✏️ 按钮为用户打标签
- **新特性**：备注模式下回复 `/clear` 可直接删除当前备注
- **全局同步**：修改备注后，该用户所有历史资料卡（话题顶部、通知消息）自动同步更新
- **资料卡追踪**：话题顶部始终置顶最新用户资料卡（含 ID、用户名、注册时间及备注）

### 5. 📥 聚合收件箱 (One Card Policy)
- **防刷屏机制**：无论用户发送多少消息，“🔔 未读消息”话题中每个用户只保留一张最新通知卡片
- **阅后即焚**：点击 ✅ 已阅/删除，卡片即刻消失并重置通知冷却时间
- **一键直达**：通知卡片包含跳转按钮，点击直达用户专属聊天话题

### 6. 🚫 黑名单隔离系统
- **双向同步**：手动屏蔽或触发关键词自动封禁后，在“🚫 黑名单”话题生成卡片
- **一键解封**：在个人话题或黑名单话题点击解封，状态双向同步，黑名单卡片自动销毁
- **自助重置**：被封禁用户发送 `/start` 可触发重置流程，重新进行验证

### 7. 🌙 营业状态管理
- **一键切换**：在面板中切换“营业中”或“休息中”
- **自动回复**：休息模式下用户发消息收到预设忙碌提示（内置防抖机制避免重复打扰）

---

## 🛠️ 部署指南（保姆级教程）

> **📺 视频教程**：[点击访问部署视频教程](https://t.me/yinhai_notify/371?comment=136740)

### 📋 准备工作
1. [Cloudflare 账号](https://dash.cloudflare.com/)
2. Telegram Bot Token（通过 [@BotFather](https://t.me/BotFather) 获取）
3. Telegram 管理员群组 ID（必须是**开启话题功能的超级群组**，ID 以 `-100` 开头，通过 [@raw_data_bot](https://t.me/raw_data_bot) 获取）
4. 管理员 ID（你自己的 TG ID，通过 [@raw_data_bot](https://t.me/raw_data_bot) 获取）

> 💡 **升级超级群组技巧**（不公开群组方法）：
> 1. 将群组的 **新成员是否可见消息记录** 设置为 **可见**
> 2. 在 **管理员权限** 中细分权限，关闭 bot 用不上的权限

---

### 步骤一：创建 D1 数据库
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 导航至 **存储和数据库 → D1 数据库**
3. 点击 **创建数据库**，命名为 `tg-bot-db`（或自定义名称）
4. **无需**进行其他操作（代码会自动建表）

### 步骤二：创建 Worker
1. 进入 **Workers 和 Pages → 创建 Worker**
2. 命名 Worker（例如 `tg-contact-bot`）→ 点击 **部署**
3. 点击 **编辑代码**
4. **全量覆盖**：删除所有默认代码，将 [`worker.js`](https://github.com/your-repo/telegram-cf-worker/blob/main/worker.js) 的完整代码粘贴进去
5. **点击部署**，进行下一步配置

### 步骤三：绑定 D1 数据库
1. 在代码编辑页面左侧/上方找到 **设置 (Settings) 或 绑定 (Bindings)**
2. 添加 D1 数据库绑定：
   - **变量名称 (Variable Name)**：`TG_BOT_DB`（必须严格匹配大小写）
   - **数据库**：选择步骤一创建的数据库
3. 保存设置

### 步骤四：配置 Turnstile 验证
1. 在 Cloudflare 侧边栏选择 **Turnstile → 添加站点**
2. 填写配置：
   - **站点名称**：任意（如 `tg-bot-verification`）
   - **域**：填写 Worker 域名（例如 `your-worker.your-subdomain.workers.dev` 或 `workers.dev`）
   - **模式**：选择 **托管 (Managed)**
3. 创建后复制 **站点密钥 (Site Key)** 和 **密钥 (Secret Key)** 备用

### 步骤五：配置环境变量
在 Worker 的 **设置 → 变量** 中，添加以下 **8 个必备变量**：

| 变量名称 | 示例值 | 说明 |
|----------|--------|------|
| `BOT_TOKEN` | `12345:AAH...` | 你的 Bot Token |
| `ADMIN_IDS` | `123456,789012` | 管理员ID（多人用英文逗号分隔，**无空格**） |
| `ADMIN_GROUP_ID` | `-100123456789` | 开启话题的超级群组 ID |
| `WORKER_URL` | `https://xxx.workers.dev` | Worker 完整访问链接（**不带末尾斜杠**） |
| `TURNSTILE_SITE_KEY` | `0x4AAAA...` | 步骤四获取的 Turnstile 站点密钥 |
| `TURNSTILE_SECRET_KEY` | `0x4AAAA...` | 步骤四获取的 Turnstile 密钥 |
| `RECAPTCHA_SITE_KEY` | `6LAAAAABBCCDDBGHYDD_cDmgjUtEbpF` | [Google reCAPTCHA v2](https://www.google.com/recaptcha/admin) 站点密钥 |
| `RECAPTCHA_SECRET_KEY` | `6LAAAAABDDCCFGTTH-AIMK6z-H4aE` | [Google reCAPTCHA v2](https://www.google.com/recaptcha/admin) 密钥 |

> ⚠️ **重要**：  
> - Google reCAPTCHA 需自行在 [Google reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin) 创建（选择 **v2 Checkbox** 类型）
> - 所有变量值**不要包含空格或引号**
> - 点击 **部署 (Deploy)** 使代码和配置生效

### 步骤六：设置 Webhook
在浏览器地址栏输入以下 URL 并回车（替换 `<你的BOT_TOKEN>` 和 `<你的WORKER_URL>`）：
```bash
https://api.telegram.org/bot<你的BOT_TOKEN>/setWebhook?url=<你的WORKER_URL>
```
✅ **成功响应**：
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

---

## ❓ 常见问题解答

| 问题现象 | 可能原因 | 解决方案 |
|----------|----------|----------|
| `[说明1] 系统忙，请稍后再试` | 1. 机器人未获得足够权限<br>2. 群组ID错误<br>3. 群组未升级为超级群组<br>4. 未开启话题功能 | 1. 检查群组是否为超级群组<br>2. 确认群组设置中 **开启话题**<br>3. 通过 [@raw_data_bot](https://t.me/raw_data_bot) 检查群组状态 |
| `[说明2] 私聊BOT/start无反应` | `BOT_TOKEN` 配置错误 | 1. 重新从 @BotFather 获取 Token<br>2. 检查环境变量是否有拼写错误<br>3. 重新设置 webhook |
| `[说明3] 回复消息无反应` | `ADMIN_IDS` 配置错误 | 1. 通过 [@raw_data_bot](https://t.me/raw_data_bot) 确认你的 TG ID<br>2. 检查环境变量中 ID 是否正确且无空格 |
| `[说明4] 点击配置菜单出现ERROR` | D1 数据库未绑定或变量名错误 | 1. 检查绑定变量名是否为 `TG_BOT_DB`（大小写敏感）<br>2. 确认数据库已正确创建 |
| `[说明5] 点击配置菜单无反应` | D1 数据库配置错误 | 1. 重新绑定数据库<br>2. 检查 Worker 代码是否包含最新 D1 初始化逻辑 |

---

## 📜 许可证
本项目采用 [MIT 许可证](LICENSE) - 详情请参阅 LICENSE 文件

---

> **💡 提示**：部署完成后，向机器人发送 `/start` 即可体验完整功能！  
> 遇到问题？请在 [Issues](https://github.com/huliyoudiangou/TG_Chat_Bot-D1/issues) 提交详细日志，我们将快速响应！  

**🌟 给项目一个 Star 吧！您的支持是我们持续更新的动力！**  
[![GitHub stars](https://img.shields.io/github/stars/your-repo/telegram-cf-worker?style=social)](https://github.com/huliyoudiangou/TG_Chat_Bot-D1)
