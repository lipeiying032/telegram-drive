import { Hono } from 'hono';
import { cors } from 'hono/cors';

// 类型定义
interface Env {
  BOT_TOKEN: string;
  CHANNEL_ID: string;
  MY_USER_ID: string;
  FILES_KV: KVNamespace;
}

interface FileMetadata {
  file_id: string;
  file_unique_id: string;
  name: string;
  size: number;
  mime_type?: string;
  path: string;
  uploaded_at: number;
  message_id?: number;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  document?: TelegramDocument;
}

const app = new Hono<{ Bindings: Env }>();

// CORS 中间件
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// 验证用户权限
function verifyUser(userId: string | null, env: Env): boolean {
  if (!userId) return false;
  return userId === env.MY_USER_ID;
}

// 调用 Telegram API
async function callTelegramAPI(
  method: string,
  token: string,
  body?: any
): Promise<any> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });

  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(`Telegram API Error: ${data.description || 'Unknown error'}`);
  }
  
  return data.result;
}

// 上传文件到 Telegram
async function uploadToTelegram(
  file: File,
  channelId: string,
  token: string
): Promise<TelegramMessage> {
  const formData = new FormData();
  formData.append('chat_id', channelId);
  formData.append('document', file);
  
  return await callTelegramAPI('sendDocument', token, formData);
}

// 从 Telegram 获取文件信息
async function getFileFromTelegram(fileId: string, token: string): Promise<TelegramFile> {
  return await callTelegramAPI('getFile', token, { file_id: fileId });
}

