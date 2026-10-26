# 语音回复 V1

这是文字输入→既有Core生成回复→可选AI语音输出；不是语音识别或实时通话。分支叠在尚未发布的010C/D之上，010D美国备份安装/启用仍需原来的独立批准。

## 用户使用

默认关闭。服务已配置后，在微信发送“开启语音”，会先说明回复文字发给MiniMax合成、可能产生费用、MP3文件形式、次数限制；5分钟内回复“确认语音 XXXXXXXX”才开启。预览/确认有持久化回执，重放不重复开启或重置启用时间；新预览使旧码失效，关闭使待确认码失效。

仅在开启后新收到且原始发送时间也在开启之后的日常对话中，合成现有最终回复，保留原文字历史和记忆。240字符以内且不含URL/代码的短回复可合成；长回复、控制命令、照片回执、主动联系保留文字，不截断或再用模型摘要。缺少原始时间戳的旧行也不补合成。

命令：
- `语音帮助`、`语音状态`：固定帮助、开启状态/声音/尝试数/冷却及最近任务。
- `语音声音 温暖闺蜜`、`语音声音 温柔学姐`、`语音声音 柔和少女`：MiniMax预置中文声音，默认温暖闺蜜。不克隆真人声音。
- `关闭语音`：收件时立即关闭并取消待确认；阻止随后上传/语音发送。已经开始的供应商调用可能已收费，不能撤回已经交给网络的消息。
- `跳过语音`：收件时立即跳过未完成/结果不明音频，避免旧消息阻塞。不会重新合成。

当前发送的是 **YAOYAO-AI-voice.mp3 文件**，需要点开播放；不承诺原生微信语音条。上游Tencent仓库记录了VOICE接口接受但手机不可见的问题，主线send-media也将非图片/视频作为FILE发送。只有本人手机实测能证明可见并可播放。

## 实现与界限

当前仅激活MiniMax官方`POST /v1/t2a_v2`，模型默认`speech-2.8-hd`（也允许显式配置`speech-2.8-turbo`）。固定站点白名单：中国站`https://api.minimax.cn`、国际站`https://api.minimax.io`；地域必须和用户提供的密钥所属站点一致，不自动跨站尝试。仅发送当前最终回复，指定MP3/单声道/32kHz、非流式hex响应，不下载返回URL，不发完整历史、图片参考或克隆音频。不额外添加笑声/喘息等标签；含供应商控制标签的回复保留文字。中文自然度仍需真实试听，mock不能代替。

官方预置音色映射：温暖闺蜜→Chinese (Mandarin)_Warm_Bestie，温柔学姐→Chinese (Mandarin)_Gentle_Senior，柔和少女→Chinese (Mandarin)_Soft_Girl。0013已发布到草稿PR但未部署，保留其校验和和内部coral/marin/shimmer档位键以避免修改既有迁移；这些只是稳定内部键，当前不表示OpenAI音色。用户界面显示中文名称，旧命令别名仍识别。开启确认哈希加入minimax命名空间，旧供应商预览不可确认；发布前必须确认生产语音表不存在或为空，不把已有旧供应商启用记录无告知改接MiniMax。

HTTP200也必须检查`base_resp.status_code===0`和`data.status===2`。1008/2053映射额度不足、1004/2049映射授权失败、1002等映射限流，超时/结果不明保守处理。仅有完整、有界、偶数长度hex和有效MP3头的成功音频才能落盘；最大JSON约4MiB+64KiB、音频2MiB，错误体16KiB。不保存原错误文案或密钥，不自动重试或回退供应商。

部署时仅为API增加`deploy/vps-lite/voice/10-voice-spool.conf`的专用写目录许可，目录`/var/lib/yaoyao-ai-voice/spool`由yaoyao拥有且0700；不放宽代理或其他目录。收费预留前写入/同步并删除私有探针，检查只读挂载/磁盘故障。

独立配置`VOICE_ENABLED=0`（默认）、`MINIMAX_VOICE_API_KEY`、`MINIMAX_VOICE_REGION=cn|international`、`MINIMAX_VOICE_MODEL`、`VOICE_STORAGE_DIR`及`VOICE_MAX_PER_24H=10`（1～20）。默认服务、账号均关闭；没有MiniMax密钥或显式地域就不接通。用户已要求停用OpenAI语音；运行时工厂不读取OPENAI_VOICE_API_KEY、不调用OpenAI或自动复用任何旧密钥。旧适配器仅保留兼容单测，不参与运行时选择。无新依赖、转码器、端口、常驻服务或模型评委。

0013增加两张FORCE RLS通道表weixin_voice_settings/weixin_voices，以及weixin_messages.source_created_ms可空列（旧行不变）。设置绑定本人，控制回复和设置写入同事务。仅真正Core日常回复能登记eligible任务，控制/主动消息不能登记。失败码有限，无供应商原文、音频字节或新增Core事实写入库。

每次收费前在通道行锁下预留：同条消息只能一次fresh，滚动24小时默认10次、60秒冷却，失败/超时也计入。结果不明/崩溃后的reserved任务不重新合成，回退原文字。音频落盘和DB提交后才能上传；CDN失败可从原字节有限重试，不能重新收费；上传重复失败或本地文件丢失/过期回退文字。DB状态不可信则停止该项，不盲目发消息。

合成后、上传前和最终发送前核对取消/暂停/授权/设置版本。发送前记录实际audio/text选择；状态不会把文字回退说成语音发送。发送超时进入uncertain，不自动发第二个音频或文字。接口接受与本人收取/播放是不同验收项。

私有音频spool0700/文件0600、SHA256文件名、每文件<=2MiB、总量约32MiB、24小时过期清理。只检查MP3头/首帧格式边界，不声称完整解码/时长校验；不安装ffmpeg以伪装原生语音条。没有HTTP公开音频目录。临时语音spool不加入010D永久备份清单；设置/任务随数据库备份。

## 验证与发布状态

本轮本地开发，所有供应商/CDN/微信测试使用合成数据及stub，实际付费请求0、服务器写入0。测试覆盖确认/失效/重放、迟到旧消息、并发配额、RLS/本人隔离、失败/重启、取消/关闭、CDN加密/安全域名、FILE协议和不明发送不重发。已有文字/照片回归同时保留。Linux CI、真实合成试听、本人微信收取与东京部署均未完成。

依据（2026-10-26核对）：
- https://platform.minimax.cn/docs/api-reference/speech-t2a-http
- https://platform.minimax.io/docs/api-reference/speech-t2a-http
- https://platform.minimax.cn/docs/faq/system-voice-id
- https://platform.minimax.io/docs/api-reference/errorcode
- https://github.com/Tencent/openclaw-weixin/issues/215
- https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/send-media.ts

原OpenAI候选已通过1088项CI，首次真实调用因额度不足停止，1/3次预算已用；没有发布/迁移/重启/测试文件发送。用户改选MiniMax后，延续剩余最多2次真实合成预算（含失败和重试）及未使用的部署/测试文件额度；不重置总预算，不恢复OpenAI。适配后的新候选需要新CI与发布包核验。MiniMax密钥、真实声音、手机播放及部署仍待完成；原OpenAI候选的CI不能冒充本次候选的结果。

MiniMax适配本地验证：1115项通过（821单元/架构合同、259唯一集成场景〔258项全量＋最终21项专项，其中新增1项旧供应商确认拒绝〕、3端到端、32Node）。build/lint/boundaries通过。MiniMax真实请求0次；密钥与地域待用户填写，本轮没有服务器写入。新CI及正式代码包仍需核验。
