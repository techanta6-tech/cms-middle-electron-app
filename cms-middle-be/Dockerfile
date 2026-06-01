# Sử dụng base image Node.js chính thức (Node 18 LTS)
FROM node:18-slim

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Cài đặt ffmpeg hệ thống để xử lý chụp ảnh RTSP camera cực kỳ mượt mà và ổn định
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json và package-lock.json trước để tối ưu hóa Docker build cache cho dependencies
COPY package*.json ./

# Cài đặt các thư viện Node.js (bỏ qua devDependencies)
RUN npm install --omit=dev

# Copy toàn bộ mã nguồn của backend vào container
COPY . .

# Cài đặt biến môi trường mặc định
ENV NODE_ENV=production
ENV BE_PORT=5050
ENV USER_DATA_PATH=/app

# Mở port của server Express & Socket.IO
EXPOSE 5050

# Lệnh khởi chạy ứng dụng
CMD ["node", "index.js"]
