// 营养科普AI助手后端API
// 前端调用方式：
// URL: /api/nutrition-knowledge-ai
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
// { "answer": "模型生成的营养科普回答（Markdown格式）" }

// 配置Node.js运行时
export const config = { runtime: 'nodejs' };

// DeepSeek API配置
const DS_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

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

    // 构造系统提示 - 纯对话型，明确要求Markdown格式
    const systemMessage = {
      role: 'system',
      content: '你是营养学与健康饮食科普助手，用自然、易懂的中文回答用户问题。\n\n要求：\n- 使用Markdown格式：一个总标题 + 几个小标题 + 列表项\n- 不要输出JSON，不要输出代码块，只输出Markdown文字\n- 每次回答控制在约300～500字以内\n- 回答结构：\n  # 主题概览（大标题）\n  一句话总结本次回答的核心观点。\n  \n  ## 一、主要功效 / 作用（小标题）\n  - 功效1：一段简短说明  \n  - 功效2：一段简短说明  \n  - 功效3：一段简短说明  \n  \n  ## 二、适合人群（小标题）\n  - 人群1：说明  \n  - 人群2：说明  \n  \n  ## 三、注意事项（小标题）\n  - 注意点1  \n  - 注意点2  \n  \n  ## 四、常见来源（小标题）\n  - 来源1  \n  - 来源2\n\n重要限制：\n- 仅提供营养与健康饮食的科普知识\n- 不提供医疗诊断、治疗方案或用药建议\n- 若用户问题超出营养科普范围，请礼貌拒绝\n- 内容必须准确，避免误导\n- 保持回答简洁明了，避免大段文字堆叠'
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

    // 构建用户消息
    const userMessage = {
      role: 'user',
      content: input
    };
    
    // 添加用户消息到messages数组
    messages.push(userMessage);

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
        temperature: 0.3
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
    
    // 直接返回内容，不做JSON解析
    const trimmedContent = content.trim();

    // 返回纯文本回答
    return res.status(200).json({
      answer: trimmedContent
    });

  } catch (error) {
    console.error('营养科普AI处理错误:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'AI处理请求时发生错误'
    });
  }
}