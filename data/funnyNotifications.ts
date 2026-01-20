export interface FunnyNotification {
  title: string;
  message: string;
  type: 'tingting' | 'survival' | 'drama' | 'reminder';
  iconName?: string; // Ionicons name for SVG icon
  soundKey?: string; // reference to assets/sounds/
  weight?: number; // priority weight for randomization (default: 1)
}

const funnyNotifications: FunnyNotification[] = [
  // --- TYPE: TINGTING (Giả danh ngân hàng/Biến động số dư - Tỷ lệ click cực cao) ---
  {
    title: "🔔 TK 190xxxxx: +50.000.000 VND",
    message: "...là số dư trong mơ của bạn. Còn thực tế còn bao nhiêu thì vào HugoKeeper check gấp!",
    type: "tingting",
    iconName: "card-outline",
    soundKey: "kaching.wav",
    weight: 2
  },
  {
    title: "💸 CẢNH BÁO: Phát hiện giao dịch lạ!",
    message: "Hình như bạn vừa rút ví mua trà sữa full topping? Khai báo ngay để được khoan hồng.",
    type: "tingting",
    iconName: "warning-outline",
    soundKey: "kaching.wav", // Money-related → kaching.wav
    weight: 1
  },
  {
    title: "📢 Ting ting! Lương đã về (trong tưởng tượng)",
    message: "Đừng để tiền lương vỗ cánh bay đi như người yêu cũ. Vào lập ngân sách ngay đi bạn ơi!",
    type: "tingting",
    iconName: "cash-outline",
    soundKey: "kaching.wav", // Salary-related → kaching.wav
    weight: 1
  },

  // --- TYPE: SURVIVAL (Chế độ sinh tồn/Cuối tháng) ---
  {
    title: "🍜 Thực đơn gợi ý: Mì tôm Hảo Hảo",
    message: "Dựa trên tốc độ tiêu tiền hiện tại, đây là món ăn duy nhất bạn có thể mua vào cuối tháng này. Hãm phanh lại ngay!",
    type: "survival",
    iconName: "restaurant-outline",
    soundKey: "kaching.wav", // Money-related → kaching.wav
    weight: 1
  },
  {
    title: "🆘 Alo, Tổng đài giải cứu ví tiền nghe!",
    message: "Ví của bạn đang kêu cứu vì bị móc quá nhiều. Hãy vào app vuốt ve an ủi nó đi.",
    type: "survival",
    iconName: "call-outline",
    soundKey: "kaching.wav", // Money-related → kaching.wav
    weight: 2
  },
  {
    title: "📉 Cột sống thì ổn, nhưng cột ví thì lệch",
    message: "Tình hình tài chính đang ở mức 'báo động đỏ'. Vào xem còn đủ tiền đổ xăng không nào?",
    type: "survival",
    iconName: "trending-down-outline",
    soundKey: "kaching.wav", // Money-related → kaching.wav
    weight: 1
  },

  // --- TYPE: DRAMA (Cà khịa/Tâm lý tình cảm) ---
  {
    title: "💔 Người yêu cũ có thể quên bạn...",
    message: "...nhưng nợ nần thì KHÔNG! Vào HugoKeeper kiểm tra xem sắp đến hạn trả nợ ai chưa?",
    type: "drama",
    iconName: "heart-dislike-outline",
    soundKey: "sad_trombone.wav",
    weight: 1
  },
  {
    title: "👻 Ơ kìa, tiền có chân à?",
    message: "Sao mới sáng còn đầy ví mà giờ đã đi đâu hết rồi? Vào truy nã những đồng tiền đi lạc ngay!",
    type: "drama",
    iconName: "footsteps-outline",
    soundKey: "mystery_sound.wav",
    weight: 1
  },
  {
    title: "🔮 Thầy bói phán: Hôm nay hao tài!",
    message: "Quẻ bói nói bạn sắp mất một khoản tiền lớn vào Shopee. Vào app ghi chép để giải hạn ngay.",
    type: "drama",
    iconName: "eye-outline",
    soundKey: "mystical_bell.wav",
    weight: 1
  },

  // --- TYPE: REMINDER (Nhắc nhở nhẹ nhàng nhưng thâm thúy) ---
  {
    title: "Đừng để tiền rơi 🎶",
    message: "Rơi tiền thì tiếc, nhưng quên ghi chép thì mất kiểm soát. 30 giây cuộc đời để log chi tiêu thôi bạn mình ơi!",
    type: "reminder",
    iconName: "arrow-down-circle-outline",
    soundKey: "soft_reminder.wav",
    weight: 1
  },
  {
    title: "Trí nhớ bạn tốt đấy! 🧠",
    message: "Nhưng chắc gì đã nhớ được 5.000đ gửi xe sáng nay? Đừng tin vào trí nhớ, hãy tin vào HugoKeeper.",
    type: "reminder",
    iconName: "brain-outline",
    soundKey: "gentle_bell.wav",
    weight: 1
  },
  {
    title: "Thiếu 1 người là ngàn lần nhớ... 💙",
    message: "Hôm nay thiếu mất 1 dòng giao dịch của Trung rồi. App buồn app khóc đó, vào dỗ app đi!",
    type: "reminder",
    iconName: "person-remove-outline",
    soundKey: "sad_piano.wav",
    weight: 1
  }
];

export default funnyNotifications;