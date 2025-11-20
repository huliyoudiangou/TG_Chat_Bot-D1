/**
 * Telegram Bot Worker v3.33 (Fixed Edition)
 * 修复: 设置备注导致昵称丢失的问题 (数据同步修复)
 * 修复: /start 无反应问题
 * 功能: 全功能保留
 */

// --- 1. 静态配置 ---
const CACHE = { data: {}, ts: 0, ttl: 60000, user_locks: {} };
const DEFAULTS = {
    welcome_msg: "欢迎！使用前请先完成人机验证。",
    verif_q: "1+1=?\n提示：答案在简介中。", verif_a: "3",
    block_threshold: "5", enable_admin_receipt: "true",
    enable_image_forwarding: "true", enable_link_forwarding: "true", enable_text_forwarding: "true",
    enable_channel_forwarding: "true", enable_forward_forwarding: "true", enable_audio_forwarding: "true", enable_sticker_forwarding: "true",
    backup_group_id: "", unread_topic_id: "", blocked_topic_id: "",
    busy_mode: "false", busy_msg: "当前是非营业时间，消息已收到，管理员稍后回复。",
    block_keywords: "[]", keyword_responses: "[]", authorized_admins: "[]"
};

const MSG_TYPES = [
    { check: m => m.forward_from || m.forward_from_chat, key: 'enable_forward_forwarding', name: "转发消息", extra: m => m.forward_from_chat?.type === 'channel' ? 'enable_channel_forwarding' : null },
    { check: m => m.audio || m.voice, key: 'enable_audio_forwarding', name: "语音/音频" },
    { check: m => m.sticker || m.animation, key: 'enable_sticker_forwarding', name: "贴纸/GIF" },
    { check: m => m.photo || m.video || m.document, key: 'enable_image_forwarding', name: "媒体文件" },
    { check: m => (m.entities||[]).some(e => ['url','text_link'].includes(e.type)), key: 'enable_link_forwarding', name: "链接" },
    { check: m => m.text, key: 'enable_text_forwarding', name: "纯文本" }
];

// --- 2. 核心入口 ---
export default {
    async fetch(req, env, ctx) {
        ctx.waitUntil(dbInit(env));
        const url = new URL(req.url);
        if (req.method === "GET") {
            if (url.pathname === "/verify") return handleVerifyPage(url, env);
            if (url.pathname === "/") return new Response("Bot v3.33 Active", { status: 200 });
        }
        if (req.method === "POST") {
            if (url.pathname === "/submit_token") return handleTokenSubmit(req, env);
            try {
                const update = await req.json();
                ctx.waitUntil(handleUpdate(update, env, ctx));
                return new Response("OK");
            } catch (e) { return new Response("Err", { status: 500 }); }
        }
        return new Response("404", { status: 404 });
    }
};

// --- 3. 数据库与配置 ---
const sql = async (env, query, args = [], type = 'run') => {
    try {
        const stmt = env.TG_BOT_DB.prepare(query).bind(...(Array.isArray(args) ? args : [args]));
        return type === 'run' ? await stmt.run() : await stmt[type]();
    } catch (e) { return null; }
};

