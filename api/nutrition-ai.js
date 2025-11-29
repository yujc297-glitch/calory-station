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
      content: '你是营养学计算助手，根据菜品名称 + 重量（克）估算营养。请严格遵循以下规则：\n\n1. 严格参考常见食物成分表的数量级，不要随意夸大；\n2. 对「没有这个营养素」的情况处理：\n   - 假如菜品由一个或几个常见单一食材组成，请基于这些食材的成分表判断\n   - 若常识告诉你某营养素含量极低/几乎没有（如普通炒蛋的膳食纤维、白糖的蛋白质、纯植物油的矿物质），请直接填0\n   - 不要为了"看起来好看"随便给出5mg/10mg之类的虚构值\n   - 对于纯油脂类食物（如橄榄油、菜籽油），碳水、蛋白质、膳食纤维、大部分矿物质都应为0\n   - 对于纯碳水类食物（如白糖、淀粉），蛋白质、脂肪、膳食纤维、大部分矿物质都应为0\n   - 对于几乎不含某类营养素的食物，请直接返回0，不要使用"very_low"等模糊描述\n3. 特别是矿物质（如钙、铁、镁、锌等）：\n   - 普通家常菜每份（100–300g）通常不会超过几百毫克；\n   - 除非是明显极咸食物，否则钠也不应超过 ~2000 mg/份；\n   - 若你不确定某矿物质是否存在，请返回 0 而不是编造；\n4. 输出必须是严格 JSON，数值单位统一为「一整份菜品」的总摄入量，而不是每100g。\n5. 如果食材非常单一（例如"白砂糖 10g""纯菜籽油 20g"），请根据专业知识直接把不含的营养素设为 0。'
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

    // 判断是否为营养计算请求（包含菜品名称和重量关键词）
    const isNutritionCalculation = /菜品名称|摄入重量|克|估算营养/.test(input);
    
    // 构建用户消息，针对营养计算请求提供更规范的格式
    let userMessage;
    if (isNutritionCalculation) {
      // 对于营养计算请求，添加更明确的格式要求
      userMessage = {
        role: 'user',
        content: input + `\n\n请按照以下固定JSON格式返回结果，确保包含所有字段：\n{
  "name": "菜品名称",
  "grams": 重量,
  "calories": 热量,
  "carb": 碳水化合物,
  "protein": 蛋白质,
  "fat": 脂肪,
  "fiber": 膳食纤维,
  "minerals": {
    "calcium": 钙含量,
    "iron": 铁含量,
    "magnesium": 镁含量,
    "potassium": 钾含量,
    "sodium": 钠含量
  },
  "vitamins": {
    "vitaminA": 维生素A含量,
    "vitaminC": 维生素C含量,
    "vitaminB1": 维生素B1含量,
    "vitaminB2": 维生素B2含量,
    "vitaminB6": 维生素B6含量
  }
}\n\n重要说明：
- 若某营养素基本为0或不确定，请填0；
- 不得返回示例值、不得使用占位符；
- 所有数值单位：热量kcal，碳水/蛋白质/脂肪/膳食纤维g，矿物质/维生素mg；
- 必须返回完整且有效的JSON格式。`
      };
    } else {
      // 普通营养科普请求
      userMessage = {
        role: 'user',
        content: input
      };
    }
    
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
    let trimmedContent = content.trim();

    // 定义矿物质上限常量
    const MAX_MINERAL = {
      calcium: 1500,  // mg
      iron: 50,       // mg
      magnesium: 800, // mg
      potassium: 4000,// mg
      sodium: 3000    // mg
    };
    
    // 定义维生素上限常量
    const MAX_VITAMIN = {
      vitaminA: 3000, // mg
      vitaminC: 2000, // mg
      vitaminB1: 50,  // mg
      vitaminB2: 50,  // mg
      vitaminB6: 50   // mg
    };
    
    // 后处理逻辑 - 仅对营养计算请求进行处理
    if (isNutritionCalculation) {
      try {
        // 尝试提取JSON部分（可能包含在代码块中）
        let jsonStr = trimmedContent;
        if (jsonStr.includes('```json')) {
          jsonStr = jsonStr.match(/```json([\s\S]*?)```/)?.[1] || jsonStr;
        } else if (jsonStr.includes('{')) {
          // 提取JSON部分
          const start = jsonStr.indexOf('{');
          const end = jsonStr.lastIndexOf('}') + 1;
          if (start !== -1 && end !== 0) {
            jsonStr = jsonStr.substring(start, end);
          }
        }
        
        // 尝试解析JSON
        let nutritionData = JSON.parse(jsonStr);
        
        // 处理宏量营养素
        const macroNutrients = ['calories', 'carb', 'protein', 'fat', 'fiber'];
        macroNutrients.forEach(key => {
          if (nutritionData.hasOwnProperty(key)) {
            let value = nutritionData[key];
            // 转换为数字
            if (typeof value === 'string') {
              // 处理'very_low'或类似字符串
              if (value.toLowerCase().includes('low') || value.toLowerCase().includes('无')) {
                value = 0;
              } else {
                value = Number(value) || 0;
              }
            } else if (typeof value !== 'number') {
              value = 0;
            }
            // 确保非负
            nutritionData[key] = Math.max(0, value);
          } else {
            // 确保所有必要字段都存在
            nutritionData[key] = 0;
          }
        });
        
        // 处理矿物质
        if (!nutritionData.minerals) {
          nutritionData.minerals = {};
        }
        
        Object.keys(MAX_MINERAL).forEach(key => {
          let value = nutritionData.minerals[key];
          // 转换为数字
          if (typeof value === 'string') {
            if (value.toLowerCase().includes('low') || value.toLowerCase().includes('无')) {
              value = 0;
            } else {
              value = Number(value) || 0;
            }
          } else if (typeof value !== 'number') {
            value = 0;
          }
          // 确保非负并应用上限
          value = Math.max(0, value);
          nutritionData.minerals[key] = Math.min(value, MAX_MINERAL[key]);
        });
        
        // 处理维生素
        if (!nutritionData.vitamins) {
          nutritionData.vitamins = {};
        }
        
        Object.keys(MAX_VITAMIN).forEach(key => {
          let value = nutritionData.vitamins[key];
          // 转换为数字
          if (typeof value === 'string') {
            if (value.toLowerCase().includes('low') || value.toLowerCase().includes('无')) {
              value = 0;
            } else {
              value = Number(value) || 0;
            }
          } else if (typeof value !== 'number') {
            value = 0;
          }
          // 确保非负并应用上限
          value = Math.max(0, value);
          nutritionData.vitamins[key] = Math.min(value, MAX_VITAMIN[key]);
        });
        
        // 确保名称和重量字段存在
        if (!nutritionData.name) {
          nutritionData.name = '';
        }
        if (!nutritionData.grams) {
          nutritionData.grams = 0;
        }
        
        // 将处理后的数据转换回字符串
        trimmedContent = JSON.stringify(nutritionData);
        
      } catch (parseError) {
        // 如果解析或处理失败，保留原始内容但记录错误
        console.error('Nutrition data processing error:', parseError);
        // 不抛出错误，让前端处理可能的格式问题
      }
    }

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