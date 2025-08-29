import Cfg from '../model/Cfg.js'
import OpenAI from '../model/openai.js'
import {
  recall
} from '../model/utils.js'

const KEY_PREFIX = 'chat-plugin:chatHistory:'
const EIGHT_HOURS_IN_SECONDS = 8 * 60 * 60

// 总结类
export default class summarize extends plugin {
  constructor() {
    super({
      name: 'Summarize',
      dsc: '总结最近的聊天记录',
      priority: 1145,
      rule: [{
          reg: '^#(省流|总结)$',
          fnc: 'summarizeChat'
        },
        {
          reg: '^#查看聊天记录$',
          fnc: 'viewChatHistory',
          permission: 'master'
        }
      ]
    })
  }

  // 处理省流命令
  async summarizeChat(e) {
    if(e.isGroup) {
      recall(e, await e.reply('正在努力总结中，请稍后'), 30)
      this.processChatHistory(e)
    }
    else {
      e.reply('请在群聊中使用此命令😄')
      return true
    }
  }

  // 处理查看聊天记录命令
  async viewChatHistory(e) {
    if (!e.isGroup) {
      e.reply('请在群聊中使用此命令😄')
      return true
    }
    const chatHistory = await this.getRecentMessages(e.group_id, 'group')
    e.reply(`在过去的8小时内，群聊中共有 ${chatHistory.length} 条记录~\n`)
    e.reply(chatHistory.map(msg => `- ${msg.content}`).join('\n'))
    e.reply('以上是最近的聊天记录')

    return true
  }

  // 处理聊天记录
  async processChatHistory(e) {
    try {
      const promptMessages = this.buildPromptMessages(e)
      const chatHistory = await this.getRecentMessages(e.group_id, 'group')
      const messages = []

      if (!chatHistory || chatHistory.length === 0) {
        await e.reply('在过去的8小时内没有找到聊天记录。')
        return true
      }

      messages.push(...promptMessages)
      messages.push(...chatHistory)
      const summary = await this.getChatSummary(e, messages)
      const replyMsg = `${summary}`

      await e.reply(replyMsg)
    } catch (error) {
      logger.error('总结聊天记录时出错:', error)
      await e.reply('处理时发生错误，请查看后台日志。')
    }

    return true
  }

  /**
   * 从Redis获取并过滤最近的聊天记录 (从 Sorted Set 获取)
   * @param {string} id 群号或用户ID
   * @param {'group' | 'private'} type 对话类型
   * @returns {Promise<Array<object>>} 消息对象数组
   */
  async getRecentMessages (id, type = 'group') {
    const key = `${KEY_PREFIX}${type}:${id}`
    
    // 从 Sorted Set 中按分数（时间戳）从低到高获取所有记录
    // ZRANGE key min max
    // zRange返回的是一个数组
    const rawMessages = await redis.zRange(key, 0, -1)

    if (!rawMessages || rawMessages.length === 0) {
      return []
    }

    const processHistory = []
    for (const rawMsg of rawMessages) {
      try {
        const message = JSON.parse(rawMsg)
        // 转换为聊天记录的格式
        processHistory.push(
          `(${message.time})${message.nickname}: ${message.msg}\n`
        )
      } catch (error) {
        logger.warn('解析Redis中的聊天记录失败:', error)
      }
    }

    const validMessages = []
    validMessages.push({
      role: 'user',
      content: `${processHistory}`
    })
    
    // console.log(validMessages) 调试信息
    return validMessages
  }

  // 构建提示消息，添加系统提示词
  buildPromptMessages(e) {
    let messages = []
    const systemPrompt = Cfg.get('summaryPrompt', '', e)

    if (systemPrompt) {
    messages.push({
      role: 'system',
      content: `${systemPrompt}`
    })
    } else {
      throw new Error('未找到系统提示词，请检查cfg_default.json')
    }

    return messages
  }

  // 将构建好的信息发送到大模型，并返回总结消息
  async getChatSummary(e, messages) {
    const requestOptions = {
      messages: messages,
      model: Cfg.get('model', 'gpt-3.5-turbo', e),
      temperature: Cfg.get('summaryTemperature', 0.3, e),
      max_tokens: Cfg.get('summaryMaxTokens', 1024, e)
    }

    if (!requestOptions.model || !requestOptions.messages || requestOptions.messages.length === 0) {
      throw new Error('请求参数获取不完整, 请检查cfg_default.json')
    }

    const response = await OpenAI.chat(requestOptions)

    return response
  }
}