async function getCfg(key, env) {
    const now = Date.now();
    if (CACHE.ts && (now - CACHE.ts) < CACHE.ttl && CACHE.data[key] !== undefined) return CACHE.data[key];
    const rows = await sql(env, "SELECT * FROM config", [], 'all');
    if (rows && rows.results) {
        CACHE.data = {};
        rows.results.forEach(r => CACHE.data[r.key] = r.value);
        CACHE.ts = now;
    }
    const envKey = key.toUpperCase().replace(/_MSG|_Q|_A/, m => ({'_MSG':'_MESSAGE','_Q':'_QUESTION','_A':'_ANSWER'}[m]));
    return CACHE.data[key] !== undefined ? CACHE.data[key] : (env[envKey] || DEFAULTS[key] || "");
}
async function setCfg(key, val, env) { await sql(env, "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, val]); CACHE.ts = 0; }

async function getUser(id, env) {
    let u = await sql(env, "SELECT * FROM users WHERE user_id = ?", id, 'first');
    if (!u) {
        try { await sql(env, "INSERT INTO users (user_id, user_state) VALUES (?, 'new')", id); } catch {}
        u = await sql(env, "SELECT * FROM users WHERE user_id = ?", id, 'first') || { user_id: id, user_state: 'new', is_blocked: 0, block_count: 0, first_message_sent: 0, topic_id: null, user_info: {} };
    }
    u.is_blocked = !!u.is_blocked; u.first_message_sent = !!u.first_message_sent;
    u.user_info = u.user_info_json ? JSON.parse(u.user_info_json) : {};
    return u;
}
async function updUser(id, data, env) {
    if (data.user_info) { data.user_info_json = JSON.stringify(data.user_info); delete data.user_info; }
    const keys = Object.keys(data); if (!keys.length) return;
    await sql(env, `UPDATE users SET ${keys.map(k => `${k}=?`).join(',')} WHERE user_id=?`, [...keys.map(k => typeof data[k] === 'boolean' ? (data[k]?1:0) : data[k]), id]);
}

async function dbInit(env) {
    if (!env.TG_BOT_DB) return;
    try { await env.TG_BOT_DB.batch([
        env.TG_BOT_DB.prepare(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`),
        env.TG_BOT_DB.prepare(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, user_state TEXT DEFAULT 'new', is_blocked INTEGER DEFAULT 0, block_count INTEGER DEFAULT 0, first_message_sent INTEGER DEFAULT 0, topic_id TEXT, user_info_json TEXT)`),
        env.TG_BOT_DB.prepare(`CREATE TABLE IF NOT EXISTS messages (user_id TEXT, message_id TEXT, text TEXT, date INTEGER, PRIMARY KEY (user_id, message_id))`)
    ]); } catch {}
}

// --- 4. 业务逻辑 ---
async function api(token, method, body) {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) throw new Error(d.description); return d.result;
}

async function registerCommands(env) {
    try {
        await api(env.BOT_TOKEN, "deleteMyCommands", { scope: { type: "default" } });
        await api(env.BOT_TOKEN, "setMyCommands", { commands: [{ command: "start", description: "开始 / Start" }], scope: { type: "default" } });
        const list = [...(env.ADMIN_IDS||"").split(/[,，]/), ...(await getJsonCfg('authorized_admins', env))];
        const admins = [...new Set(list.map(i=>i.trim()).filter(Boolean))];
        for (const id of admins) await api(env.BOT_TOKEN, "setMyCommands", { commands: [{ command: "start", description: "⚙️ 管理面板" }, { command: "help", description: "📄 帮助说明" }], scope: { type: "chat", chat_id: id } });
    } catch (e) {}
}

async function handleUpdate(update, env, ctx) {
    const msg = update.message || update.edited_message;
    if (!msg) return update.callback_query ? handleCallback(update.callback_query, env) : null;
    if (update.edited_message) return (msg.chat.type === "private") ? handleEdit(msg, env) : null;
    if (msg.chat.type === "private") await handlePrivate(msg, env, ctx);
    else if (msg.chat.id.toString() === env.ADMIN_GROUP_ID) await handleAdminReply(msg, env);
}

async function handlePrivate(msg, env, ctx) {
    const id = msg.chat.id.toString(), text = msg.text || "";
    const isAdm = (env.ADMIN_IDS || "").includes(id);
    
    if (text === "/start") {
        if (isAdm && ctx) ctx.waitUntil(registerCommands(env));
        return isAdm ? handleAdminConfig(id, null, 'menu', null, null, env) : sendStart(id, msg, env);
    }
    if (text === "/help" && isAdm) return api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: "ℹ️ <b>帮助</b>\n• 回复消息即对话\n• /start 打开面板", parse_mode: "HTML" });

    const u = await getUser(id, env);

    // [自愈] 封禁用户重启
    if (u.is_blocked) {
        if (text === "/start") { 
            await updUser(id, { is_blocked: 0, user_state: 'new', block_count: 0 }, env);
            const mockMeta = { id: id, username: u.user_info.username, first_name: u.user_info.name };
            await manageBlacklist(env, u, mockMeta, false);
            return sendStart(id, msg, env);
        }
        return; 
    }

    if (await isAuthAdmin(id, env)) {
        if(u.user_state !== "verified") { await updUser(id, { user_state: "verified" }, env); u.user_state = "verified"; }
        if(text === "/start" && ctx) ctx.waitUntil(registerCommands(env));
    }

    if (isAdm) {
        const stateStr = await getCfg(`admin_state:${id}`, env);
        if (stateStr) {
            const state = JSON.parse(stateStr);
            if (state.action === 'input') return handleAdminInput(id, text, state, env);
        }
    }

    const state = u.user_state;
    if (['new','pending_turnstile'].includes(state)) return sendStart(id, msg, env);
    if (state === 'pending_verification') return verifyAnswer(id, text, env);
    if (state === 'verified') return handleVerifiedMsg(msg, u, env);
}

