import cv2
import streamlit as st
from ultralytics import YOLOWorld
import numpy as np
import serial
import serial.tools.list_ports
import time
import re
import webbrowser
import urllib.parse

# ==========================================
# 页面配置
# ==========================================
st.set_page_config(
    page_title="AI 智能电子秤 Calorie Station",
    page_icon="⚖️",
    layout="wide"
)

# 初始化session_state标记，用于控制自动跳转只执行一次
if "detail_opened" not in st.session_state:
    st.session_state["detail_opened"] = False

# 食物名称映射
FOOD_NAME_MAP = {
    "bell pepper": "辣椒",
    "mushroom": "蘑菇",
    "mush": "蘑菇",
    "banana": "香蕉",
    "tomato": "西红柿",
}

# 自定义 CSS 样式
st.markdown("""
    <style>
    /* 侧边栏样式 - 设置为浅灰色 */
    [data-testid="stSidebar"] {
        background-color: #f8f9fa;
    }
    
    /* 主内容区域 - 设置为白色背景 */
    .css-18e3th9 { 
        background-color: #ffffff; 
    }
    .main { 
        background-color: #ffffff; 
    }
    .stApp > header { 
        background-color: transparent; 
    }
    
    /* 仪表盘卡片样式 - 确保白色卡片 */
    .metric-card {
        border-radius: 12px;
        border: 1px solid #e0f2f1;
        background: #ffffff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.03);
        padding: 16px 20px;
        text-align: center;
        margin-bottom: 20px;
    }
    
    /* 文本样式 */
    .weight-text {
        font-size: 3em;
        font-weight: bold;
        color: #2c3e50;
    }
    .unit-text {
        font-size: 1.5em;
        color: #7f8c8d;
    }
    
    /* 按钮样式 - 使用绿色主题 */
    .primary-btn {
        background-color: #2e7d32;
        color: #fff;
        border-radius: 8px;
        padding: 8px 18px;
        border: none;
    }
    .primary-btn:hover {
        background-color: #256628;
    }
    
    /* 修改Streamlit默认按钮为绿色 */
    .stButton > button {
        background-color: #2e7d32;
        color: white;
    }
    .stButton > button:hover {
        background-color: #256628;
    }
    
    /* 警告信息使用浅红色文字而不是红色背景 */
    .stWarning, .stAlert {
        border-left-color: #ff6b6b !important;
        background-color: #fff5f5 !important;
        color: #d63384 !important;
    }
    </style>
""", unsafe_allow_html=True)

# ==========================================
# 串口管理类
# ==========================================
class SerialManager:
    def __init__(self):
        self.ser = None
        self.current_weight = "0.0"
    
    def connect(self, port, baud_rate=9600):
        try:
            if self.ser and self.ser.is_open:
                self.disconnect()
            self.ser = serial.Serial(port, baud_rate, timeout=0.05)
            return True
        except Exception as e:
            st.error(f"无法打开串口 {port}: {e}")
            self.ser = None
            return False
    
    def disconnect(self):
        if self.ser and self.ser.is_open:
            self.ser.close()
        self.ser = None
    
    def read_weight_data(self):
        if not self.ser or not self.ser.is_open:
            return self.current_weight
        try:
            if self.ser.in_waiting:
                line = self.ser.readline().decode('utf-8', errors='ignore').strip()
                if "Weight" in line or "weight" in line.lower() or any(char.isdigit() for char in line):
                    matches = re.findall(r"[-+]?\d*\.\d+|\d+", line)
                    if matches:
                        self.current_weight = matches[0]
        except Exception:
            pass
        return self.current_weight

# ==========================================
# 摄像头管理类
# ==========================================
class CameraManager:
    def __init__(self):
        self.cap = None
    
    def start_camera(self, camera_index=0):
        # 如果已有摄像头打开，先释放
        if self.cap and self.cap.isOpened():
            self.cap.release()
            
        # --- 修改重点 1: 增加 cv2.CAP_DSHOW ---
        # Windows下外接摄像头通常需要这个参数
        # 如果你是 Mac/Linux，请去掉 cv2.CAP_DSHOW
        self.cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
        
        # --- 修改重点 2: 去掉了 for 循环 ---
        # 强制只打开用户选择的那个 ID，不自动跳回内置摄像头
        
        if self.cap.isOpened():
            # 尝试设置分辨率，有些老旧摄像头不支持高分辨率会导致打开失败
            # 如果依然打不开，可以尝试注释掉下面这两行 set 语句测试
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            self.cap.set(cv2.CAP_PROP_FPS, 30) 
            return True
        else:
            return False
    
    def get_frame(self):
        if self.cap and self.cap.isOpened():
            ret, frame = self.cap.read()
            if ret:
                return frame
        return None
    
    def release(self):
        if self.cap:
            self.cap.release()

