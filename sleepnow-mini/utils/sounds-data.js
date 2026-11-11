// 助眠音频数据源（统一收口，便于后续从云存储下发 / 后台配置）
// ⚠️ 当前 src 为「开发测试用占位音频」（SoundHelix，长期稳定可播放），
//    仅用于验证「播放 / 后台播放 / 定时关闭」全链路，并非自然助眠声。
// 上线前必须替换为版权合规的助眠音频（雨声 / 海浪 / 白噪音等），
// 建议上传到 WorkBuddy 云存储，把 src 改为云存储返回的 URL。
module.exports = [
  { id: 1, name: '雨声', desc: '窗外小雨', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 2, name: '海浪', desc: '潮汐起伏', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 3, name: '白噪音', desc: '均匀沙沙', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 4, name: '森林', desc: '夜风林梢', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 5, name: '篝火', desc: '噼啪暖意', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
  { id: 6, name: '猫呼噜', desc: '安心陪伴', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
];