async function sendStart(id, msg, env) {
    const u = await getUser(id, env);
    
    if (u.topic_id) {
        const success = await sendInfoCardToTopic(env, u, msg.from, u.topic_id);
        if (!success) await updUser(id, { topic_id: null }, env);
    }

    const url = (env.WORKER_URL || "").replace(/\/$/, '');
    if (url && env.TURNSTILE_SITE_KEY) {
        return api(env.BOT_TOKEN, "sendMessage", { 
            chat_id: id, 
            text: (await getCfg('welcome_msg', env)) + "\n\n请点击下方按钮进行验证：", 
            reply_markup: { inline_keyboard: [[{ text: "🛡️ 安全验证", web_app: { url: `${url}/verify?user_id=${id}` } }]] } 
        });
    } else {
        return api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: (await getCfg('welcome_msg', env)) + "\n(系统提示: 未配置 WORKER_URL 或 TURNSTILE_SITE_KEY，请联系管理员)" });
    }
}

async function handleVerifiedMsg(msg, u, env) {
    const id = u.user_id, text = msg.text || "";

    if (text) {
        const kws = await getJsonCfg('block_keywords', env);
        if (kws.some(k => new RegExp(k, 'gi').test(text))) {
            const c = u.block_count + 1, max = parseInt(await getCfg('block_threshold', env)) || 5;
            const willBlock = c >= max;
            await updUser(id, { block_count: c, is_blocked: willBlock }, env);
            if (willBlock) {
                await manageBlacklist(env, u, msg.from, true);
                return api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: "❌ 已封禁 (发送 /start 可申请解封)" });
            }
            return api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: `⚠️ 屏蔽词 (${c}/${max})` });
        }
    }

    for (const t of MSG_TYPES) {
        if (t.check(msg)) {
            if ((t.extra && !(await getBool(t.extra(msg), env))) || (!t.extra && !(await getBool(t.key, env))))
                return api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: `⚠️ 不接收 ${t.name}` });
            break;
        }
    }

    if (await getBool('busy_mode', env)) {
        const now = Date.now();
        if (now - (u.user_info.last_busy_reply || 0) > 300000) {
            await api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: "🌙 " + await getCfg('busy_msg', env) });
            await updUser(id, { user_info: { ...u.user_info, last_busy_reply: now } }, env);
        }
    }

    if (text) {
        const rules = await getJsonCfg('keyword_responses', env);
        const match = rules.find(r => new RegExp(r.keywords, 'gi').test(text));
        if (match) return api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: "自动回复：\n" + match.response });
    }
    await relayToTopic(msg, u, env);
}

async function relayToTopic(msg, u, env) {
    const uMeta = getUMeta(msg.from, u, msg.date), uid = u.user_id;
    let tid = u.topic_id;

    // [修复点]：每次收到用户消息，都更新数据库中的昵称和用户名，确保备注时能取到最新数据
    if (u.user_info.name !== uMeta.name || u.user_info.username !== uMeta.username) {
        await updUser(uid, { user_info: { ...u.user_info, name: uMeta.name, username: uMeta.username } }, env);
        // 更新本地对象，供后续逻辑使用
        u.user_info.name = uMeta.name;
        u.user_info.username = uMeta.username;
    }

    if (!tid) {
        if (CACHE.user_locks[uid]) return;
        CACHE.user_locks[uid] = true;
        try {
            const t = await api(env.BOT_TOKEN, "createForumTopic", { chat_id: env.ADMIN_GROUP_ID, name: uMeta.topicName });
            tid = t.message_thread_id.toString();
            await updUser(uid, { topic_id: tid }, env);
            await sendInfoCardToTopic(env, u, msg.from, tid, msg.date);
        } catch (e) { 
            delete CACHE.user_locks[uid];
            return api(env.BOT_TOKEN, "sendMessage", { chat_id: uid, text: "系统忙，请稍后再试" }); 
        }
        delete CACHE.user_locks[uid];
    }

    try {
        await api(env.BOT_TOKEN, "copyMessage", { chat_id: env.ADMIN_GROUP_ID, from_chat_id: uid, message_id: msg.message_id, message_thread_id: tid });
        api(env.BOT_TOKEN, "sendMessage", { chat_id: uid, text: "✅ 已送达", reply_to_message_id: msg.message_id, disable_notification: true }).catch(()=>{});
        if (msg.text) await sql(env, "INSERT OR REPLACE INTO messages (user_id, message_id, text, date) VALUES (?,?,?,?)", [uid, msg.message_id, msg.text, msg.date]);
        await handleBackup(msg, uMeta, env);
        await handleInbox(env, msg, u, tid, uMeta);
    } catch (e) {
        if (e.message.includes("thread")) { await updUser(uid, { topic_id: null }, env); api(env.BOT_TOKEN, "sendMessage", { chat_id: uid, text: "会话过期，请重发" }); }
    }
}