// 路径标准化
function normalizePath(path: string): string {
  if (!path || path === '/') return '';
  path = path.trim().replace(/\/+/g, '/');
  if (path.startsWith('/')) path = path.slice(1);
  if (path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

// 生成 KV key
function generateKVKey(path: string, filename: string): string {
  const normalizedPath = normalizePath(path);
  return `file:${normalizedPath ? normalizedPath + '/' : ''}${filename}`;
}

// ==================== 路由处理 ====================

// 首页 - 返回 Web 界面
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telegram 文件云盘</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .subtitle { opacity: 0.9; font-size: 14px; }
    .content { padding: 30px; }
    
    /* 上传区域 */
    .upload-area {
      border: 3px dashed #667eea;
      border-radius: 12px;
      padding: 60px 20px;
      text-align: center;
      background: #f8f9ff;
      transition: all 0.3s;
      cursor: pointer;
      margin-bottom: 30px;
    }
    .upload-area.dragover {
      background: #e8ebff;
      border-color: #764ba2;
      transform: scale(1.02);
    }
    .upload-area:hover { background: #f0f2ff; }
    .upload-icon { font-size: 48px; margin-bottom: 16px; }
    .upload-text { font-size: 18px; color: #667eea; font-weight: 600; margin-bottom: 8px; }
    .upload-hint { color: #888; font-size: 14px; }
    #fileInput { display: none; }
    
    /* 路径和操作 */
    .controls {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .path-input {
      flex: 1;
      min-width: 200px;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border 0.3s;
    }
    .path-input:focus {
      outline: none;
      border-color: #667eea;
    }
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }
    
    /* 文件列表 */
    .file-list {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
    }
    .file-item {
      background: white;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.3s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    .file-item:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .file-info { flex: 1; }
    .file-name {
      font-weight: 600;
      color: #333;
      margin-bottom: 4px;
      word-break: break-all;
    }
    .file-meta {
      font-size: 12px;
      color: #888;
    }
    .file-actions {
      display: flex;
      gap: 8px;
    }
    .btn-small {
      padding: 8px 16px;
      font-size: 13px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.3s;
    }
    .btn-download {
      background: #667eea;
      color: white;
    }
    .btn-download:hover {
      background: #5568d3;
    }
    
    /* 状态提示 */
    .status {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }
    .status.show { display: block; }
    .status.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .status.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    .status.loading { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
    
    .loading { text-align: center; padding: 40px; color: #888; }
    .empty { text-align: center; padding: 40px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📁 Telegram 文件云盘</h1>
      <div class="subtitle">基于 Cloudflare Workers + Telegram 的私密文件存储</div>
    </div>
    
    <div class="content">
      <!-- 状态提示 -->
      <div id="status" class="status"></div>
      
      <!-- 上传区域 -->
      <div class="upload-area" id="uploadArea">
        <div class="upload-icon">📤</div>
        <div class="upload-text">点击或拖拽文件到此处上传</div>
        <div class="upload-hint">支持所有文件类型，单文件最大 2GB</div>
        <input type="file" id="fileInput" multiple>
      </div>
      
      <!-- 控制面板 -->
      <div class="controls">
        <input type="text" id="pathInput" class="path-input" placeholder="文件路径（如：/photos/2026）" value="/">
        <input type="text" id="userIdInput" class="path-input" placeholder="您的 Telegram User ID" style="max-width: 200px;">
        <button class="btn btn-primary" onclick="loadFiles()">🔄 刷新列表</button>
      </div>
      
      <!-- 文件列表 -->
      <div class="file-list">
        <div id="fileList" class="loading">加载中...</div>
      </div>
    </div>
  </div>

  <script>
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const pathInput = document.getElementById('pathInput');
    const userIdInput = document.getElementById('userIdInput');
    const fileList = document.getElementById('fileList');
    const status = document.getElementById('status');

    // 显示状态
    function showStatus(message, type = 'loading') {
      status.textContent = message;
      status.className = 'status show ' + type;
      if (type !== 'loading') {
        setTimeout(() => status.classList.remove('show'), 5000);
      }
    }

    // 格式化文件大小
    function formatSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 格式化时间
    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN');
    }

    // 拖拽上传
    uploadArea.addEventListener('click', () => fileInput.click());
    
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) uploadFiles(files);
    });
    
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) uploadFiles(e.target.files);
    });

    // 上传文件
    async function uploadFiles(files) {
      const userId = userIdInput.value.trim();
      if (!userId) {
        showStatus('❌ 请输入您的 Telegram User ID', 'error');
        return;
      }

      const path = pathInput.value.trim() || '/';
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        showStatus(`📤 正在上传: ${file.name} (${i + 1}/${files.length})`, 'loading');
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', path);
        
        try {
          const response = await fetch('/upload?user_id=' + userId, {
            method: 'POST',
            body: formData,
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            showStatus(`✅ 上传成功: ${file.name}`, 'success');
          } else {
            showStatus(`❌ 上传失败: ${result.error || '未知错误'}`, 'error');
          }
        } catch (error) {
          showStatus(`❌ 上传出错: ${error.message}`, 'error');
        }
      }
      
      fileInput.value = '';
      loadFiles();
    }

    // 加载文件列表
    async function loadFiles() {
      const userId = userIdInput.value.trim();
      if (!userId) {
        fileList.innerHTML = '<div class="empty">请先输入您的 Telegram User ID</div>';
        return;
      }

      const path = pathInput.value.trim() || '/';
      fileList.innerHTML = '<div class="loading">加载中...</div>';
      
      try {
        const response = await fetch(`/list?path=${encodeURIComponent(path)}&user_id=${userId}`);
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error || '加载失败');
        }
        
        if (result.files.length === 0) {
          fileList.innerHTML = '<div class="empty">📭 该路径下暂无文件</div>';
          return;
        }
        
        fileList.innerHTML = result.files.map(file => `
          <div class="file-item">
            <div class="file-info">
              <div class="file-name">📄 ${file.name}</div>
              <div class="file-meta">
                ${formatSize(file.size)} · ${formatTime(file.uploaded_at)}
              </div>
            </div>
            <div class="file-actions">
              <button class="btn-small btn-download" onclick="downloadFile('${file.download_url}', '${file.name}')">
                ⬇️ 下载
              </button>
            </div>
          </div>
        `).join('');
        
      } catch (error) {
        fileList.innerHTML = `<div class="empty">❌ ${error.message}</div>`;
      }
    }

    // 下载文件
    function downloadFile(url, filename) {
      showStatus('⬇️ 开始下载: ' + filename, 'loading');
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      showStatus('✅ 下载已开始', 'success');
    }

    // 页面加载时尝试加载文件
    window.addEventListener('load', () => {
      const userId = userIdInput.value.trim();
      if (userId) loadFiles();
    });
  </script>
