# 微信语音输入 V1

本人在原 ClawBot 会话发送不超过30秒的微信原生语音，转写后交给同一账号的 Core 接话。日常回复沿用已开启的 MiniMax「妩媚御姐」及原合成额度；长回答、操作提示和合成额度不足时仍用文字。输出仍为 MP3 文件，不是微信原生语音条，也不是实时通话。

## 输入、费用和隐私

- 完整的一对一单条语音；优先采用微信已有的 `voice_item.text`，这一路不下载录音、不调用 ASR。无转写时接受 SILK 或16位单声道 PCM，最多2MiB、实际时长30秒。混合消息、其他编码、长录音或静音要求文字/重发短语音。
- 下载只允许腾讯指定 HTTPS CDN，禁止跳转和任意 URL，不转发微信或模型凭据。原录音和解码 WAV 只在内存；队列中的下载参数在完成、失败、停用或取消后清除，未处理队列可能暂存。转写和正常对话历史保存在受 RLS 保护的数据表中。
- 无微信转写时，WAV 交给 MiniMax ASR；转写文字随后可能交给 DeepSeek，回复可能交给 MiniMax TTS。供应商留存遵循供应商条款，本应用不承诺供应商零留存。
- ASR 滚动24小时默认最多10次，与原 TTS 10次额度独立；失败、拒绝、超时、结果未知均计一次。没有自动重试或平台回退；已开始的请求取消后仍可能收费。
- 只新识别启用后且10分钟以内的源消息。单条消息在调用前原子预留收费尝试，识别结果在 Core 前落库。重启后的 reserved 视为结果未知，不重新识别；已完成的转写、Core 和发送继续使用原幂等机制。

## 文字确认与记忆

识别文字不进入命令分发器。设置、绑定、提醒、拍照或记忆操作要求用文字确认。ASR 没有可依赖的校准置信度，因此 V1 对全部 `attachment=voice` 输入跳过自动长期记忆和生活事件提取，保留正常聊天历史。听错可打字更正；需要长期记住的内容请用文字表达。

“听语音帮助”“听语音状态”查看说明和额度；“跳过识别”停止尚未发送的语音输入回复，“取消回复”和暂停通道继续生效。发送结果未知仍按原队列停止自动重发。

## 显式配置

默认关闭，必须配置：

```
ASR_ENABLED=1
MINIMAX_ASR_API_KEY=<私有配置>
MINIMAX_ASR_REGION=cn
ASR_ACTIVE_SINCE=<启用UTC时间>
ASR_MAX_PER_24H=10
```

不自动回退到已有语音/看图密钥；经本人授权可以使用同一账户密钥显式设置 ASR 变量。真实接口权限与余额须验证，不能以现有 TTS/生图成功代替 ASR 验收。

MiniMax 官方 `POST /v1/speech_to_text`，multipart `model=asr-1.0`、`file`、`response_format=json`、`stream=false`；国内 `https://api.minimax.cn`，国际 `https://api.minimax.io`。一次45秒上限，响应最多64KiB，检查转写长度和返回时长。

## 解码和资源

新增精确固定的 MIT 依赖 `silk-wasm@3.7.1`，无运行时传递依赖。主进程先校验 SILK 头、包长和包数，再用短时子进程解码；子进程空环境、24MiB旧堆、4MiB半空间、5秒截止，输入2MiB、输出1.44MiB上限。结束/取消后等待子进程退出再进入 ASR，无常驻解码器、ffmpeg 或新增端口。

父进程 RSS 超过112MiB时拒绝启动解码并提示先打字；保持原 API 192MiB、父堆64MiB和共享 slice256MiB。旧线程方案因主进程内存驻留已弃用。macOS 本地生产同等64MiB父堆下，连续10次30秒合成音频解码成功，父进程峰值约109MiB，单独解码子进程峰值约69MiB；这些是本地结果，不能替代 Linux/cgroup 上线验收。资源不足时保持 ASR 关闭，不能自行提高限额。

## 验证和发布

`node scripts/evaluate-audio.mjs --audio /absolute/private.wav` 默认离线。授权后加 `--live --max-calls 1 --out /absolute/private-directory` 才发一次 ASR 请求。先持久化锁和账本；失败即停止，不得删除锁或换目录绕过批准总额。工具不发送微信、不调用 Core/TTS、不部署。测试录音先使用本机生成的合成语音，不上传私人录音作验收。

迁移0016新增 `weixin_audio` 表、`weixin_messages.incoming_audio` 列和互斥媒体约束；保留数据和微信授权。Linux CI 产出完整包、代码包及独立 SILK runtime 包；使用旧 runtime 时必须证明锁文件仅新增 SILK 包及 infrastructure 直接依赖，其余依赖语义一致，并校验所有包和目标目录，无 VPS npm install。

回退保留新增表/列，先停用 ASR、将未完成语音任务停止发送并清理下载引用；旧版本必须补入 `attachment=voice` 的长期记忆排除规则。仅切回旧链接会丢掉这条保护，不能直接这样回退。保留已计费记录和转写，不清零额度。发布前验证兼容回退包、数据库备份和单接收进程；本人批准后方可改服务器。

## 官方依据

- [MiniMax ASR 指南](https://platform.minimax.cn/docs/guides/speech-to-text)
- [MiniMax ASR 接口](https://platform.minimax.io/docs/api-reference/speech-to-text)
- [微信消息类型](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts)
- [微信 SILK 转码实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/media/silk-transcode.ts)
- [silk-wasm 源码](https://github.com/idranme/silk-wasm)
