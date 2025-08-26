import Cfg from '../model/Cfg.js'
import OpenAI from '../model/openai.js'
import {
  pluginName
} from '../config/constant.js'

// 用于撤回消息
const recall = async (e, promise, time) => {
  const res = await promise
  if (!res.message_id || !time) return
  if (e.group?.recallMsg)
    setTimeout(() =>
      e.group.recallMsg(res.message_id), time * 1000) 
  else if (e.friend?.recallMsg)
    setTimeout(() =>
      e.friend.recallMsg(res.message_id), time * 1000)
}

// 用于延迟
const sleep = async (time) => {
  return new Promise(e => setTimeout(e, time))
}

// 总结类
export default class summarize extends plugin {
  constructor(e) {
    super({
      name: 'Summarize',
      priority: 1919810,
      rule: [{
          reg: '^#(省流|总结)$',
          fnc: 'summarize'
        },
      ]
    })
    this.e = e
    this.redisKeyPrefix = `${pluginName}:summarize:`
  }

  // 处理省流命令
  async summarize(e) {
    if(e.isGroup) {
      this.processChatHistory(e)
    }
    else {
      e.reply('请在群聊中使用此命令😄')
    }
  }

  // 处理聊天记录
  async processChatHistory(e) {
    e.reply('正在努力总结中，请稍候...', true) // true 表示会引用用户消息
    try {
      // 获取总结系统提示词
      const prompt = Cfg.get('summaryPrompt', '', e)
      let messages = [{
        role: 'system',
        content: prompt
      }]

      // 获取聊天记录
      const chatHistory = await this.getChatHistory(e)
      console.log(chatHistory)

      if (chatHistory.length === 0) {
        e.reply('没有最近的聊天记录可以总结哦~')
        return true
      }
      messages = messages.concat(chatHistory)

      // 构造请求信息
      const requestOptions = {
        messages: messages,
        model: Cfg.get('model', 'gpt-3.5-turbo', e),
        temperature: Cfg.get('temperature', 0.7, e),
        max_tokens: Cfg.get('maxTokens', 1000, e)
      }

      const response = await OpenAI.chat(requestOptions)

      if (!response) {
        e.reply('AI 响应失败，请稍后再试')
        return false
      }

      e.reply(`省流小助手总结如下：\n\n${response.trim()}`)

    } catch (error) {
      logger.error(`[${pluginName}] 聊天处理错误 省流(模式): ${error.message || error}`)
      e.reply(`处理失败: ${error.message || '未知错误'}`)

      return false
    }
  }

  // 获取聊天记录
  async getChatHistory(e) {
    const summaryHistoryCount = Cfg.get('summaryHistoryCount', 50, e)
    let history = []

    if (summaryHistoryCount <= 0) {
      return history
    }

    try {
      let rawHistory = []
      const fetchCount = Math.min(summaryHistoryCount + 10, 100)
      rawHistory = await e.group.getChatHistory(0, fetchCount)  // null 或 0 代表从最新的消息往前追溯
   
      history = rawHistory
        .map(msg => this.formatHistoryMessage(e, msg))
        .filter(Boolean)
        .slice(-summaryHistoryCount)
    } catch (error) {
      logger.error(`[${pluginName}] 获取聊天记录失败: ${error.message || error}`)
    }

    return history
  }
  
  // 格式化聊天记录
  formatHistoryMessage(e, msg) {
    // 忽略非文本、空消息或命令消息
    if (!msg || !msg.message || typeof msg.raw_message !== 'string' || !msg.raw_message.trim()) {
      return null
    }

    const isBot = msg.user_id == e.self_id
    let role = isBot ? 'assistant' : 'user'
    let senderPrefix = ''
    let content = msg.raw_message.trim()
    // 过滤机器人自己发的提示性信息
    if (isBot && (content.includes('正在努力总结中') || content.includes('省流小助手总结如下：') || content.includes('没有最近的聊天记录'))) {
      return null
    }

    if (role === 'user' && content) {
      senderPrefix = `${msg.sender.card || msg.sender.nickname}: `
      }

    if (role === 'assistant' && content.startsWith(`${Cfg.get('aiName', 'AI助手', e)}: `)) {
      content = content.substring(`${Cfg.get('aiName', 'AI助手', e)}: `.length).trim()
    }

    if (!content) return null

    return {
      role: role,
      content: `${senderPrefix}${content}`
    }
  }
}