# 窗外信使 · 外泌体与蓝夜

一个纯前端的互动叙事小游戏（HTML + CSS + 原生 JS，无构建、无后端）。
玩家在窗边替老人把「外泌体」当作信件送出，串起前情提要、小游戏、彩蛋视频与结尾的信。

## 线上地址（生产）

- **GitHub Pages（主）**：https://annabellexyq.github.io/exosome-story/
  - 仓库：https://github.com/annabellexyq/exosome-story
  - 发布方式：仓库 `main` 分支根目录，Pages 自动构建；推送后约 1–3 分钟生效
- 腾讯云开发 CloudBase：
  - **专属域名（推荐对外）**：https://exostory-ai-native-d7gjgsyyefdea561d.webapps.tcloudbase.com/
  - 共享域名（根路径）：https://ai-native-d7gjgsyyefdea561d-1302042144.tcloudbaseapp.com/
  - 该环境（`ai-native-d7gjgsyyefdea561d`）的**根目录 `/` 归本项目**：站点文件直接放在根 —— `index.html` + `css/` + `js/` + `assets/`
  - 专属域名来自 CloudApp（`serviceName=exostory`，`appPath=/`），网关把它映射到托管根目录
  - 历史入口 `/exo-story/` 仍然可用（页内用 `<base href="/">` 复用根目录资源），但对外统一用根路径即可
  - 同环境共 3 个 CloudApp，各自带专属域名，互不干扰：
    `youyitianxia` → `/youyi`（游医天下）、`exostory` → `/`（本项目）、`exopinch` → `/exo-pinch`（囊泡漂流）
  - ⚠️ 切勿把本项目部署到 `/youyi/`、`/exo-pinch/` —— 那分别是「游医天下」和「囊泡漂流」的目录

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
| 托管域名 | `ai-native-d7gjgsyyefdea561d-1302042144.tcloudbaseapp.com`（本项目占用**根路径 `/`**，另有历史入口 `/exo-story/`） |
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
2. 推 `main` → GitHub Pages 自动重建（主链路）；
3. CloudBase 备用链路：本项目占用**托管根目录 `/`**，整包上传即可：

   ```
   manageHosting action=upload
     files = [{ localPath: <本项目>/index.html, cloudPath: index.html }, …]
   ```

   ⚠️ **不要**把文件传到 `/youyi/` 或 `/exo-pinch/` —— 那分别是「游医天下」和「囊泡漂流」的目录。
   若只是想让历史入口 `/exo-story/` 跟着更新，上传的必须是**加了 `<base href="/">` 的副本**（紧跟 `<head>` 之后），
   不要直接传源文件，否则 `/exo-story/` 下的相对路径会 404。

4. 若 CDN 有缓存，访问时带随机查询串刷新，例如：
   `https://ai-native-d7gjgsyyefdea561d-1302042144.tcloudbaseapp.com/?v=<时间戳>`

## 备注

- 环境为个人版，注意套餐有效期与资源用量；
- 若后续需要自定义域名 + HTTPS，可在 CloudBase 控制台「静态托管 → 域名管理」绑定。
