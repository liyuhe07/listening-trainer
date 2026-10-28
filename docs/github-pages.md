# 发布到 GitHub Pages

1. 在 GitHub 上新建一个空仓库（不要勾选自动生成 README）。
2. 在项目目录里（第一次）：
   ```bash
   git init -b main
   git add .
   git commit -m "精听练习器"
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 打开仓库的 **Settings → Pages**，Source 选 *Deploy from a branch*，Branch 选 `main`，目录选 `/ (root)`，保存。
4. 一两分钟后访问 `https://<你的用户名>.github.io/<仓库名>/`。

注意：

- 不要把自己的听力音频、原文或导出的内容包提交到仓库里（`.gitignore` 已经排除了常见的音频和 zip，`samples/` 里的示例除外）。
- 模型文件约 46 MB，低于 GitHub 单文件 100 MB 的限制，不需要 Git LFS。
- 每个访问者的题库只保存在他自己的浏览器里，网站本身不收集任何数据。
