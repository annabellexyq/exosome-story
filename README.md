# 窗外信使 · 外泌体与蓝夜

一个纯前端的互动叙事小游戏（HTML + CSS + 原生 JS，无构建、无后端）。
玩家在窗边替老人把「外泌体」当作信件送出，串起前情提要、小游戏、彩蛋视频与结尾的信。

## 线上地址（生产）

- **GitHub Pages（主）**：https://annabellexyq.github.io/exosome-story/
  - 仓库：https://github.com/annabellexyq/exosome-story
  - 发布方式：仓库 `main` 分支根目录，Pages 自动构建；推送后约 1–3 分钟生效
- 腾讯云开发 CloudBase（备用）：https://ai-native-d7gjgsyyefdea561d-1302042144.tcloudbaseapp.com/

## 发布更新

站点为纯静态、无构建步骤，改完直接推送到 `main` 即可自动上线：

```bash
cd exo-window-story
git add -A
git commit -m "描述本次改动"
git push origin main
```

## 部署信息

| 项目 | 值 |
| --- | --- |
| 平台 | 腾讯云开发 CloudBase |
| 能力 | 静态网站托管（Static Hosting） |
| 环境 ID | `ai-native-d7gjgsyyefdea561d` |
| 环境别名 | `ai-native` |
| 地域 | `ap-shanghai` |
| 套餐 | 个人版（`baas_personal`） |
| 托管域名 | `ai-native-d7gjgsyyefdea561d-1302042144.tcloudbaseapp.com` |
| 首页/错误页 | `index.html` |

### 使用的 CloudBase 资源

- 静态托管：承载全部站点文件（`index.html`、`css/`、`js/`、`assets/`）。
- 未使用云函数、云数据库、云存储 SDK、CloudRun —— 本项目为纯静态站点，不需要后端。

## 目录结构

```
exo-window-story/
├── index.html          # 单页入口
├── css/style.css       # 全部样式
├── js/                 # 游戏逻辑（engine / acts / scene / puzzles / lab / xr / gl / audio …）
└── assets/             # 图片与视频（bg / video / lab / xr / cover.jpg）
```

## 本地预览

站点为纯静态，任意 HTTP 服务器即可：

```bash
cd exo-window-story
python3 -m http.server 8300
# 打开 http://localhost:8300/
```

## 重新部署（更新线上内容）

1. 修改本地文件；
2. 上传到静态托管根目录（忽略 `.git/`、`.codebuddy/`、`*.md`）：

   ```
   manageHosting action=upload
     localPath = <本项目绝对路径>
     cloudPath = /
     ignore    = ["**/.git/**", "**/.codebuddy/**", "**/*.md"]
   ```

3. 若 CDN 有缓存，访问时带随机查询串刷新，例如：
   `https://ai-native-d7gjgsyyefdea561d-1302042144.tcloudbaseapp.com/?v=<时间戳>`

## 备注

- 环境为个人版，注意套餐有效期与资源用量；
- 若后续需要自定义域名 + HTTPS，可在 CloudBase 控制台「静态托管 → 域名管理」绑定。