// [工具] 发送资料卡
async function sendInfoCardToTopic(env, u, tgUser, tid, date) {
    const meta = getUMeta(tgUser, u, date || (Date.now()/1000));
    try {
        const card = await api(env.BOT_TOKEN, "sendMessage", { 
            chat_id: env.ADMIN_GROUP_ID, message_thread_id: tid, text: meta.card, parse_mode: "HTML", 
            reply_markup: getBtns(u.user_id, u.is_blocked) 
        });
        await api(env.BOT_TOKEN, "pinChatMessage", { chat_id: env.ADMIN_GROUP_ID, message_id: card.message_id });
        await updUser(u.user_id, { user_info: { ...u.user_info, card_msg_id: card.message_id, join_date: date } }, env);
        return true;
    } catch (e) { return false; } 
}

// --- 5. 收件箱与黑名单 ---
async function handleInbox(env, msg, u, tid, uMeta) {
    let inboxId = await getCfg('unread_topic_id', env);
    if (!inboxId) {
        try {
            const t = await api(env.BOT_TOKEN, "createForumTopic", { chat_id: env.ADMIN_GROUP_ID, name: "🔔 未读消息" });
            inboxId = t.message_thread_id.toString();
            await setCfg('unread_topic_id', inboxId, env);
        } catch { return; }
    }

    const now = Date.now();
    if (CACHE.user_locks[`in_${u.user_id}`] && now - CACHE.user_locks[`in_${u.user_id}`] < 5000) return;
    if (now - (u.user_info.last_notify || 0) < 300000) return;
    CACHE.user_locks[`in_${u.user_id}`] = now;

    if (u.user_info.inbox_msg_id) await api(env.BOT_TOKEN, "deleteMessage", { chat_id: env.ADMIN_GROUP_ID, message_id: u.user_info.inbox_msg_id }).catch(()=>{});

    const gid = env.ADMIN_GROUP_ID.toString().replace(/^-100/, '');
    const preview = msg.text ? (msg.text.length > 20 ? msg.text.substring(0, 20)+"..." : msg.text) : "[媒体]";
    const card = `<b>🔔 新消息</b>\n${uMeta.card}\n📝 <b>预览:</b> ${escape(preview)}`;

    try {
        const nm = await api(env.BOT_TOKEN, "sendMessage", { chat_id: env.ADMIN_GROUP_ID, message_thread_id: inboxId, text: card, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🚀 直达回复", url: `https://t.me/c/${gid}/${tid}` }, { text: "✅ 已阅/删除", callback_data: `inbox:del:${u.user_id}` }]] } });
        await updUser(u.user_id, { user_info: { ...u.user_info, last_notify: now, inbox_msg_id: nm.message_id } }, env);
    } catch (e) { if(e.message.includes("thread")) await setCfg('unread_topic_id', "", env); }
}

async function manageBlacklist(env, u, tgUser, isBlocking) {
    let bid = await getCfg('blocked_topic_id', env);
    if (!bid && isBlocking) {
        try {
            const t = await api(env.BOT_TOKEN, "createForumTopic", { chat_id: env.ADMIN_GROUP_ID, name: "🚫 黑名单" });
            bid = t.message_thread_id.toString();
            await setCfg('blocked_topic_id', bid, env);
        } catch { return; }
    }
    if (!bid) return;

    if (isBlocking) {
        const meta = getUMeta(tgUser, u, Date.now()/1000);
        const msg = await api(env.BOT_TOKEN, "sendMessage", { 
            chat_id: env.ADMIN_GROUP_ID, message_thread_id: bid, text: `<b>🚫 用户已屏蔽</b>\n${meta.card}`, parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "✅ 解除屏蔽", callback_data: `unblock:${u.user_id}` }]] }
        });
        await updUser(u.user_id, { user_info: { ...u.user_info, blacklist_msg_id: msg.message_id } }, env);
    } else {
        if (u.user_info.blacklist_msg_id) {
            try {
                await api(env.BOT_TOKEN, "deleteMessage", { chat_id: env.ADMIN_GROUP_ID, message_id: u.user_info.blacklist_msg_id });
            } catch (e) { if(e.message.includes("thread")) await setCfg('blocked_topic_id', "", env); }
            await updUser(u.user_id, { user_info: { ...u.user_info, blacklist_msg_id: null } }, env);
        }
    }
}

