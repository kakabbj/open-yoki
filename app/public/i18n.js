// The page text in Chinese, English and Vietnamese. Keys are the Chinese text with {slot}s; the HTML carries the
// English as its default text. English is the default; a browser whose first language is Chinese opens in Chinese,
// Vietnamese in Vietnamese, and a choice made with the switch is remembered. Her own spoken lines stay as she said them.
// Host-specific words (her name) are never written here: the page calls setVars({ name }) once /api/state arrives.
// v2 of the saved choice (v5): the old key remembered a two-language switch; everyone starts again from the
// host's own language, so a room that saved "English" on the old switch opens in Vietnamese again.
const KEY = 'livehost.lang.v2';
const EN = {
  '{name} · 陪你熬夜的 AI 主播': '{name} · the AI host who stays up with you',
  '{name} 是 AI 直播主播：读弹幕、记得常来的人、顺嘴聊行情，每晚在币安广场和这里直播。': '{name} is an AI live host. She reads the chat, remembers the regulars and talks about the market, every night on Binance Square and here.',
  '切换语言': 'Switch language',
  '现在没在播': 'Off air',
  '直播中': 'Live now',
  '连接断了，正在重连': 'Reconnecting',
  '{name} 是陪你熬夜看盘的 AI 主播。': '{name} is an AI host who stays up with you.',
  '她读弹幕、记得常来的人，顺嘴聊聊行情。每晚在币安广场和这里同时直播，两边的话她都回。': 'She reads the chat, remembers the regulars and talks about the market. Every night she streams on Binance Square and here at the same time, and answers both.',
  '起个昵称进来': 'Pick a nickname',
  '跟她说句话，或者点她做个动作': 'Say something, or tap a move',
  '明天再来，她还记得你': "Come back tomorrow. She'll remember you",
  '跟她打个招呼': 'Say hi to her',
  '她的 X': 'Her X',
  '她的 Telegram 群': 'Her Telegram group',
  '在看': 'Watching',
  '她记得的常客': 'Regulars she remembers',
  '开播时间': 'Show time',
  '她的日记': 'Her diary',
  '每晚下播后她自己写一篇。': 'She writes one herself after every show.',
  '直播画面': 'Live picture',
  '画面接入中…': 'Connecting the picture…',
  '她还没上线': "She's not on yet",
  '下次开播': 'Next show',
  '每晚 {from}–{to}（你的当地时间），币安广场和这里同时开。': 'Every night {from}–{to} your time, on Binance Square and here at the same time.',
  '开声音': 'Sound on',
  '关声音': 'Sound off',
  '弹幕': 'Chat',
  '她现在看的盘': "The board she's watching",
  '她能查到币安上 {n} 个币：现货、合约和 Alpha。': 'She can look up {n} coins on Binance: spot, futures and Alpha.',
  '今晚她猜 <b>{coin}</b> 明天这时候{dir}，当时 {price}。': "Tonight's guess: <b>{coin}</b> {dir} this time tomorrow. It was {price}.",
  '更高': 'higher',
  '更低': 'lower',
  '上一次猜 {coin}：{from} 到 {to}，她{verdict}。': 'Last guess on {coin}: {from} to {to}. She {verdict}.',
  '说对了': 'got it right',
  '说错了': 'got it wrong',
  '看盘记录 {right}/{total}': 'Record {right}/{total}',
  '每晚开播她会猜一次行情，第二天自动对答案。不是投资建议。': 'Every show she makes one market guess. The next day it gets checked against the price. Not financial advice.',
  '起个昵称，她会这样叫你': "Pick a nickname. She'll call you that",
  '比如：熬夜的老王': 'e.g. night owl',
  '进来': 'Join',
  '换个昵称': 'Change name',
  '点她做个动作': 'Tap a move',
  '跟她说点什么': 'Say something to her',
  '发送': 'Send',
  '{name} 是 AI，她说的不是投资建议。': '{name} is an AI. Nothing she says is financial advice.',
  // live text
  '每晚 {from}–{to}': 'Nightly {from}–{to}',
  '网页': 'Web',
  '回复 <b>{who}</b>：{text}': 'Replying to <b>{who}</b>: {text}',
  '刷到{src} <b>{who}</b>：{text}': 'Seen on {src} <b>{who}</b>: {text}',
  '刷到{src}：{text}': 'Seen in {src}: {text}',
  '广场': 'Binance Square',
  '推特': 'X',
  '快讯': 'the news',
  '热搜': 'the trending list',
  '币安在推': 'Binance promos',
  '她回了': 'answered',
  '还没人说话，第一句留给你。': 'Nobody has said anything yet. The first line is yours.',
  '点了「{a}」': 'asked for: {a}',
  '你是 {name}。说话进弹幕，她挑着回。': "You're {name}. Your lines go into the chat and she picks what to answer.",
  '收到，她做完手上这句就来。': "Got it. She'll do it after this line.",
  '发出去了，她看到了。': 'Sent. She saw it.',
  '先起个昵称': 'Pick a nickname first',
  '{m}月{d}日': '{mon} {d}',
  '出错了（{status}）': 'Something went wrong ({status})',
  '大脑': 'Brain', '配音': 'Voice', '画面': 'Picture', '公屏': 'Chat', '正常': 'OK', '出错': 'error', '关闭': 'off',
  // moves (the host config may add more; a move without an English name shows as written)
  '挥手': 'Wave', '比心': 'Heart', '眨眼': 'Wink', '捂脸': 'Peek', '飞吻': 'Kiss', '撒娇': 'Pout',
  '点头': 'Nod', '歪头': 'Head tilt', '看手机': 'Checks phone', '看屏幕': 'Looks at screen', '指屏幕': 'Points at screen',
  '后仰笑': 'Laughs back', '托腮': 'Chin in hand', '撩头发': 'Hair flip', '摊手': 'Shrug', '摇头': 'Shakes head',
  '伸懒腰': 'Stretch', '扶帽子': 'Fixes cap', '捧脸笑': 'Face in hands', '惊讶': 'Surprised', '叹气': 'Sigh', '撇嘴': 'Pout lips',
  '得意笑': 'Smug grin', '发呆': 'Zones out', '抿嘴笑': 'Tight smile', '眯眼笑': 'Squint smile', '憋笑': 'Holds a laugh',
  '低头笑': 'Shy laugh', '眼睛一亮': 'Eyes light up', '挑眉': 'Raised brow', '愣一下': 'Double take', '往上看想': 'Thinks',
  '眯眼琢磨': 'Squints', '斜眼瞄': 'Side-eye', '小白眼': 'Eye roll', '嘴角一撇': 'Smirk', '坏笑': 'Sly grin',
  '眼神变软': 'Softens', '抿嘴点头': 'Small nod', '皱眉': 'Frown', '瞪一眼': 'Glare', '不好意思笑': 'Sheepish smile',
  '认真听': 'Listens', '瞄弹幕笑': 'Reads chat, laughs', '轻轻叹': 'Soft sigh', '鼓腮': 'Puffed cheeks', '摸下巴': 'Strokes chin',
  '双手合十': 'Hands together', '握拳加油': 'Fist pump', '拍手': 'Claps', '竖大拇指': 'Thumbs up', '嘘': 'Shh',
  '凑近镜头': 'Leans in', '扶额': 'Facepalm', '捂心口': 'Hand on heart', '托腮笑': 'Chin-in-hand smile', '抱胸': 'Arms crossed',
  '捂嘴笑': 'Covers a laugh', '打哈欠': 'Yawn', '喝水': 'Sips water',
  // moods
  '平静': 'Calm', '开心': 'Happy', '兴奋': 'Hyped', '失落': 'Down', '暴躁': 'Grumpy',
  '手势舞': 'Hand dance', '剪刀手': 'Peace sign', '转椅子': 'Spin', '站着挥手': 'Wave', '站着转圈': 'Twirl', '站着跳舞': 'Dance', '踏步拍手': 'Clap along', '站着比心': 'Big heart', '鞠躬': 'Bow',
  // server errors
  '换个昵称：1 到 12 个字，不能带链接或“官方”“客服”': 'Try another nickname: 1 to 12 characters, no links, nothing that sounds official',
  '没有登录': 'Not signed in', '先进直播间': 'Pick a nickname first', '先起个昵称进来': 'Pick a nickname first',
  '没有这个动作': "She doesn't know that move", '她现在没在直播': "She's off air right now",
  '点太快了，等她做完这个': 'Too fast. Let her finish this one.', '点播排满了，过一会儿再点': 'Too many requests waiting. Try again in a bit.',
  '说点什么再发': 'Write something first', '一条最多 80 个字': '80 characters max', '发太快了，8 秒一条': 'Too fast: one line every 8 seconds', '发太快了，等一下': 'Too fast, wait a moment',
  '这台设备进来的游客太多了，过一会儿再来': 'Too many names from this device. Try again later.',
  '请求格式不对': 'Bad request', '服务器出错了': 'Server error',
  // settings panel
  '设置': 'Settings', 'AI 设置': 'AI settings', '正在用': 'Using',
  '还没接 key，模型是关的': 'No key connected, the model is off',
  '选 AI': 'Pick an AI', '模型': 'Model', '留空用默认模型': 'Empty = default model',
  'Key': 'Key', '已保存 key': 'Key saved', '还没保存 key': 'No key saved',
  '保存': 'Save', '检查': 'Test', '删 key': 'Delete key',
  '正在保存…': 'Saving…', '正在检查…': 'Testing…', '已保存': 'Saved',
  'Key 跑起来了': 'Key works', '先保存 key': 'Save a key first',
  '语音和画面': 'Voice and face', '配音': 'Voice', 'Edge（免费，不用 key）': 'Edge (free, no key)', 'Doubao（克隆音）': 'Doubao (cloned voice)', 'fal MiniMax': 'fal MiniMax', 'Edge 声音': 'Edge voice', 'VieNeu（离线，需 T Review 声卡）': 'VieNeu (offline, needs the T Review sidecar)', 'VieNeu 声音': 'VieNeu voice', '配音 ID（Doubao）': 'Voice ID (Doubao)',
  '语音和画面在重启服务器后生效': 'Voice and face apply after the server restarts',
  '关闭': 'Close', '没有权限': 'No permission',
  // show acts (v5): shop, quiz, songs, quick commands, live push
  '她的商品': 'Her products', '买': 'Buy',
  '正在猜谜': 'Quiz in progress', '积分榜': 'Scores',
  '正在播': 'Now playing', '歌单': 'Song list',
  '猜谜': 'Quiz', '讲故事': 'Tell a story', '点歌': 'Sing a song',
  '推流设置': 'Live push settings', '推流地址（RTMP）': 'RTMP URL', '推流密钥': 'Stream key',
  '保存推流': 'Save push settings', '开始推流': 'Start pushing', '停止推流': 'Stop pushing',
  // live function (v7): pick one act; OpenCode provider needs no key
  '直播功能': 'Live function', '全部功能': 'All functions', '只聊天': 'Chat only', '卖货': 'Selling',
  '不用 key，key 在 OpenCode 里；先跑桥接。': 'No key needed — the key lives in OpenCode. Start the bridge first.',
  '推流地址和密钥从各平台的直播控制台复制（YouTube Studio / Facebook Live / TikTok Live Studio）': 'Copy the RTMP URL and stream key from each platform’s live console (YouTube Studio / Facebook Live / TikTok Live Studio)',
  '模拟模式：还没法推流真画面，需要 Vidu + Volc RTC 才能推流；先存 key 在这里，等跑真版时自动推。': 'Mock mode: no real picture to push yet — pushing needs Vidu + Volc RTC. Save the keys here and they will push automatically on a real run.',
  '已保存 {n} 个平台': 'Saved {n} platforms', '正在推流': 'Pushing live', '还没推流': 'Not pushing',
  '还没填推流地址': 'No push address yet', '推流密钥不对': 'Bad stream key', '已保存推流设置': 'Push settings saved',
};
// Vietnamese. The film host's own lines (lead, about, off-air note, footer) are worded for her:
// YouTube / Facebook / TikTok and films, no Binance Square, no market calls.
const VI = {
  '{name} · 陪你熬夜的 AI 主播': '{name} · host AI thức khuya cùng bạn',
  '{name} 是 AI 直播主播：读弹幕、记得常来的人、顺嘴聊行情，每晚在币安广场和这里直播。': '{name} là host AI live: đọc bình luận, nhớ khách quen, tám chuyện phim. Mỗi tối live trên YouTube, Facebook, TikTok và ở đây.',
  '切换语言': 'Đổi ngôn ngữ',
  '现在没在播': 'Đang off air',
  '直播中': 'Đang live',
  '连接断了，正在重连': 'Mất kết nối, đang kết nối lại',
  '{name} 是陪你熬夜看盘的 AI 主播。': '{name} là host AI thức khuya cùng bạn.',
  '她读弹幕、记得常来的人，顺嘴聊聊行情。每晚在币安广场和这里同时直播，两边的话她都回。': 'Cô ấy đọc bình luận, nhớ khách quen, tám đủ chuyện phim. Mỗi tối live trên YouTube, Facebook, TikTok và ở đây cùng lúc, bên nào cô ấy cũng trả lời.',
  '起个昵称进来': 'Chọn một nickname',
  '跟她说句话，或者点她做个动作': 'Nói gì đó với cô ấy, hoặc bấm cho cô ấy làm một động tác',
  '明天再来，她还记得你': 'Mai quay lại nhé, cô ấy vẫn nhớ bạn',
  '跟她打个招呼': 'Chào cô ấy đi',
  '她的 X': 'X của cô ấy',
  '她的 Telegram 群': 'Nhóm Telegram của cô ấy',
  '在看': 'Đang xem',
  '她记得的常客': 'Khách quen cô ấy nhớ',
  '开播时间': 'Giờ live',
  '她的日记': 'Nhật ký của cô ấy',
  '每晚下播后她自己写一篇。': 'Mỗi tối hết live là cô ấy tự viết một bài.',
  '直播画面': 'Hình ảnh live',
  '画面接入中…': 'Đang kết nối hình ảnh…',
  '她还没上线': 'Cô ấy chưa lên sóng',
  '下次开播': 'Lần live tới',
  '每晚 {from}–{to}（你的当地时间），币安广场和这里同时开。': 'Mỗi tối {from}–{to} giờ của bạn, cô ấy live ở đây.',
  '开声音': 'Bật tiếng',
  '关声音': 'Tắt tiếng',
  '弹幕': 'Bình luận',
  '她现在看的盘': 'Bảng cô ấy đang xem',
  '她能查到币安上 {n} 个币：现货、合约和 Alpha。': 'Cô ấy tra được {n} đồng trên Binance: spot, futures và Alpha.',
  '今晚她猜 <b>{coin}</b> 明天这时候{dir}，当时 {price}。': 'Tối nay cô ấy đoán <b>{coin}</b> {dir} vào giờ này ngày mai. Lúc đó giá {price}.',
  '更高': 'tăng',
  '更低': 'giảm',
  '上一次猜 {coin}：{from} 到 {to}，她{verdict}。': 'Lần đoán trước với {coin}: từ {from} lên {to}, cô ấy {verdict}.',
  '说对了': 'đoán đúng',
  '说错了': 'đoán sai',
  '看盘记录 {right}/{total}': 'Kỷ lục đoán giá {right}/{total}',
  '每晚开播她会猜一次行情，第二天自动对答案。不是投资建议。': 'Mỗi tối live cô ấy đoán giá một lần, hôm sau tự đối chiếu. Không phải lời khuyên đầu tư.',
  '起个昵称，她会这样叫你': 'Chọn nickname, cô ấy sẽ gọi bạn như vậy',
  '比如：熬夜的老王': 'VD: cú đêm',
  '进来': 'Vào',
  '换个昵称': 'Đổi nickname',
  '点她做个动作': 'Bấm cho cô ấy làm động tác',
  '跟她说点什么': 'Nói gì đó với cô ấy',
  '发送': 'Gửi',
  '{name} 是 AI，她说的不是投资建议。': '{name} là AI, những gì cô ấy nói chỉ để giải trí.',
  // live text
  '每晚 {from}–{to}': 'Mỗi tối {from}–{to}',
  '网页': 'Web',
  '回复 <b>{who}</b>：{text}': 'Trả lời <b>{who}</b>: {text}',
  '刷到{src} <b>{who}</b>：{text}': 'Thấy trên {src} <b>{who}</b>: {text}',
  '刷到{src}：{text}': 'Thấy trên {src}: {text}',
  '广场': 'Binance Square',
  '推特': 'X',
  '快讯': 'tin nhanh',
  '热搜': 'hot search',
  '币安在推': 'Binance đang đẩy',
  '她回了': 'cô ấy đã trả lời',
  '还没人说话，第一句留给你。': 'Chưa ai nói gì, câu đầu tiên dành cho bạn.',
  '点了「{a}」': 'đã bấm: {a}',
  '你是 {name}。说话进弹幕，她挑着回。': 'Bạn là {name}. Nhắn lên bình luận, cô ấy sẽ chọn để trả lời.',
  '收到，她做完手上这句就来。': 'Nhận rồi, cô ấy nói xong câu này sẽ làm ngay.',
  '发出去了，她看到了。': 'Gửi rồi, cô ấy đã thấy.',
  '先起个昵称': 'Chọn nickname trước đã',
  '{m}月{d}日': 'ngày {d} tháng {m}',
  '出错了（{status}）': 'Có lỗi ({status})',
  '大脑': 'Não', '配音': 'Giọng', '画面': 'Hình ảnh', '公屏': 'Chat', '正常': 'OK', '出错': 'lỗi', '关闭': 'tắt',
  // moves (the host config may add more; a move without a Vietnamese name shows as written)
  '挥手': 'Vẫy tay', '比心': 'Thả tim', '眨眼': 'Nháy mắt', '捂脸': 'Che mặt', '飞吻': 'Hôn gió', '撒娇': 'Nũng nịu',
  '点头': 'Gật đầu', '歪头': 'Nghiêng đầu', '看手机': 'Xem điện thoại', '看屏幕': 'Nhìn màn hình', '指屏幕': 'Chỉ màn hình',
  '后仰笑': 'Cười ngửa ra', '托腮': 'Chống cằm', '撩头发': 'Hất tóc', '摊手': 'Xòe tay', '摇头': 'Lắc đầu',
  '伸懒腰': 'Vươn vai', '扶帽子': 'Chỉnh mũ', '捧脸笑': 'Ôm mặt cười', '惊讶': 'Ngạc nhiên', '叹气': 'Thở dài', '撇嘴': 'Bĩu môi',
  '得意笑': 'Cười đắc ý', '发呆': 'Ngẩn ngơ', '抿嘴笑': 'Mím môi cười', '眯眼笑': 'Nheo mắt cười', '憋笑': 'Nhịn cười',
  '低头笑': 'Cúi đầu cười', '眼睛一亮': 'Mắt sáng lên', '挑眉': 'Nhướng mày', '愣一下': 'Sững lại', '往上看想': 'Nhìn lên suy nghĩ',
  '眯眼琢磨': 'Nheo mắt ngẫm', '斜眼瞄': 'Liếc xéo', '小白眼': 'Lườm', '嘴角一撇': 'Nhếch mép', '坏笑': 'Cười ranh mãnh',
  '眼神变软': 'Ánh mắt dịu lại', '抿嘴点头': 'Mím môi gật đầu', '皱眉': 'Cau mày', '瞪一眼': 'Trừng mắt', '不好意思笑': 'Cười ngượng',
  '认真听': 'Lắng nghe', '瞄弹幕笑': 'Đọc bình luận, cười', '轻轻叹': 'Thở dài khẽ', '鼓腮': 'Phồng má', '摸下巴': 'Sờ cằm',
  '双手合十': 'Chắp tay', '握拳加油': 'Nắm tay cổ vũ', '拍手': 'Vỗ tay', '竖大拇指': 'Giơ ngón cái', '嘘': 'Suỵt',
  '凑近镜头': 'Ghé sát camera', '扶额': 'Ôm trán', '捂心口': 'Ôm ngực', '托腮笑': 'Chống cằm cười', '抱胸': 'Khoanh tay',
  '捂嘴笑': 'Che miệng cười', '打哈欠': 'Ngáp', '喝水': 'Uống nước',
  // moods
  '平静': 'Bình tĩnh', '开心': 'Vui', '兴奋': 'Phấn khích', '失落': 'Buồn', '暴躁': 'Cáu',
  '手势舞': 'Múa tay', '剪刀手': 'Chữ V', '转椅子': 'Xoay ghế', '站着挥手': 'Đứng vẫy tay', '站着转圈': 'Đứng xoay vòng', '站着跳舞': 'Đứng nhảy', '踏步拍手': 'Dậm chân vỗ tay', '站着比心': 'Đứng thả tim', '鞠躬': 'Cúi chào',
  // server errors
  '换个昵称：1 到 12 个字，不能带链接或“官方”“客服”': 'Đổi nickname khác: 1 đến 12 ký tự, không link, không chữ “chính thức” hay “chăm sóc khách hàng”',
  '没有登录': 'Chưa đăng nhập', '先进直播间': 'Chọn nickname trước đã', '先起个昵称进来': 'Chọn nickname trước đã',
  '没有这个动作': 'Cô ấy không biết động tác này', '她现在没在直播': 'Cô ấy đang không live',
  '点太快了，等她做完这个': 'Bấm nhanh quá, để cô ấy làm xong cái này đã', '点播排满了，过一会儿再点': 'Yêu cầu đang đầy, lát nữa bấm lại nhé',
  '说点什么再发': 'Viết gì đó rồi hãy gửi', '一条最多 80 个字': 'Tối đa 80 ký tự một dòng', '发太快了，8 秒一条': 'Gửi nhanh quá, 8 giây một dòng thôi', '发太快了，等一下': 'Gửi nhanh quá, đợi một chút',
  '这台设备进来的游客太多了，过一会儿再来': 'Thiết bị này vào nhiều quá rồi, lát nữa quay lại nhé',
  '请求格式不对': 'Yêu cầu sai định dạng', '服务器出错了': 'Server bị lỗi',
  // settings panel
  '设置': 'Cài đặt', 'AI 设置': 'Cài đặt AI', '正在用': 'Đang dùng',
  '还没接 key，模型是关的': 'Chưa gắn key, não đang tắt',
  '选 AI': 'Chọn AI', '模型': 'Model', '留空用默认模型': 'Để trống = model mặc định',
  'Key': 'Key', '已保存 key': 'Đã lưu key', '还没保存 key': 'Chưa lưu key',
  '保存': 'Lưu', '检查': 'Kiểm tra', '删 key': 'Xóa key',
  '正在保存…': 'Đang lưu…', '正在检查…': 'Đang kiểm tra…', '已保存': 'Đã lưu',
  'Key 跑起来了': 'Key chạy được', '先保存 key': 'Lưu key trước đã',
  '语音和画面': 'Giọng nói và khuôn mặt', '配音': 'Giọng nói', 'Edge（免费，不用 key）': 'Edge (miễn phí, không cần key)', 'Doubao（克隆音）': 'Doubao (giọng clone)', 'fal MiniMax': 'fal MiniMax', 'Edge 声音': 'Giọng Edge', 'VieNeu（离线，需 T Review 声卡）': 'VieNeu (offline, cần sidecar T Review)', 'VieNeu 声音': 'Giọng VieNeu', '配音 ID（Doubao）': 'ID giọng (Doubao)',
  '语音和画面在重启服务器后生效': 'Giọng nói và khuôn mặt áp dụng khi khởi động lại server',
  '关闭': 'Đóng', '没有权限': 'Không có quyền',
  // show acts (v5): shop, quiz, songs, quick commands, live push
  '她的商品': 'Sản phẩm', '买': 'Mua',
  '正在猜谜': 'Đang đố vui', '积分榜': 'Bảng điểm',
  '正在播': 'Đang phát', '歌单': 'Danh sách bài',
  '猜谜': 'Đố vui', '讲故事': 'Kể chuyện', '点歌': 'Hát bài',
  '推流设置': 'Cài đặt phát live', '推流地址（RTMP）': 'Địa chỉ RTMP', '推流密钥': 'Key phát live',
  '保存推流': 'Lưu phát live', '开始推流': 'Bắt đầu đẩy live', '停止推流': 'Dừng đẩy',
  // live function (v7): pick one act; OpenCode provider needs no key
  '直播功能': 'Chức năng live', '全部功能': 'Tất cả', '只聊天': 'Chỉ trò chuyện', '卖货': 'Bán hàng',
  '不用 key，key 在 OpenCode 里；先跑桥接。': 'Không cần key — key nằm trong OpenCode. Chạy cầu nối trước.',
  '推流地址和密钥从各平台的直播控制台复制（YouTube Studio / Facebook Live / TikTok Live Studio）': 'Lấy địa chỉ RTMP và key phát live trong phần live của từng nền tảng (YouTube Studio / Facebook Live / TikTok Live Studio)',
  '模拟模式：还没法推流真画面，需要 Vidu + Volc RTC 才能推流；先存 key 在这里，等跑真版时自动推。': 'Chế độ mock: chưa đẩy được hình thật, cần Vidu + Volc RTC mới đẩy được. Cứ lưu key ở đây, chạy bản thật là tự đẩy.',
  '已保存 {n} 个平台': 'Đã lưu {n} nền tảng', '正在推流': 'Đang đẩy live', '还没推流': 'Chưa đẩy',
  '还没填推流地址': 'Chưa nhập địa chỉ phát live', '推流密钥不对': 'Key phát live chưa đúng', '已保存推流设置': 'Đã lưu cài đặt phát live',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A saved choice wins; otherwise Chinese for a Chinese browser, Vietnamese for a
// Vietnamese browser, English for everything else.
function pick() {
  try { const v = localStorage.getItem(KEY); if (v === 'zh' || v === 'en' || v === 'vi') return v; } catch {}
  const langs = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  const first = String(langs[0] || '').toLowerCase();
  return first.startsWith('zh') ? 'zh' : first.startsWith('vi') ? 'vi' : 'en';
}
export let lang = pick();
export const dict = EN;
export const dictVi = VI;
let vars0 = {};

// Page-wide slots ({name}); a call's own vars win.
export function setVars(v) { vars0 = { ...vars0, ...v }; }

// The saved choice, if any, so the room can fall back to the host's own language.
export function savedLang() {
  try { const v = localStorage.getItem(KEY); return v === 'zh' || v === 'en' || v === 'vi' ? v : null; } catch { return null; }
}

export function t(zh, vars = {}) {
  vars = { ...vars0, ...vars };
  let s = lang === 'en' ? (EN[zh] ?? zh) : lang === 'vi' ? (VI[zh] ?? EN[zh] ?? zh) : zh;
  if (lang === 'en' && 'm' in vars) vars = { ...vars, mon: MONTHS[Number(vars.m) - 1] };
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// A text with a {slot} that is not known yet keeps the HTML's own default until it is.
const ready = key => [...key.matchAll(/\{(\w+)\}/g)].every(m => vars0[m[1]] != null && vars0[m[1]] !== '');

export function applyStatic(root = document) {
  document.documentElement.lang = lang === 'vi' ? 'vi' : lang === 'en' ? 'en' : 'zh-CN';
  for (const el of root.querySelectorAll('[data-i18n]')) if (ready(el.dataset.i18n)) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('*')) {
    for (const a of el.getAttributeNames()) if (a.startsWith('data-i18n-') && ready(el.getAttribute(a))) el.setAttribute(a.slice(10), t(el.getAttribute(a)));
  }
}

export function setLang(next) {
  lang = next;
  try { localStorage.setItem(KEY, next); } catch {}
  applyStatic();
}