# ==========================================
# 1. 加载模型
# ==========================================
@st.cache_resource
def load_yolo_model():
    try:
        model = YOLOWorld('yolov8s-world.pt')
        classes = ["bell pepper", "mush", "mushroom", "banana"]
        model.set_classes(classes)
        return model
    except Exception as e:
        st.error(f"模型加载失败: {e}")
        return None

# 初始化管理器
if 'serial_mgr' not in st.session_state:
    st.session_state.serial_mgr = SerialManager()
serial_mgr = st.session_state.serial_mgr

camera_mgr = CameraManager()

# ==========================================
# 2. 侧边栏设置
# ==========================================
with st.sidebar:
    st.title("⚙️ 系统设置")
    
    st.markdown("### 🔌 串口连接")
    ports = list(serial.tools.list_ports.comports())
    port_list = [p.device for p in ports]
    port_list = port_list if port_list else ["未检测到串口"]
    
    selected_port = st.selectbox("选择端口", port_list)
    baud_rate = st.selectbox("波特率", [9600, 115200], index=1)
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("连接", use_container_width=True, type="primary"):
            if selected_port != "未检测到串口":
                if serial_mgr.connect(selected_port, baud_rate):
                    st.success("已连接")
    with col2:
        if st.button("断开", use_container_width=True, type="primary"):
            serial_mgr.disconnect()
            st.success("已断开")

    st.markdown("---")
    st.markdown("### 📷 识别控制")
    
    camera_index = st.selectbox("摄像头索引", [0, 1, 2], index=0)
    conf_threshold = st.slider("识别灵敏度", 0.0, 1.0, 0.25)
    
    # 添加手动重置按钮（用于解锁识别状态）
    manual_reset = st.button("🔄 重置/重新识别", use_container_width=True, type="primary")
    if manual_reset:
        # 重置detail_opened标记，允许下次识别后再次自动跳转
        st.session_state["detail_opened"] = False
    
    st.markdown("---")
    run_detection = st.toggle('🚀 启动系统', value=False)

# ==========================================
# 3. 主程序逻辑
# ==========================================
model = load_yolo_model()
st.title("⚖️ AI 智能电子秤 Calorie Station")

col1, col2 = st.columns([3, 1])

with col1:
    st.markdown("### 实时画面")
    st_frame = st.empty()

with col2:
    st.markdown("### 实时数据")
    product_placeholder = st.empty()
    weight_placeholder = st.empty()
    status_placeholder = st.empty()

