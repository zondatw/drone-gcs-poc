# 後端容器:純 gRPC 客戶端(連各 px4-sitl 容器的 mavsdk_server,走 TCP),不含 mavsdk_server 本體。
FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir "fastapi>=0.115" "uvicorn[standard]>=0.34" "mavsdk>=3.15.3"
COPY server.py .
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
