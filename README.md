# Prism 前端（nezha-zero v0）部署包

Prism 是哪吒 v0 面板（nezha-zero）的第三方前端主题。本仓库提供开箱即用的 Docker 部署文件，照着下面步骤做，10 分钟上线。

> **来源与致谢**：Prism 基于开源项目 **[wxte/Monitor-Glass](https://github.com/wxte/Monitor-Glass)** 修改而来（数据层针对 nezha-zero 面板重写，并做了界面与功能上的大量调整）。原项目版权归原作者 stqfdyr、wxte 所有，遵循 [MIT 协议](LICENSE)，在此致谢。

---

## 准备（缺一不可）

1. **哪吒 v0 面板已经在运行**（本部署包针对 nezha-zero v0.20.28），并知道它的访问地址，例如 `http://127.0.0.1:8008` 或 `http://192.168.1.10:8008`
2. 一台装好 **Docker + Docker Compose** 的机器（就是部署前端的机器，可以和面板同一台）
3. 一个**域名**解析到部署机器，例如 `v0.example.com`（没有域名先用 IP + 端口也能验证，但正式使用建议上域名）

## 第 1 步：下载并解压部署包

```bash
cd /opt
wget https://github.com/ypkin/prism-nezha/releases/latest/download/prism-deploy.zip
unzip prism-deploy.zip -d prism
cd prism
ls
```

解压后应看到：

```text
dist/                    前端文件（已构建好，不用自己编译）
Dockerfile               镜像定义
docker-compose.yml       容器配置（下一步要改）
default.conf.template    nginx 配置模板（不用改）
README.md                本说明
```

没有 wget/unzip 的先装：Debian/Ubuntu 用 `apt install -y wget unzip`，Alpine 用 `apk add wget unzip`。

## 第 2 步：改面板地址（最关键的一步）

用编辑器打开 `docker-compose.yml`，把这两行改成**你自己面板的地址**：

```yaml
    environment:
      - DOMAIN=_
      # 哪吒 v0 面板地址，必须以 / 结尾
      - NEZHA=http://127.0.0.1:8008/
      - NEZHA_ORIGIN=http://127.0.0.1:8008
```

规则：

- `NEZHA` **结尾必须有 `/`**，`NEZHA_ORIGIN` **结尾不要 `/`**，写反了会 404 或数据加载不出来
- `DOMAIN=_` 不用改

不想手动编辑的，直接按情况执行一条命令（在部署包目录里）：

```bash
# 情况 A：面板就在同一台机器、端口就是 8008 → 什么都不用改，跳过本步

# 情况 B：面板在同一台机器，但端口不是 8008（例：改成 18008）
sed -i 's#127.0.0.1:8008#127.0.0.1:18008#g' docker-compose.yml

# 情况 C：面板在另一台机器（例：192.168.1.10:8008）
sed -i 's#NEZHA=http://.*#NEZHA=http://192.168.1.10:8008/#; s#NEZHA_ORIGIN=http://.*#NEZHA_ORIGIN=http://192.168.1.10:8008#' docker-compose.yml

# 改完检查一眼（两行地址要和你的面板完全一致）：
grep NEZHA docker-compose.yml
```

## 第 3 步：启动容器

在部署包目录里执行：

```bash
docker compose up -d --build
docker ps --filter name=glass-frontend
```

看到 `glass-frontend` 状态是 `Up` 就是起来了。再本机验证一下：

```bash
curl -s http://127.0.0.1:8084/ | head -5
```

能输出一段 HTML（`<title>Prism</title>`）说明前端服务正常。容器只监听 `127.0.0.1:8084`，外网暂时访问不到，下一步做反代。

容器没起来或 curl 没输出时看日志排错：

```bash
docker logs glass-frontend --tail 30
```

## 第 4 步：域名反代到容器（HTTPS）

前端必须通过域名访问，这一步把域名转给容器的 8084 端口。两种方式选一种：

### 方式 A：宿主机 nginx 反代

宿主机 nginx 加一个 server 块（证书用 certbot 申请，下面的命令里有）：

```nginx
server {
    listen 443 ssl;
    server_name v0.example.com;

    ssl_certificate     /etc/letsencrypt/live/v0.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/v0.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8084;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

整套命令（先申请证书，再写配置，再重载）：

```bash
# 1. 装 certbot 并申请证书（把域名换成你的；会让你填邮箱并同意条款）
apt install -y certbot
certbot certonly --nginx -d v0.example.com

# 2. 写反代配置（证书路径就是 certbot 的默认目录，不用改）
cat > /etc/nginx/conf.d/v0.example.com.conf <<'EOF'
server {
    listen 443 ssl;
    server_name v0.example.com;

    ssl_certificate     /etc/letsencrypt/live/v0.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/v0.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8084;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

# 3. 测试配置并重载
nginx -t && nginx -s reload
```

**Upgrade 两行不能省**，少了实时数据（WebSocket）连不上，页面只有骨架没有数字。

### 方式 B：Cloudflare 隧道

把隧道回源指向 `http://127.0.0.1:8084` 即可，cloudflared 自带 WebSocket 支持，不用额外设置。用配置文件方式的，在 `~/.cloudflared/config.yml` 的 ingress 里加：

```yaml
  - hostname: v0.example.com
    service: http://127.0.0.1:8084
```

然后重启隧道：`cloudflared tunnel run <你的隧道名>`（或 `systemctl restart cloudflared`）。

## 第 5 步：打开域名验证

浏览器打开 `https://v0.example.com`，逐项确认：

1. **节点列表**出现，速率数字在跳动 → 实时通道正常
2. 点任意节点，右侧抽屉顶部的**运营商延迟图**有曲线（前提：面板里已给节点配置 ICMP 监控任务）
3. **价格 / 到期**显示正确（数据来自每台机器在面板里填的 PublicNote，没填就没这两列）
4. 访问 `https://v0.example.com/login` 能打开**面板登录页**并正常登录（后台与前台同域）

四项都过，部署完成。也可以先用命令快速验前两项：

```bash
curl -s https://v0.example.com/ | grep -o '<title>[^<]*</title>'
# 应输出 <title>Prism</title>

curl -s -o /dev/null -w '%{http_code}\n' https://v0.example.com/login
# 应输出 200
```

## 日常更新

下载新版部署包后，替换整个目录（保留你改过的 `docker-compose.yml` 面板地址），重新执行：

```bash
docker compose up -d --build
```

静态文件带 hash 且长缓存，用户刷新即可拿到新版，不用清缓存。

## v1.0.1 界面调整

v1.0.1 在 v1.0.0 基础上叠加了一套界面微调补丁，部署包已自带，无需额外操作：

- 移动端详情卡：保持 2×2 田字格、每行单行不折行；行距统一；Speed 行箭头与数字同基线
- PC 节点表：列更紧凑、间距统一、表头与数据对齐；面板定宽 1250px 居中，两侧空边精确一致
- 顶栏与过滤按钮行与面板同宽；过滤按钮去掉点阵纹理；PC 详情卡字体放大

补丁实现：`dist/assets/prism-mobile-fix-v15.css`，由 `dist/index.html` 在主题样式之后以一行 `<link>` 引用。日常更新若只替换 dist 里的部分文件，注意保留这个 css 文件和 index.html 里的引用行，否则界面会回到主题原样。

## 常见问题

| 现象 | 原因与解法 |
| --- | --- |
| 页面打开了，但列表是空的 / 一直转圈 | 面板地址填错或 `NEZHA` 结尾少了 `/`；检查第 2 步，并确认部署机能访问面板地址（`curl http://127.0.0.1:8008/` 试一下） |
| 列表有数据，但数字不刷新 | WebSocket 被挡：外层反代少了 Upgrade 头（第 4 步），或中间还有一层代理没透传 |
| 延迟图没数据 | 面板里没建 ICMP 监控任务，或任务没分配给该节点 |
| 价格 / 到期是空的 | 对应机器的 PublicNote 没按面板格式填写 |
| `/login` 打开 404 | `NEZHA_ORIGIN` 结尾多了 `/`，或面板地址不可达 |

## 说明

- 本前端的数据解析针对 **nezha-zero v0.20.28** 的面板首页结构；面板大版本升级后如遇列表异常，多半是首页结构变了，需要等前端适配。
- 换前端不动面板本体和 agent，回滚只需把域名改回直连面板地址。
