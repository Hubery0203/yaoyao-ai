# 语音回复 V1

这是文字输入→既有Core生成回复→可选AI语音输出；不是语音识别或实时通话。分支叠在尚未发布的010C/D之上，010D美国备份安装/启用仍需原来的独立批准。

## 用户使用

默认关闭。服务已配置后，在微信发送“开启语音”，会先说明回复文字发给OpenAI合成、可能产生费用、MP3文件形式、次数限制；5分钟内回复“确认语音 XXXXXXXX”才开启。预览/确认有持久化回执，重放不重复开启或重置启用时间；新预览使旧码失效，关闭使待确认码失效。

仅在开启后新收到且原始发送时间也在开启之后的日常对话中，合成现有最终回复，保留原文字历史和记忆。240字符以内且不含URL/代码的短回复可合成；长回复、控制命令、照片回执、主动联系保留文字，不截断或再用模型摘要。缺少原始时间戳的旧行也不补合成。

命令：
- `语音帮助`、`语音状态`：固定帮助、开启状态/声音/尝试数/冷却及最近任务。
- `语音声音 coral`、`语音声音 marin`、`语音声音 shimmer`：内置声音，默认coral。不克隆真人声音。
- `关闭语音`：收件时立即关闭并取消待确认；阻止随后上传/语音发送。已经开始的供应商调用可能已收费，不能撤回已经交给网络的消息。
- `跳过语音`：收件时立即跳过未完成/结果不明音频，避免旧消息阻塞。不会重新合成。

当前发送的是 **YAOYAO-AI-voice.mp3 文件**，需要点开播放；不承诺原生微信语音条。上游Tencent仓库记录了VOICE接口接受但手机不可见的问题，主线send-media也将非图片/视频作为FILE发送。只有本人手机实测能证明可见并可播放。

## 实现与界限

OpenAI固定官方`POST /v1/audio/speech`、`gpt-4o-mini-tts`、MP3、三个有限声音；只发送当前最终回复，不发完整历史/图片参考，不允许用户替换供应商URL/任意语音ID。风格指令固定为自然轻柔普通话，不添加解释尾句；实际声音和中文自然度仍需真实试听，不能从mock判断。

部署时仅为API增加`deploy/vps-lite/voice/10-voice-spool.conf`的专用写目录许可，目录`/var/lib/yaoyao-ai-voice/spool`由yaoyao拥有且0700；不放宽代理或其他目录。收费预留前写入/同步并删除私有探针，检查只读挂载/磁盘故障。

独立配置`VOICE_ENABLED=0`（默认）、`OPENAI_VOICE_API_KEY`、`VOICE_STORAGE_DIR`及`VOICE_MAX_PER_24H=10`（1～20）。不自动读取/复用图片或聊天密钥。正式配置可在明确批准后把现有OpenAI项目密钥用于该变量，仍需确认余额和语音权限。无新依赖、转码器、端口、常驻服务或模型评委。

0013增加两张FORCE RLS通道表weixin_voice_settings/weixin_voices，以及weixin_messages.source_created_ms可空列（旧行不变）。设置绑定本人，控制回复和设置写入同事务。仅真正Core日常回复能登记eligible任务，控制/主动消息不能登记。失败码有限，无供应商原文、音频字节或新增Core事实写入库。

每次收费前在通道行锁下预留：同条消息只能一次fresh，滚动24小时默认10次、60秒冷却，失败/超时也计入。结果不明/崩溃后的reserved任务不重新合成，回退原文字。音频落盘和DB提交后才能上传；CDN失败可从原字节有限重试，不能重新收费；上传重复失败或本地文件丢失/过期回退文字。DB状态不可信则停止该项，不盲目发消息。

合成后、上传前和最终发送前核对取消/暂停/授权/设置版本。发送前记录实际audio/text选择；状态不会把文字回退说成语音发送。发送超时进入uncertain，不自动发第二个音频或文字。接口接受与本人收取/播放是不同验收项。

私有音频spool0700/文件0600、SHA256文件名、每文件<=2MiB、总量约32MiB、24小时过期清理。只检查MP3头/首帧格式边界，不声称完整解码/时长校验；不安装ffmpeg以伪装原生语音条。没有HTTP公开音频目录。临时语音spool不加入010D永久备份清单；设置/任务随数据库备份。

## 验证与发布状态

本轮本地开发，所有供应商/CDN/微信测试使用合成数据及stub，实际付费请求0、服务器写入0。测试覆盖确认/失效/重放、迟到旧消息、并发配额、RLS/本人隔离、失败/重启、取消/关闭、CDN加密/安全域名、FILE协议和不明发送不重发。已有文字/照片回归同时保留。Linux CI、真实合成试听、本人微信收取与东京部署均未完成。

依据：
- https://developers.openai.com/api/docs/guides/text-to-speech
- https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
- https://github.com/Tencent/openclaw-weixin/issues/215
- https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/send-media.ts
- https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/send.ts

文档核对日期：2026-10-26。上游协议/问题记录不能替代本人账户、手机和额度实测。

本地验证结果：1088项通过（795单元/架构合同、258真实本机PostgreSQL/pgvector集成、3端到端、32Node）；最终语音专项40项及集成20项复核通过。build/lint/boundaries通过。使用54349隔离数据库替代Testcontainers进行本机检查，Linux/Docker CI仍待上传后运行；mock语气不代表真实声音效果。