async function handleBackup(msg, meta, env) {
    const bid = await getCfg('backup_group_id', env);
    if (!bid) return;
    try {
        if (msg.text) await api(env.BOT_TOKEN, "sendMessage", { chat_id: bid, text: `<b>📨 备份</b> ${meta.name} (${meta.userId})\n` + msg.text, parse_mode: "HTML" });
        else { await api(env.BOT_TOKEN, "sendMessage", { chat_id: bid, text: `<b>📨 备份</b> ${meta.name} (${meta.userId})`, parse_mode: "HTML" }); await api(env.BOT_TOKEN, "copyMessage", { chat_id: bid, from_chat_id: msg.chat.id, message_id: msg.message_id }); }
    } catch {}
}

async function handleAdminReply(msg, env) {
    if (!msg.message_thread_id || msg.from.is_bot || !(await isAuthAdmin(msg.from.id, env))) return;

    const stateStr = await getCfg(`admin_state:${msg.from.id}`, env);
    if (stateStr) {
        const state = JSON.parse(stateStr);
        if (state.action === 'input_note') {
            const targetUid = state.target;
            const u = await getUser(targetUid, env);
            u.user_info.note = msg.text;
            
            // [修复点] 防止数据库没有名字时导致名片显示为空白
            const mockTgUser = { 
                id: targetUid, 
                username: u.user_info.username || "", 
                first_name: u.user_info.name || "(未获取)", 
                last_name: "" 
            };
            const newMeta = getUMeta(mockTgUser, u, u.user_info.join_date || (Date.now()/1000));
            
            if (u.topic_id) {
                let updated = false;
                if (u.user_info.card_msg_id) try { await api(env.BOT_TOKEN, "editMessageText", { chat_id: env.ADMIN_GROUP_ID, message_id: u.user_info.card_msg_id, text: newMeta.card, parse_mode: "HTML", reply_markup: getBtns(targetUid, u.is_blocked) }); updated = true; } catch {}
                if (!updated) await sendInfoCardToTopic(env, u, mockTgUser, u.topic_id, u.user_info.join_date);
            }
            
            if (u.user_info.inbox_msg_id) {
                const gid = env.ADMIN_GROUP_ID.toString().replace(/^-100/, '');
                await api(env.BOT_TOKEN, "editMessageText", { chat_id: env.ADMIN_GROUP_ID, message_id: u.user_info.inbox_msg_id, text: `<b>🔔 新消息</b>\n${newMeta.card}\n📝 <b>备注更新</b>`, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🚀 直达回复", url: `https://t.me/c/${gid}/${u.topic_id}` }, { text: "✅ 已阅/删除", callback_data: `inbox:del:${targetUid}` }]] } }).catch(()=>{});
            }
            await updUser(targetUid, { user_info: u.user_info }, env);
            await setCfg(`admin_state:${msg.from.id}`, "", env);
            return api(env.BOT_TOKEN, "sendMessage", { chat_id: msg.chat.id, message_thread_id: msg.message_thread_id, text: `✅ 备注已更新` });
        }
    }

    const uid = (await sql(env, "SELECT user_id FROM users WHERE topic_id = ?", msg.message_thread_id.toString(), 'first'))?.user_id;
    if (!uid) return;
    try {
        await api(env.BOT_TOKEN, "copyMessage", { chat_id: uid, from_chat_id: msg.chat.id, message_id: msg.message_id });
        if (await getBool('enable_admin_receipt', env)) api(env.BOT_TOKEN, "sendMessage", { chat_id: msg.chat.id, message_thread_id: msg.message_thread_id, text: "✅ 已回复", reply_to_message_id: msg.message_id, disable_notification: true }).catch(()=>{});
    } catch (e) { api(env.BOT_TOKEN, "sendMessage", { chat_id: msg.chat.id, message_thread_id: msg.message_thread_id, text: "❌ 发送失败" }); }
}

async function handleEdit(msg, env) {
    const u = await getUser(msg.from.id.toString(), env);
    if (!u.topic_id) return;
    const old = await sql(env, "SELECT text FROM messages WHERE user_id=? AND message_id=?", [u.user_id, msg.message_id], 'first');
    const newTxt = msg.text || msg.caption || "[非文本]";
    await api(env.BOT_TOKEN, "sendMessage", { chat_id: env.ADMIN_GROUP_ID, message_thread_id: u.topic_id, text: `✏️ <b>消息修改</b>\n前: ${escape(old?.text||"?")}\n后: ${escape(newTxt)}`, parse_mode: "HTML" });
}

// --- 7. 验证 ---
async function handleVerifyPage(url, env) {
    const uid = url.searchParams.get('user_id');
    if (!uid || !env.TURNSTILE_SITE_KEY) return new Response("Miss Config", { status: 400 });
    return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://telegram.org/js/telegram-web-app.js"></script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><style>body{display:flex;justify-content:center;align-items:center;height:100vh;background:#fff;font-family:sans-serif}#c{text-align:center;padding:20px;background:#f0f0f0;border-radius:10px}</style></head><body><div id="c"><h3>🛡️ 安全验证</h3><div class="cf-turnstile" data-sitekey="${env.TURNSTILE_SITE_KEY}" data-callback="S"></div><div id="m"></div></div><script>const tg=window.Telegram.WebApp;tg.ready();function S(t){document.getElementById('m').innerText='验证中...';fetch('/submit_token',{method:'POST',body:JSON.stringify({token:t,userId:'${uid}'})}).then(r=>r.json()).then(d=>{if(d.success){document.getElementById('m').innerText='✅';setTimeout(()=>tg.close(),1000)}else{document.getElementById('m').innerText='❌'}})}</script></body></html>`, { headers: { "Content-Type": "text/html" } });
}
async function handleTokenSubmit(req, env) {
    try {
        const { token, userId } = await req.json();
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }) });
        if (!(await r.json()).success) throw new Error("Invalid");
        await updUser(userId, { user_state: "pending_verification" }, env);
        await api(env.BOT_TOKEN, "sendMessage", { chat_id: userId, text: "✅ 验证通过！\n请回答：\n" + await getCfg('verif_q', env) });
        return new Response(JSON.stringify({ success: true }));
    } catch { return new Response(JSON.stringify({ success: false }), { status: 400 }); }
}
async function verifyAnswer(id, ans, env) {
    if (ans.trim() === (await getCfg('verif_a', env)).trim()) {
        await updUser(id, { user_state: "verified" }, env);
        await api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: "✅ 验证通过！\n现在您可以直接发送消息，我会帮您转达给管理员。" });
    } else await api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: "❌ 错误" });
}

