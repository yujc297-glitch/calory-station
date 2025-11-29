// 菜谱推荐AI助手后端API（优化版）
// 前端调用方式：
// URL: /api/recipe-planner-ai
// 方法: POST
// 请求体示例:
// {
//   "message": "用户的菜谱需求",
//   "history": [
//     { "role": "user", "content": "上一轮提问" },
//     { "role": "assistant", "content": "上一轮回答" }
//   ]
// }
// 响应示例:
// { "answer": "模型生成的菜谱推荐JSON" }

// 配置Node.js运行时
export const config = { runtime: 'nodejs' };

// DeepSeek API配置 - 放在handler外部，避免重复初始化
const DS_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat'; // 使用较快的模型

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
    const apiKey = process.env.DEEPSEEK_API_KEY2;
    if (!apiKey) {
      return res.status(500).json({ error: 'NO_API_KEY' });
    }

    // 构造精简的系统提示
    const systemMessage = {
      role: 'system',
      content: '你是菜谱规划助手，根据用户需求生成一日三餐加加餐的营养菜谱。严格按JSON格式返回，包含名称、简介、食材、步骤和热量。'
    };

    // 构造messages数组（移除历史消息处理，加快响应）
    const messages = [systemMessage, {
      role: 'user',
      content: input
    }];

    // 调用DeepSeek API - 使用更快的配置
    const resp = await fetch(DS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.4, // 稍微提高temperature增加多样性
        max_tokens: 768  // 减少max_tokens加快响应速度
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
        answer: '暂无推荐，请稍后再试。' // 简化错误提示
      });
    }

  } catch (err) {
    // 捕获所有异常
    console.error('[recipe-planner-ai] Error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      detail: err?.message || String(err)
    });
  }
}