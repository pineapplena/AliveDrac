# 用 GitHub Releases 做自动更新

推荐使用 **公开 GitHub 仓库**。公开仓库的更新不需要把 GitHub Token 放进应用里。

## 第一次上传（不需要命令行）

### 1. 注册 GitHub

打开 https://github.com 注册并登录。

### 2. 安装 GitHub Desktop

下载：

https://desktop.github.com/

安装后用 GitHub 账号登录。

### 3. 把项目加入 GitHub Desktop

1. 打开 GitHub Desktop；
2. 菜单 `File` → `Add Local Repository…`；
3. 选择整理好的上传目录：

```text
F:\alivedrac-github
```

4. 如果提示这不是 Git 仓库，点击 `create a repository`；
5. 名称填 `AliveDrac`；
6. 不要勾选初始化 README / License，避免覆盖现有文件；
7. 点击 `Create Repository`。

不要选择原来的 `F:\alivedrac`。那个目录里有 `data`、`release`、日志和测试截图；上传目录已经把源码单独整理好了。

### 4. 检查要上传的文件

左侧 Changes 里应该主要是源码、`desktop`、`docs`、`seed`、`build/icon.ico`、`.github` 等文件。

不应该出现：

```text
data/
node_modules/
release/
dist/
logs/
.env
```

这些已经写进 `.gitignore`。如果看到 `data/`，不要提交，里面有聊天记录、记忆和 API Key。

### 5. 提交并发布仓库

1. 左下角 Summary 填 `Initial Alive desktop app`；
2. 点击 `Commit to main`；
3. 点击右上角 `Publish repository`；
4. **取消勾选 `Keep this code private`**，使用公开仓库；
5. 点击 `Publish Repository`。

## 开 GitHub Actions 写权限

在仓库网页：

```text
Settings → Actions → General → Workflow permissions
```

选择 **Read and write permissions**，保存。

## Actions 页面只显示 Get started

这说明仓库里没有 `.github/workflows/release.yml`，通常是网页上传时隐藏文件夹 `.github` 被漏掉了。

手动补一次：

1. 打开仓库的 `Actions` 页面；
2. 点击 `set up a workflow yourself`；
3. 把文件名改成：

```text
release.yml
```

4. 打开本地文件：

```text
F:\alivedrac-github\.github\workflows\release.yml
```

5. 全选复制，粘贴到 GitHub 编辑器；
6. 点击 `Commit changes`，提交到 `main`；
7. 回到 Actions，刷新页面，就能看到 `Release Alive`。

注意路径必须是：

```text
.github/workflows/release.yml
```

不能放在仓库根目录。

## Actions 报 Dependencies lock file is not found

这通常不是工作流本身的问题，而是仓库里只有 `.github`，没有上传项目源码，所以找不到 `pnpm-lock.yaml`。

正确做法：

1. GitHub Desktop → `File` → `Clone repository`；
2. 选择 `pineapplena/AliveDrac`（或你的实际仓库）；
3. 克隆到一个新目录，例如 `F:\AliveDrac`；
4. 打开 `F:\alivedrac-github`，复制里面的所有内容；
5. 粘贴到克隆目录 `F:\AliveDrac`，保留克隆目录里的 `.git`；
6. 在 GitHub Desktop 提交并 Push。

确认仓库根目录能看到：

```text
package.json
pnpm-lock.yaml
desktop/
server/
src/
.github/
```

再重新运行 `Release Alive`。

## 第一次发布版本

不需要在本地打 tag。

1. 打开仓库的 `Actions` 页面；
2. 左侧选择 `Release Alive`；
3. 点击 `Run workflow`；
4. 版本号填一个比当前更高的版本，例如：

```text
1.5.1
```

5. 点击运行。

工作流会自动：

- 写入版本号；
- 写入 GitHub 仓库地址；
- 构建安装包；
- 生成 `latest.yml`；
- 创建 `v1.5.1` Release 并上传安装包。

完成后在 `Releases` 页面应该能看到：

```text
Alive-Setup-1.5.1.exe
Alive-Setup-1.5.1.exe.blockmap
latest.yml
```

## 之后发版

以后只需要在 `Actions → Release Alive → Run workflow` 里填入更高的版本号，例如 `1.5.2`。

不需要手动改 `package.json`，工作流会用输入的版本号。

## 一次性设置（手动构建的安装版）

GitHub Actions 构建的安装包会自动把仓库信息写进 `desktop/github-release.json`，用户不需要配置。

如果你用的是自己本地构建的旧安装版，在托盘菜单打开「更新设置…」，填写：

```json
{
  "updateProvider": "github",
  "githubOwner": "你的GitHub用户名",
  "githubRepo": "AliveDrac",
  "updateUrl": "",
  "autoCheck": true
}
```

保存后重启。

## 已经发布成私有仓库怎么办

注意：Danger Zone 不在 `Settings → Actions` 页面，而是在仓库的 **Settings → General** 页面最底部。

打开：

```text
https://github.com/你的用户名/AliveDrac/settings
```

确认左侧选中的是 `General`，然后一直滚到页面最下面，找到：

```text
Danger Zone
```

点击：

```text
Change repository visibility → Change to public
```

按提示输入仓库名确认即可。

如果底部没有 Danger Zone：

- 确认你打开的是仓库的 Settings，不是 Actions 的 Settings；
- 确认你是仓库所有者或管理员；
- 如果仓库已经是 Public，就不需要再改；
- 企业/组织策略可能禁止修改可见性，需要管理员处理。

改成公开后，重新运行一次：

```text
Actions → Release Alive → Run workflow
```

如果之前已经生成过 Release，也可以保留；只要 Release 是公开的，客户端就能下载更新。

如果仓库里曾经误传过 `data`、`.env` 或 API Key，不要直接公开。先删除仓库，用干净的 `F:\alivedrac-github` 重新上传。


`.github/workflows/release.yml`：

- 支持 `v*` 标签；
- 也支持在 Actions 页面手动输入版本号；
- 使用 `windows-latest`；
- 自动修改版本号；
- 自动构建 `Alive-Setup-*.exe`；
- 上传安装包、blockmap 和 `latest.yml` 到 GitHub Release。

## 私有仓库

私有仓库需要 GitHub Token，不能把 Token 直接写进客户端，所以不适合公开自动更新。

## 注意

- Release 不要设成 Draft 或 Pre-release；
- 版本号必须递增；
- 没有代码签名时，Windows 可能弹 SmartScreen；
- 便携版仍然手动替换 ZIP，自动更新以安装版为准。
