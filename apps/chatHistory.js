import plugin from '../../../lib/plugins/plugin.js'
import Cfg from '../model/Cfg.js'

// Redis 键的前缀
const SUMMARY_KEY_PREFIX = 'chat-plugin:chatHistory:'
// 每个对话列表的最大长度，防止内存滥用
const MAX_LIST_LENGTH = Cfg.get('maxChatHistoryLength', 500)
// 消息过期时间（秒）
const MSG_EXPIRE_SECONDS = Cfg.get('chatHistoryExpireTime', 8 * 60 * 60)

export class chatHistory extends plugin {
  constructor () {
    super({
      name: '聊天记录存储',
      dsc: '使用Redis存储最近的聊天记录',
      event: 'message',
      priority: 99999, // 确保它在其他插件之后执行，以便捕获 e.bot
      rule: [
        {
          reg: '.*',
          fnc: 'logUserMessage',
          log: false
        },
        {
          reg: '^#清除全部聊天记录$',
          des: "清除本地记录的所有群聊的聊天记录",
          fnc: 'clearAllChatHistory',
          permission: 'master'
        },
        {
          reg: '^#清除聊天记录$',
          des: '清除本地记录的当前群聊的聊天记录',
          fnc: 'clearChatHistory',
          permission: 'master'
        }
      ]
    })
  }

  /**
   * 记录用户发送的群聊消息，并在此捕获真正的 Bot 实例
   */
  async logUserMessage (e) {
    if (!e.isGroup || !e.raw_message || e.raw_message.startsWith('#') || e.raw_message.startsWith('/')) {
      return false
    }

    const messageData = {
      user_id: e.user_id,
      nickname: e.sender?.card || e.sender?.nickname || '匿名用户',
      msg: this.rebuildMessageFromSegments(e),
      time: e.time
    }

    if (typeof messageData.time !== 'number' || !messageData.msg) return false
    await saveMessageToRedis(e, messageData, SUMMARY_KEY_PREFIX)
    return false
  }

  /**
   * 记录机器人自身发送的群聊消息  // 暂时无用，保存bot消息的功能复合在chat.js中了
   * @param {object} context 包含 group_id 和真实 bot 实例的上下文
   * @param {object|string} botMsg 机器人发送的消息
   */
  async logBotMessage (context, botMsg) {
    const { group_id, bot } = context
    if (!group_id || !botMsg || !bot) return

    let msgText = this.extractTextFromMessage(botMsg)
    if (!msgText) return

    const botMemberInfo = bot.gml?.get(group_id)?.get(bot.uin)
    const botNickname = botMemberInfo?.card || bot.nickname || 'Bot'

    const messageData = {
      user_id: bot.uin,
      nickname: botNickname,
      msg: msgText,
      time: Math.floor(Date.now() / 1000)
    }
    await saveMessageToRedis({ group_id }, messageData, SUMMARY_KEY_PREFIX)
  }

  /**
   * 从 e.message 数组中重建包含 @ 和图片等信息的完整消息字符串
   */
  rebuildMessageFromSegments (e) {
    if (!e.message || e.message.length === 0) return e.raw_message || ''
    let rebuiltMsg = ''
    for (const segment of e.message) {
      if (segment.type === 'at') {
        if (segment.text) rebuiltMsg += segment.text
        else rebuiltMsg += `${segment.name || segment.qq}`
      } else if (segment.type === 'text') {
        rebuiltMsg += segment.text
      } else if (segment.type === 'image') {
        rebuiltMsg += '[图片]'
      }
    }
    return rebuiltMsg.trim()
  }

  /**
   * 从Yunzai的消息体中提取纯文本
   */
  extractTextFromMessage (msg) {
    if (typeof msg === 'string') return msg.trim()
    if (Array.isArray(msg)) {
      return msg.map(segment => {
        if (segment.type === 'text') return segment.text
        if (segment.type === 'at') return `${segment.name || segment.qq}`
        if (segment.type === 'image') return '[图片]'
        return ''
      }).join('').trim()
    }
    if (typeof msg === 'object' && msg.type === 'text') return msg.text.trim()
    if (typeof msg === 'object' && msg.type) return `[${msg.type}消息]`
    return ''
  }

  /**
   * 清除所有聊天记录
   */
  async clearAllChatHistory (e) {
    await e.reply('正在查找并清除所有聊天记录缓存，请稍候...')
    try {
      const keys = await redis.keys(`${SUMMARY_KEY_PREFIX}group:*`)
      if (!keys || keys.length === 0) {
        await e.reply('未找到任何群聊聊天记录的缓存，无需清除。')
        return true
      }
      const deletedCount = await redis.del(keys)
      const replyMsg = `✅ 操作成功！\n共找到 ${keys.length} 个群聊相关键，已成功删除 ${deletedCount} 个。`
      await e.reply(replyMsg)
      logger.mark(`[聊天记录插件] 主人 (${e.user_id}) 执行了清除操作，删除了 ${deletedCount} 个键。`)
    } catch (error) {
      logger.error('清除省流记录时出错:', error)
      await e.reply('清除过程中发生错误，请查看后台日志获取详细信息。')
    }
    return true
  }

  /**
   * 清除本群聊天记录
   */
  async clearChatHistory (e) {
    await e.reply('正在清除本群的聊天记录缓存，请稍候...')
    try {
      const key = `${SUMMARY_KEY_PREFIX}group:${e.group_id}`
      await redis.del(key)
      await e.reply('本群的聊天记录缓存已成功清除。')
    } catch (error) {
      logger.error('清除聊天记录时出错:', error)
      await e.reply('清除过程中发生错误，请查看后台日志获取详细信息。')
    }
    return true
  }
}

/**
 * 将消息数据保存到 Redis 的通用函数
 * 在chat.js中也会调用这个函数 
 */
export async function saveMessageToRedis (e, messageData, SUMMARY_KEY_PREFIX) {
  if (!e.group_id) return
  const key = `${SUMMARY_KEY_PREFIX}group:${e.group_id}`
  try {
    const value = JSON.stringify(messageData)
    const score = messageData.time
    if (typeof score !== 'number') return
    await redis.zAdd(key, { score, value })
    const eightHoursAgo = Math.floor(Date.now() / 1000) - MSG_EXPIRE_SECONDS
    await redis.zRemRangeByScore(key, 0, eightHoursAgo)
    const count = await redis.zCard(key)
    if (count > MAX_LIST_LENGTH) {
      await redis.zRemRangeByRank(key, 0, count - MAX_LIST_LENGTH - 1)
    }
    await redis.expire(key, 24 * 60 * 60)
  } catch (error) {
    logger.error('存储聊天记录到Redis时出错:', error)
  }
}