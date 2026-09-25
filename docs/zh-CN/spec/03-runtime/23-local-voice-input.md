# 23. 本地语音输入

> **翻译说明：** 本页是与[英文源规格](/spec/03-runtime/23-local-voice-input)一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。
>
> **事实来源：** `packages/shared/src/types/settings.ts`、
> `packages/shared/src/protocol.ts`、`packages/voice-runtime` 和 Electron
> `VoiceService` / 语音 IPC 模块。

## 1. 范围与区分

本地语音输入提供可选的麦克风转写。它不是
[`20-speech.md`](/zh-CN/spec/03-runtime/20-speech) 中基于 provider 的
`AppSettings.speech` 能力：它不增加语音 provider 选择器、TTS 操作或
provider 凭据，也不改变 `speech/*` 合同。ADR local-voice-input 将 ADR 0291 的适用范围
限定为 provider 语音能力。

## 2. 设置

`AppSettings.voice` 为可选项。缺失时，界面按语音输入已禁用处理，使用系统
默认麦克风，且不选择模型。存在时包含：

- `enabled`：是否启用 Composer 语音输入；
- `deviceId`：麦克风设备 ID，或用 `null` 表示系统默认设备；
- `languages`：识别语言代码；
- `chineseVariant`：简体、繁体（台湾）或繁体（香港）中文输出转换；
- `modelId`：本地识别模型 ID，未选择时为空字符串。

设置更新沿用现有宿主设置写入路径。该可选字段不需要数据库 schema 迁移；
旧设置缺少此字段时按禁用处理。

## 3. 采集与识别边界

Electron main 负责麦克风采集和 `VoiceService`。该服务使用
`packages/voice-runtime` 处理 PCM 转换、流式/批量转写、语言处理和模型生命
周期。识别在本地运行。采集到的 PCM 保留在 main 进程的语音流程中，不会持久
化，也不会发送给 provider。渲染器只接收语音状态、进度和完成后的文本，不接
收麦克风音频。

用户显式操作模型下载后，识别模型从模型目录下载，并缓存在当前应用数据目录
的 `voice-models` 子目录。模型下载与转写分离；开始录音不会隐式下载模型。

## 4. IPC 与生命周期

`pi-desktop/voice/*` IPC 系列覆盖开始、停止、取消、状态/设备/模型读取、模型
下载/删除、设置更新和麦克风权限检查/请求。`pi-desktop/voice/event/stateChanged`
传递生命周期/结果状态；`pi-desktop/voice/event/modelProgress` 报告模型下载进
度。应用退出时释放 main 进程服务。渲染器只在语音启用期间订阅，并在释放时取
消订阅。

## 5. 用户流程

Voice 设置面板用于启用功能并配置麦克风、语言、中文输出变体和本地模型；面板
提供显式下载/删除操作及进度/状态。只有启用后，Composer 才显示麦克风操作。
开始采集时显示录音状态；停止后执行转写，并将文本插入现有 Composer 草稿（草
稿为空时则创建草稿）。绝不会自动发送消息。取消会停止当前采集且不插入结果。
该流程与 TTS 和基于 provider 的语音设置相互独立（ADR local-voice-input）。