if run_detection:
    if not camera_mgr.start_camera(camera_index):
        st.error("摄像头启动失败")
    else:
        # ==========================================
        # 核心优化：定义状态变量
        # ==========================================
        detection_locked = False        # 是否已锁定识别结果
        frozen_frame = None             # 锁定的画面
        frozen_product_name = "扫描中..." # 锁定的商品名
        
        # 如果用户点击了侧边栏的重置按钮（这会触发脚本重新运行），
        # 代码会从头执行，变量重置，所以实际上不需要在循环内检测按钮。
        
        while run_detection:
            # 1. 始终实时读取重量 (不管是否锁定)
            weight = serial_mgr.read_weight_data()
            
            # 2. 视觉处理逻辑
            display_frame = None
            display_product = "扫描中..."
            display_color = "#95a5a6" # 灰色

            # 初始化status_html避免NameError
            status_html = "<div class='metric-card' style='padding:10px;'>🔄 系统初始化中...</div>"
            
            if detection_locked:
                # --- 已锁定状态 ---
                # 直接使用保存的画面和名称，不再调用摄像头和AI
                display_frame = frozen_frame
                display_product = frozen_product_name
                display_color = "#27ae60" # 绿色
                
                # 状态提示
                # 转换为中文名称并生成跳转链接
                zh_name = FOOD_NAME_MAP.get(display_product, display_product)
                # 这里的 weight_value 单位是 g
                weight_value = float(weight)
                url = "https://calory-station.vercel.app/dish-recognition.html"
                params = {
                    "name": zh_name,
                    "weight": f"{weight_value:.2f}"
                }
                full_url = url + "?" + urllib.parse.urlencode(params, encoding="utf-8")
                
                # 尝试自动在系统浏览器中打开，仅当未打开过时
                if not st.session_state["detail_opened"]:
                    try:
                        webbrowser.open(full_url)
                        st.session_state["detail_opened"] = True
                    except:
                        pass
                
                status_html = f"""<div class='metric-card' style='padding:10px; background:#e8f8f5;'>
                    <span style='color:#27ae60'>🔒 <b>已锁定结果，可点击下方查看营养信息</b></span><br>
                    <small>点击侧边栏"重置"解锁</small>
                    <div style='margin-top: 10px;'>
                        <a href="{full_url}" target="_blank" class="primary-btn">查看"{zh_name}"营养信息</a>
                    </div>
                </div>"""
                
            else:
                # --- 未锁定状态 ---
                frame = camera_mgr.get_frame()
                
                if frame is not None:
                    # 运行 AI 识别
                    annotated_frame = frame.copy()
                    detected_objs = []
                    
                    if model:
                        try:
                            results = model.predict(frame, conf=conf_threshold, verbose=False)
                            # 如果有检测结果，绘制并检查
                            if len(results[0].boxes) > 0:
                                annotated_frame = results[0].plot()
                                 
                                # 获取识别到的物体名称
                                for box in results[0].boxes:
                                    cls_id = int(box.cls[0])
                                    detected_objs.append(results[0].names[cls_id])
                                 
                                # === 触发锁定 ===
                                detection_locked = True
                                frozen_frame = cv2.cvtColor(annotated_frame, cv2.COLOR_BGR2RGB)
                                frozen_product_name = detected_objs[0] # 取第一个识别到的
                                 
                                display_frame = frozen_frame
                                display_product = frozen_product_name
                                display_color = "#27ae60"
                            else:
                                # 未识别到物体
                                display_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                                display_product = "等待放置物品..."
                                display_color = "#3498db"
                        except Exception as e:
                            print(e)
                    
                    if not detection_locked:
                        status_html = "<div class='metric-card' style='padding:10px;'>👀 正在识别，请保持食材稳定</div>"
                else:
                    # 摄像头未捕获到画面时的状态提示
                    status_html = "<div class='metric-card' style='padding:10px;'>📷 摄像头未获取到画面</div>"
                
            # 3. 更新 UI (确保在循环内实时刷新)
            
            # 显示画面
            if display_frame is not None:
                st_frame.image(display_frame, channels="RGB", use_container_width=True)
            
            # 显示商品名称
            product_html = f"""
            <div class='metric-card' style='border-left: 5px solid {display_color};'>
                <p style='color:#7f8c8d; margin:0;'>识别结果</p>
                <h3 style='color: {display_color}; margin:5px 0;'>{display_product}</h3>
            </div>
            """
            product_placeholder.markdown(product_html, unsafe_allow_html=True)
            
            # 显示实时重量 (始终更新)
            weight_html = f"""
            <div class='metric-card' style='border-left: 5px solid #e67e22;'>
                <p style='color:#7f8c8d; margin:0;'>实时重量</p>
                <div>
                    <span class="weight-text">{weight}</span>
                    <span class="unit-text">g</span>
                </div>
            </div>
            """
            weight_placeholder.markdown(weight_html, unsafe_allow_html=True)
            
            # 显示状态
            status_placeholder.markdown(status_html, unsafe_allow_html=True)
            
            # 简单的延时
            time.sleep(0.03)

        camera_mgr.release()
else:
    st_frame.info("请在左侧点击 '🚀 启动系统'")
    # 如果串口连接了，在待机时也显示重量
    if serial_mgr.ser and serial_mgr.ser.is_open:
        w = serial_mgr.read_weight_data()
        weight_placeholder.info(f"待机重量: {w} g")