// --- 8. 菜单与回调 ---
async function handleCallback(cb, env) {
    const { data, message: msg, from } = cb;
    const [act, p1, p2, p3] = data.split(':');
    
    if (act === 'inbox' && p1 === 'del') {
        await api(env.BOT_TOKEN, "deleteMessage", { chat_id: msg.chat.id, message_id: msg.message_id }).catch(()=>{});
        if (p2) { const u = await getUser(p2, env); await updUser(p2, { user_info: { ...u.user_info, last_notify: 0 } }, env); }
        return api(env.BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id, text: "已处理" });
    }
    
    if (act === 'note' && p1 === 'set') {
        await setCfg(`admin_state:${from.id}`, JSON.stringify({ action: 'input_note', target: p2 }), env);
        return api(env.BOT_TOKEN, "sendMessage", { chat_id: msg.chat.id, message_thread_id: msg.message_thread_id, text: "⌨️ 请回复备注内容：" });
    }

    if (act === 'config') {
        if (!(env.ADMIN_IDS||"").includes(from.id.toString())) return api(env.BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id, text: "无权", show_alert: true });
        await api(env.BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id });
        return handleAdminConfig(msg.chat.id, msg.message_id, p1, p2, p3, env);
    }
    
    if (msg.chat.id.toString() === env.ADMIN_GROUP_ID) { 
        await api(env.BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id });
        if (act === 'pin_card') api(env.BOT_TOKEN, "pinChatMessage", { chat_id: msg.chat.id, message_id: msg.message_id });
        else if (['block','unblock'].includes(act)) {
            const isB = act === 'block';
            const uid = p1;
            const u = await getUser(uid, env);
            const bid = await getCfg('blocked_topic_id', env);
            
            if (!isB && msg.message_thread_id.toString() === bid) {
                await api(env.BOT_TOKEN, "deleteMessage", { chat_id: msg.chat.id, message_id: msg.message_id }).catch(()=>{});
            } else {
                api(env.BOT_TOKEN, "editMessageReplyMarkup", { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: getBtns(uid, isB) });
                api(env.BOT_TOKEN, "sendMessage", { chat_id: msg.chat.id, message_thread_id: msg.message_thread_id, text: isB ? "❌ 已屏蔽" : "✅ 已解封" });
            }
            await updUser(uid, { is_blocked: isB, block_count: 0 }, env);
            await manageBlacklist(env, u, { id: uid, username: u.user_info.username, first_name: u.user_info.name }, isB);
        }
    }
}

