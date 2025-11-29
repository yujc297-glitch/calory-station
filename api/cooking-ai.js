// 烹饪助手AI后端API
// 前端调用方式：
// URL: /api/cooking-ai
// 方法: POST
// 请求体示例:
// {
//   "ingredients": [{"name": "鸡蛋", "weight": 100}, {"name": "番茄", "weight": 200}],
//   "cuisine": "中餐",
//   "taste": "清淡",
//   "dietType": "健康饮食"
// }
// 响应示例:
// { "recipes": [{"name": "番茄炒蛋", "summary": "...", "ingredients": [...], "steps": [...]}] }

// 配置Node.js运行时
export const config = { runtime: 'nodejs' };

// DeepSeek API配置
const DS_URL = 'https://api.deepseek.com/v1/chat/completions';
// 使用较快的模型
const MODEL = 'deepseek-chat';

// 默认导出的处理函数
export default async function handler(req, res) {
  try {
    // 只允许POST方法
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    // 解析请求体
    const { ingredients, cuisine = '中餐', taste = '清淡', dietType = '健康饮食' } = req.body || {};
    
    // 验证必要参数
    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'NO_INGREDIENTS' });
    }
    
    // 格式化食材列表
    const formattedIngredients = ingredients.map(item => 
      `${item.name}${item.weight ? ` (${item.weight}g)` : ''}`
    ).join('、');

    // 读取API密钥
    const apiKey = process.env.DEEPSEEK_API_KEY2 || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'NO_API_KEY' });
    }

    // 构造精简的系统提示
    const systemMessage = {
      role: 'system',
      content: '你是一位烹饪专家，根据用户提供的食材和偏好快速生成营养均衡的菜谱。请直接返回JSON格式，包含name、summary、ingredients、steps字段。每个菜谱必须使用用户提供的所有食材。'
    };

    // 构造用户提示
    const userPrompt = {
      role: 'user',
      content: `基于以下条件生成3个菜谱：
- 食材：${formattedIngredients}
- 菜系：${cuisine}
- 口味：${taste}
- 饮食类型：${dietType}

请返回JSON格式：{"recipes":[{"name":"菜名","summary":"简介","ingredients":["食材1","食材2"],"steps":["步骤1","步骤2"]}]}`
    };

    // 调用DeepSeek API
    const resp = await fetch(DS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [systemMessage, userPrompt],
        temperature: 0.5, // 降低temperature使生成更稳定
        max_tokens: 512,  // 限制最大token数以加快响应
        response_format: {
          type: "json_object"
        }
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
    
    // 处理返回的JSON数据
    let parsedData;
    try {
      parsedData = JSON.parse(content);
      // 验证数据格式
      if (!parsedData.recipes || !Array.isArray(parsedData.recipes)) {
        throw new Error('Invalid recipes format');
      }
    } catch (e) {
      // 如果解析失败，返回简化的模拟数据
      console.error('JSON解析失败:', e);
      parsedData = {
        recipes: [
          {
            name: '简易炒时蔬',
            summary: '快速简单的家常炒菜',
            ingredients: formattedIngredients.split('、'),
            steps: ['准备并清洗所有食材', '热锅加油', '按顺序加入食材翻炒', '加入调味料', '炒至熟透即可']
          }
        ]
      };
    }

    // 返回结果（直接返回recipes数组）
    return res.status(200).json({
      recipes: parsedData.recipes || []
    });

  } catch (err) {
    // 捕获所有异常
    console.error('Cooking AI API Error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      detail: err?.message || String(err)
    });
  }
}