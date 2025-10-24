
// -----------------------------
// 전역 상수
// -----------------------------


export const PLAYER1 = {
    MAX_HP: 30,
  };

export const PLAYER2 = {
    MAX_HP: 25,
  };
  // UI 레이아웃/크기
  export const UI = {
    HPBAR: { W: 160, H: 10 },   //체력바 크기
    PADDING: { RIGHT: 16, TOP: 12, GAP: 6 },    // 화면 우측 상단 여백/간격
    SKILL_ICON_SIZE: 20,    //스킬 아이콘(쿨다운 원형 마스크) 한 변 길이
  };
  
  export const GAME = {
    TILE_SIZE: 16,
    CAMERA_ZOOM: 1.5,
    PHYSICS_DEBUG: false,
    RESPAWN_COUNTDOWN: 10,
    START_TILE: {X:13, Y:55},

    // 이동 관련 타이밍
  MOVE_DURATION: 200,       // 격자 이동 1칸 시간(ms)
  HOLD_REPEAT_DELAY: 180,   // 키 홀드 시 다음 입력 간격(ms)
  }