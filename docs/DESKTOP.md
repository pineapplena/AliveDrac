# Alive 桌面版

桌面版不是重写一套界面，而是在现有 React + 本地 Node 服务外面加一层 Electron 外壳。

```text
Alive.exe（C# 启动器）
→ electron.exe + resources/app（窗口、托盘、权限）
→ resources/runtime/node.exe（现有服务端）
→ http://127.0.0.1:8790（窗口里加载现有界面）
```

## 开发运行

```bash
pnpm build
pnpm desktop:dev
```

`desktop:dev` 会：

- 使用当前 Node 作为服务端 sidecar；
- 使用 Electron 窗口加载本地服务；
- 默认使用项目的 `data` 目录和 8790 端口；
- 关闭窗口后隐藏到托盘。

如果不想和网页版共用数据库，可以显式指定：

```bash
set ALIVE_DATA_DIR=F:\alivedrac\desktop-data
pnpm desktop:dev
```

## 打包便携桌面版

```bash
pnpm build
pnpm package:desktop
```

输出：

```text
release/Alive-Desktop-v1.5.0-win-x64/
release/Alive-Desktop-v1.5.0-win-x64.zip
```

双击 `Alive.exe` 就能启动，不需要打开浏览器。

## 安装向导

```bash
pnpm build
pnpm package:installer
```

输出：

```text
release/installer/Alive-Setup-1.5.0.exe
release/installer/latest.yml
release/Alive-Setup-1.5.0-win-x64.zip
```

安装向导支持：

- 仅当前用户或所有用户；
- 选择安装目录；
- 桌面快捷方式和开始菜单快捷方式；
- 卸载程序；
- 安装完成后直接启动。

## 应用图标

应用图标来自当前角色头像，构建时生成：

```text
build/icon.ico
build/icon.png
desktop/icon.png
```

安装包、安装向导、桌面快捷方式、窗口和托盘共用这张图。

## 自动更新

安装版使用 `electron-updater`。

### GitHub Releases（推荐）

仓库里已经带有 `.github/workflows/release.yml`。推一个 `v1.5.1` 标签后，GitHub Actions 会自动：

- 构建 Windows 安装包；
- 生成 `latest.yml` 和 blockmap；
- 上传到对应的 GitHub Release；
- 把仓库信息写进 `desktop/github-release.json`。

因此从 GitHub Actions 安装的用户不需要手动填写更新地址，应用会从 GitHub Releases 检查更新。

详细步骤见 [GITHUB_UPDATES.md](GITHUB_UPDATES.md)。

### 自有静态目录

1. 把 `latest.yml` 和对应的 `Alive-Setup-*.exe` 放到一个静态目录；
2. 在托盘菜单打开「更新设置…」；
3. 编辑数据目录里的 `desktop.json`：

```json
{
  "updateProvider": "generic",
  "updateUrl": "https://你的更新目录/alive/",
  "autoCheck": true
}
```

4. 重启 Alive。

之后：

- 启动 15 秒后检查一次；
- 每 6 小时检查一次；
- 托盘菜单「检查更新」可以手动检查；
- 下载完成后提示重启安装，聊天和记忆数据保留。

### 发布一次新版本

自动更新不是“改代码后自动生效”，每次发版需要做一次固定流程：

1. 修改版本号：
   - `package.json` 的 `version`
   - `server/config.ts` 的 `VERSION`
2. 构建：

```bash
pnpm build
pnpm package:installer
```

3. 把下面三个文件上传到同一个静态更新目录：

```text
release/installer/Alive-Setup-1.5.1.exe
release/installer/Alive-Setup-1.5.1.exe.blockmap
release/installer/latest.yml
```

4. 保持 `updateUrl` 不变，例如：

```text
https://你的域名/alive/
```

5. 已安装的旧版本会在下一次检查时发现新版本，下载后提示重启安装。

`latest.yml` 里的版本和文件名必须与实际上传的安装包一致；不要只上传 `.exe` 而不上传 `latest.yml`。

便携版不做自动更新；更新便携版时，下载新的 ZIP，解压后把旧 `data` 文件夹放回新目录即可。

## 开机自启动

默认关闭，不会偷偷写入启动项。

需要时在托盘菜单里手动勾选：

```text
开机自启动（可选）
```

再次点击即可关闭。

## 数据位置

便携版默认把数据放在：

```text
<Alive.exe 所在目录>/data
```

安装版默认把数据放在：

```text
%APPDATA%\alivedrac\data
```

但安装版也支持最简单的方式：只要在 `Alive.exe` 旁边放一个完整的 `data` 目录，启动时就会优先使用它。

```text
Alive/
├─ Alive.exe
└─ data/
   ├─ alive.db
   ├─ assets/
   └─ ...
```

也就是说，安装版和便携版都可以用“复制粘贴 `data` 到 Alive.exe 同目录”来迁移，不需要命令，也不需要改路径。前提是 `data` 里确实有 `alive.db`。

从网页版迁移的最简单步骤：

1. 退出网页版和桌面版；
2. 复制网页版的 `F:\alivedrac\data` 文件夹；
3. 打开安装版 `Alive.exe` 所在目录；
4. 把 `data` 整个文件夹粘贴到 `Alive.exe` 旁边；
5. 启动 Alive。

安装版默认安装目录通常是：

```text
C:\Users\<你的用户名>\AppData\Local\Programs\Alive
```

如果忘了装在哪里，右键桌面上的 Alive 快捷方式 →「打开文件所在的位置」。

如果安装目录里已经有旧的 `data`，先把它改名备份，再粘贴。不要复制成 `data\data`，也不要把只包含 `alive.db` 的文件直接丢进去；整个 `data` 目录一起复制。

API Key、模型设置、聊天、记忆、约定、日程、关系数值都在 `alive.db` 里；头像和图片在 `assets/`；窥屏截图在 `screen/`。

## 窗口与托盘

- 关闭窗口：第一次会提示“隐藏到托盘 / 退出 Alive”；选择隐藏后不再重复提示；
- 隐藏后 Windows 可能会把新托盘图标放进右下角的 `^` 折叠区；
- 如果仍然看不到，打开「任务栏设置 → 任务栏角溢出」，把 Alive 设为显示；
- 托盘单击或双击：显示窗口；
- 托盘菜单「退出（停止服务）」：停止 Node 服务并退出；
- 「在浏览器中打开」：调试或临时使用网页版；
- 如果当前系统无法创建托盘，关闭窗口会退化为最小化，不会留下看不见的后台进程。

## 兼容模式

启动器会先按正常 sandbox 启动；如果 Electron 立即退出（例如当前系统/目录的 ACL 阻止 sandbox），会自动用 `--no-sandbox` 重试一次。

如果仍然无法启动，运行：

```text
启动 Alive（兼容模式）.cmd
```

它会用 `--no-sandbox` 启动桌面版。正常解压后的环境优先直接双击 `Alive.exe`。

## 当前边界

- 仍然是 Web 技术渲染界面，只是不再依赖外部浏览器窗口；
- 不使用 `electron-builder` 安装器，当前提供便携目录和 ZIP；
- 自动更新、开机自启、安装向导可以后续再加；
- 服务端继续使用项目自己的 Node 运行时，避免 Electron 内置 Node 与 `node:sqlite` 版本不一致。
