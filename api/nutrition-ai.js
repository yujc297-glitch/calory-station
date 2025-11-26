// 营养科普AI助手后端API
// 前端调用方式：
// URL: /api/nutrition-ai
// 方法: POST
// 请求体示例:
// {
//   "message": "用户的问题",
//   "history": [
//     { "role": "user", "content": "上一轮提问" },
//     { "role": "assistant", "content": "上一轮回答" }
//   ]
// }
// 响应示例:
// { "answer": "模型生成的营养科普回答" }

// 配置Node.js运行时
export const config = { runtime: 'nodejs' };

// DeepSeek API配置
const DS_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

// 默认导出的处理函数
export default async function handler(req, res) {
  try {
    // 只允许POST方法
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    // 解析请求体
    const { message, history = [] } = req.body || {};
    
    // 验证消息内容
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'NO_TEXT' });
    }
    
    // 限制消息长度
    const input = String(message).slice(0, 2000);

    // 读取API密钥
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'NO_API_KEY' });
    }

    // 构造系统提示
    const systemMessage = {
      role: 'system',
      content: '你是一个专业的营养与饮食科普助手，擅长解释食物中的营养成分、宏量/微量营养素、膳食结构和中国居民膳食指南相关内容。你只提供一般性的营养科普建议，不提供医疗诊断或用药指导，遇到疾病相关问题要提醒用户咨询医生。'
    };

    // 构造messages数组
    const messages = [systemMessage];
    
    // 处理历史消息
    if (Array.isArray(history)) {
      history.forEach(item => {
        // 只接受有效的历史记录
        if (item && 
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string') {
          messages.push({
            role: item.role,
            content: item.content.slice(0, 1000) // 限制历史消息长度
          });
        }
      });
    }

    // 添加当前用户问题
    messages.push({
      role: 'user',
      content: input
    });

    // 调用DeepSeek API
    const resp = await fetch(DS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2
      })
    });

    // 检查响应状态
    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(502).json({
        error: 'LLM_UPSTREAM_ERROR',
        detail: errText
      });
    }

    // 解析API响应
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const trimmedContent = content.trim();

    // 返回结果
    if (trimmedContent) {
      return res.status(200).json({ answer: trimmedContent });
    } else {
      return res.status(200).json({ 
        answer: '抱歉，这次没有生成有效回答，请稍后再试。' 
      });
    }

  } catch (err) {
    // 捕获所有异常
    console.error('Nutrition AI API Error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      detail: err?.message || String(err)
    });
  }
}