</body>
</html>`;
  
  return c.html(html);
});

// 上传文件
app.post('/upload', async (c) => {
  try {
    // 验证用户
    const userId = c.req.query('user_id');
    if (!verifyUser(userId, c.env)) {
      return c.json({ error: 'Unauthorized: Invalid user ID' }, 403);
    }

    // 解析表单数据
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const path = (formData.get('path') as string) || '/';

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    // 检查文件大小（2GB 限制）
    if (file.size > 2 * 1024 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 2GB)' }, 400);
    }

    console.log(`Uploading file: ${file.name}, size: ${file.size}, path: ${path}`);

    // 上传到 Telegram
    const message = await uploadToTelegram(file, c.env.CHANNEL_ID, c.env.BOT_TOKEN);

    if (!message.document) {
      throw new Error('Failed to upload document to Telegram');
    }

    // 构建元数据
    const metadata: FileMetadata = {
      file_id: message.document.file_id,
      file_unique_id: message.document.file_unique_id,
      name: file.name,
      size: file.size,
      mime_type: file.type || message.document.mime_type,
      path: normalizePath(path),
      uploaded_at: Date.now(),
      message_id: message.message_id,
    };

    // 存储到 KV
    const kvKey = generateKVKey(metadata.path, metadata.name);
    await c.env.FILES_KV.put(kvKey, JSON.stringify(metadata));

    console.log(`File uploaded successfully: ${kvKey}`);

    // 返回结果
    return c.json({
      success: true,
      file_id: metadata.file_id,
      name: metadata.name,
      size: metadata.size,
      download_url: `/download/${encodeURIComponent(kvKey)}`,
    });

  } catch (error: any) {
    console.error('Upload error:', error);
    return c.json({ error: error.message || 'Upload failed' }, 500);
  }
});

// 列出文件
app.get('/list', async (c) => {
  try {
    // 验证用户
    const userId = c.req.query('user_id');
    if (!verifyUser(userId, c.env)) {
      return c.json({ error: 'Unauthorized: Invalid user ID' }, 403);
    }

    const path = c.req.query('path') || '/';
    const normalizedPath = normalizePath(path);
    const prefix = `file:${normalizedPath ? normalizedPath + '/' : ''}`;

    console.log(`Listing files with prefix: ${prefix}`);

    // 从 KV 获取文件列表
    const list = await c.env.FILES_KV.list({ prefix });
    const files: any[] = [];

    for (const key of list.keys) {
      const data = await c.env.FILES_KV.get(key.name);
      if (data) {
        const metadata: FileMetadata = JSON.parse(data);
        files.push({
          name: metadata.name,
          size: metadata.size,
          mime_type: metadata.mime_type,
          uploaded_at: metadata.uploaded_at,
          download_url: `/download/${encodeURIComponent(key.name)}`,
        });
      }
    }

    // 按上传时间倒序排序
    files.sort((a, b) => b.uploaded_at - a.uploaded_at);

    return c.json({ files, path: normalizedPath || '/', count: files.length });

  } catch (error: any) {
    console.error('List error:', error);
    return c.json({ error: error.message || 'Failed to list files' }, 500);
  }
});

// 下载文件
app.get('/download/:key', async (c) => {
  try {
    const key = decodeURIComponent(c.req.param('key'));
    
    console.log(`Downloading file: ${key}`);

    // 从 KV 获取元数据
    const data = await c.env.FILES_KV.get(key);
    if (!data) {
      return c.json({ error: 'File not found' }, 404);
    }

    const metadata: FileMetadata = JSON.parse(data);

    // 从 Telegram 获取文件路径
    const fileInfo = await getFileFromTelegram(metadata.file_id, c.env.BOT_TOKEN);
    
    if (!fileInfo.file_path) {
      throw new Error('File path not available');
    }

    // 构建 Telegram 文件 URL
    const fileUrl = `https://api.telegram.org/file/bot${c.env.BOT_TOKEN}/${fileInfo.file_path}`;

    // 代理下载
    const fileResponse = await fetch(fileUrl);
    
    if (!fileResponse.ok) {
      throw new Error('Failed to download file from Telegram');
    }

    // 返回文件流
    return new Response(fileResponse.body, {
      headers: {
        'Content-Type': metadata.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.name)}"`,
        'Content-Length': metadata.size.toString(),
        'Cache-Control': 'public, max-age=31536000',
      },
    });

  } catch (error: any) {
    console.error('Download error:', error);
    return c.json({ error: error.message || 'Download failed' }, 500);
  }
});

// 健康检查
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

export default app;
