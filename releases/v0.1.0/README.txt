API Test Platform 0.1.0 — Windows x64 构建产物
==============================================

本目录与 Git 仓库一并分发，便于客户直接下载安装。

文件说明：
  API Test Platform-0.1.0-x64.exe
    NSIS 安装程序。可选安装路径、创建桌面快捷方式。

  API Test Platform-0.1.0-portable-x64.exe
    便携版单文件 exe，免安装，适合 U 盘或临时环境。

  win-unpacked（免安装调试目录）
    体积较大（约 300MB），未纳入 Git（超过单文件 100MB 限制）。
    需要时请在本机 desktop 目录执行：npm run pack:win
    生成路径：desktop\release\win-unpacked\API Test Platform.exe

产品说明书：仓库 docs\PRODUCT-MANUAL.pdf