async function handleAdminConfig(cid, mid, type, key, val, env) {
    const render = (txt, kb) => api(env.BOT_TOKEN, mid?"editMessageText":"sendMessage", { chat_id: cid, message_id: mid, text: txt, parse_mode: "HTML", reply_markup: kb });
    const back = { text: "🔙 返回", callback_data: "config:menu" };
    
    try {
        if (!type || type === 'menu') { 
            if (!key) return render("⚙️ <b>控制面板</b>", { inline_keyboard: [[{text:"📝 基础",callback_data:"config:menu:base"},{text:"🤖 自动回复",callback_data:"config:menu:ar"}], [{text:"🚫 屏蔽词",callback_data:"config:menu:kw"},{text:"🛠 过滤",callback_data:"config:menu:fl"}], [{text:"👮 协管",callback_data:"config:menu:auth"},{text:"💾 备份/通知",callback_data:"config:menu:bak"}], [{text:"🌙 营业状态",callback_data:"config:menu:busy"}]] });
            if (key === 'base') return render(`基础配置`, { inline_keyboard: [[{text:"欢迎语",callback_data:"config:edit:welcome_msg"},{text:"问题",callback_data:"config:edit:verif_q"},{text:"答案",callback_data:"config:edit:verif_a"}], [back]] });
            if (key === 'fl') return render("🛠 <b>过滤设置</b>", await getFilterKB(env));
            if (['ar','kw','auth'].includes(key)) return render(`列表: ${key}`, await getListKB(key, env));
            if (key === 'bak') {
                const bid = await getCfg('backup_group_id', env), uid = await getCfg('unread_topic_id', env), blk = await getCfg('blocked_topic_id', env);
                return render(`💾 <b>备份与通知</b>\n备份群: ${bid||"无"}\n未读话题: ${uid?`✅ (${uid})`:"⏳"}\n黑名单话题: ${blk?`✅ (${blk})`:"⏳"}`, { inline_keyboard: [[{text:"设备份群",callback_data:"config:edit:backup_group_id"},{text:"清备份",callback_data:"config:cl:backup_group_id"}],[{text:"重置聚合话题",callback_data:"config:cl:unread_topic_id"},{text:"重置黑名单",callback_data:"config:cl:blocked_topic_id"}],[back]] });
            }
            if (key === 'busy') {
                const on = await getBool('busy_mode', env), msg = await getCfg('busy_msg', env);
                return render(`🌙 <b>营业状态</b>\n当前: ${on?"🔴 休息中":"🟢 营业中"}\n回复语: ${escape(msg)}`, { inline_keyboard: [[{text:`切换为 ${on?"🟢 营业":"🔴 休息"}`,callback_data:`config:toggle:busy_mode:${!on}`}], [{text:"✏️ 修改回复语",callback_data:"config:edit:busy_msg"}], [back]] });
            }
        }

        if (type === 'toggle') { await setCfg(key, val, env); return key==='busy_mode' ? handleAdminConfig(cid,mid,'menu','busy',null,env) : render("🛠 <b>过滤设置</b>", await getFilterKB(env)); }
        if (type === 'cl') { await setCfg(key, key==='authorized_admins'?'[]':'', env); return handleAdminConfig(cid, mid, 'menu', key==='unread_topic_id'||key==='blocked_topic_id'?'bak':(key==='authorized_admins'?'auth':'bak'), null, env); }
        if (type === 'del') { 
            let l = await getJsonCfg(key === 'kw' ? 'block_keywords' : 'keyword_responses', env);
            l = l.filter(i => (i.id||i).toString() !== val);
            await setCfg(key === 'kw' ? 'block_keywords' : 'keyword_responses', JSON.stringify(l), env);
            return render(`列表: ${key}`, await getListKB(key, env));
        }
        if (type === 'edit' || type === 'add') { 
            await setCfg(`admin_state:${cid}`, JSON.stringify({ action: 'input', key: key + (type==='add'?'_add':'') }), env);
            return api(env.BOT_TOKEN, "editMessageText", { chat_id: cid, message_id: mid, text: `请输入 ${key} 的值 (/cancel 取消):` });
        }
    } catch (e) { api(env.BOT_TOKEN, "answerCallbackQuery", { callback_query_id: mid, text: "Error", show_alert: true }); }
}

async function getFilterKB(env) {
    const s = async k => (await getBool(k, env)) ? "✅" : "❌";
    const b = (t, k, v) => ({ text: `${t} ${v}`, callback_data: `config:toggle:${k}:${v==="❌"}` });
    
    const keys = [
        'enable_admin_receipt', 'enable_forward_forwarding',
        'enable_image_forwarding', 'enable_audio_forwarding',
        'enable_sticker_forwarding', 'enable_link_forwarding',
        'enable_channel_forwarding', 'enable_text_forwarding'
    ];
    
    const vals = await Promise.all(keys.map(k => s(k)));
    
    return { inline_keyboard: [
        [b("回执", keys[0], vals[0]), b("转发", keys[1], vals[1])],
        [b("媒体", keys[2], vals[2]), b("语音", keys[3], vals[3])],
        [b("贴纸", keys[4], vals[4]), b("链接", keys[5], vals[5])],
        [b("频道", keys[6], vals[6]), b("文本", keys[7], vals[7])],
        [{ text: "🔙 返回", callback_data: "config:menu" }]
    ] };
}

async function getListKB(type, env) {
    const k = type==='ar'?'keyword_responses':(type==='kw'?'block_keywords':'authorized_admins');
    const l = await getJsonCfg(k, env);
    const btns = l.map((i, idx) => [{ text: `🗑 删除 ${idx+1}`, callback_data: `config:del:${type}:${i.id||i}` }]);
    btns.push([{ text: "➕ 添加", callback_data: `config:add:${type}` }], [{ text: "🔙 返回", callback_data: "config:menu" }]);
    return { inline_keyboard: btns };
}

async function handleAdminInput(id, txt, state, env) {
    if (txt === '/cancel') { await sql(env, "DELETE FROM config WHERE key=?", `admin_state:${id}`); return handleAdminConfig(id, null, 'menu', null, null, env); }
    let k = state.key, val = txt;
    try {
        if (k.endsWith('_add')) {
            k = k.replace('_add', ''); const realK = k==='ar'?'keyword_responses':(k==='kw'?'block_keywords':'authorized_admins');
            const list = await getJsonCfg(realK, env);
            if (k === 'ar') { const [kk, rr] = txt.split('==='); if(kk&&rr) list.push({keywords:kk, response:rr, id:Date.now()}); }
            else list.push(txt);
            val = JSON.stringify(list); k = realK;
        } else if (k === 'authorized_admins') val = JSON.stringify(txt.split(/[,，]/));
        
        await setCfg(k, val, env);
        await sql(env, "DELETE FROM config WHERE key=?", `admin_state:${id}`);
        await api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: `✅ ${k} 已更新:\n${val.substring(0,100)}` }); 
        await handleAdminConfig(id, null, 'menu', null, null, env);
    } catch (e) { api(env.BOT_TOKEN, "sendMessage", { chat_id: id, text: `❌ 失败: ${e.message}` }); }
}

// --- 7. 工具 ---
const getBool = async (k, e) => (await getCfg(k, e)) === 'true';
const getJsonCfg = async (k, e) => { try { return JSON.parse(await getCfg(k, e))||[]; } catch { return []; } };
const escape = t => (t||"").toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const getBtns = (id, blk) => ({ inline_keyboard: [[{ text: blk?"✅ 解封":"🚫 屏蔽", callback_data: `${blk?'unblock':'block'}:${id}` }], [{ text: "✏️ 备注", callback_data: `note:set:${id}` }, { text: "📌 置顶", callback_data: `pin_card:${id}` }]] });
const isAuthAdmin = async (id, e) => (e.ADMIN_IDS||"").includes(id) || (await getJsonCfg('authorized_admins', e)).includes(id.toString());
const getUMeta = (tgUser, dbUser, d) => {
    const id = tgUser.id.toString(), name = (tgUser.first_name||"")+(tgUser.last_name?" "+tgUser.last_name:"");
    const note = dbUser.user_info && dbUser.user_info.note ? `\n📝 <b>备注:</b> ${escape(dbUser.user_info.note)}` : "";
    const userLink = tgUser.username ? `<a href="tg://user?id=${id}">@${tgUser.username}</a>` : `<code>无</code>`;
    return { userId: id, name, username: tgUser.username, topicName: `${name} | ${id}`.substr(0, 128), card: `<b>👤 用户资料</b>\n---\n👤: <code>${escape(name)}</code>\n🔗: ${userLink}\n🆔: <code>${id}</code>${note}\n🕒: <code>${new Date(d*1000).toLocaleString('zh-CN')}</code>` };
};
