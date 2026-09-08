export enum AppStep {
  HUB = 'HUB',
  PROFILE = 'PROFILE',
  IDEAS = 'IDEAS',
  BASICS = 'BASICS',
  SCHEDULE = 'SCHEDULE',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  IMAGE_PROMPTS = 'IMAGE_PROMPTS',
  CHAT_SETUP = 'CHAT_SETUP',
  SHARE = 'SHARE',
}

export interface OrganizerProfile {
  /** お名前（ニックネーム）。任意だが推奨入力 */
  organizerName: string;
  selfIntro: string;
  interests: string;
  /** どこで開催したいか: 対面 or オンライン（必須選択） */
  venuePreference: 'offline' | 'online';
  /** 対面の場合の開催したいエリア（例: 関東（東京）。オンライン時は空でよい） */
  desiredArea: string;
  /** 既に企画が決まっている場合のテーマ（任意。入力があれば後続はこれに沿う） */
  plannedTheme: string;
}

/** 企画案に紐づく「軽いMVV」= 会のコンセプト */
export interface IdeaConcept {
  purpose: string; // この会の目的（軽いミッション）
  persona: string; // 来てほしい人の具体像（ペルソナ）
  cherish: string[]; // 会で大切にしたいこと（2〜3個）
}

export type IdeaCategory = 'save' | 'earn' | 'protect' | 'grow' | 'use' | 'other';

// 旧カテゴリ値(classic/niche)や未知値を安全に正規化する。未知は 'other'
export function normalizeIdeaCategory(cat: string | undefined | null): IdeaCategory {
  const valid: IdeaCategory[] = ['save', 'earn', 'protect', 'grow', 'use', 'other'];
  return valid.includes(cat as IdeaCategory) ? (cat as IdeaCategory) : 'other';
}

export interface PlanIdea extends IdeaConcept {
  id: string;
  category: IdeaCategory;
  title: string;
  summary: string;
  venueHint: string;
  recommendedCapacity: number;
  firstTimerFriendlyPoint: string;
}

export type VenueType = 'online' | 'offline';

export interface CapacitySuggestion {
  recommended: number;
  min: number;
  max: number;
  reason: string;
}

export interface EventBasics {
  title: string;
  titleCandidates: string[];
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  durationMinutes: number;
  venueType: VenueType;
  /** オフライン時: リベシティ公式オフィスで開催する場合のオフィスkey（''=公式オフィス以外） */
  officeKey: string;
  venueDetail: string;
  capacity: number;
  capacitySuggestion: CapacitySuggestion | null;
  /** オンライン時の開催ツール: 'oVice' | 'Zoom' | 'Google Meet' | 'Teams' | 'other' | '' */
  onlineTool: string;
  /** onlineTool === 'other' のときの自由入力 */
  onlineToolOther: string;
}

export interface ScheduleItem {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
}

/** チャットアイコンのスタイル候補（3方向。プロンプトはコード側テンプレートで組み立てる） */
export interface IconStyleCandidate {
  key: 'text' | 'motif' | 'clay' | 'badge';
  label: string;
  /** このスタイルの完成プロンプト全文 */
  prompt: string;
}

export interface IconPromptResult {
  /** アイコンに載せる短いワード */
  word: string;
  /** オフ会を象徴するモチーフ（motif/clayスタイルで使用） */
  motif: string;
  /** プレビュー表示用の絵文字1つ */
  emoji: string;
  /** 会の雰囲気に合う配色。全スタイルへ同じものを渡し、アイコンの色が毎回ばらつかないようにする */
  colorPalette?: string;
  /** スタイル別のプロンプト候補 */
  candidates: IconStyleCandidate[];
  styleNote: string;
}

export interface ThumbnailAssets {
  imagePrompt: string;
}

export interface ShareTexts {
  regionalChat: string;
  tweet: string;
}

/** 告知文の文体レーン。standard=丁寧な標準版 / playful=文体で振り切った遊び心版。
 * 詳細（公開情報）と告知文で共通の1本のレーンとして扱い、
 * チャット作成へ流れる本文もこの選択に従う（食い違った文体で公開されるのを防ぐため） */
export type StyleLane = 'standard' | 'playful';

/** generateAnnouncement の戻り値（本文＋タグ） */
export interface AnnouncementResult {
  body: string;
  tags: string[];
}

/** 作業中オフ会のスナップショット（最大MAX_SAVED_EVENTS件までHubに保存） */
export interface EventSnapshot {
  idea: PlanIdea | null;
  concept: IdeaConcept | null;
  basics: EventBasics;
  schedule: ScheduleItem[];
  announcement: string;
  eventTags: string[];
  iconPrompt: IconPromptResult | null;
  thumbnailAssets: ThumbnailAssets | null;
  shareTexts: ShareTexts | null;
  offkaiChatUrl: string;
  maxReached: AppStep;
  /** 生成物が「どの上流入力から作られたか」の指紋。前工程の変更検知に使う */
  scheduleSourceKey: string;
  imagesSourceKey: string;
  announcementSourceKey: string;
  shareSourceKey: string;
  /** 詳細（公開情報）の「書き直してほしい点」の蓄積履歴（オフ会ごと） */
  announcementFeedbackHistory: string[];
  /** 進行イメージの「作り直してほしい点」の蓄積履歴（オフ会ごと） */
  scheduleFeedbackHistory: string[];
  /** 企画案の「こういうのがいい」の蓄積履歴（オフ会ごと） */
  ideasFeedbackHistory: string[];
  /** 告知文（支部チャット・つぶやき）の「書き直してほしい点」の蓄積履歴（オフ会ごと） */
  shareFeedbackHistory: string[];
  /** 告知サムネイルの「AIに修正指示」の蓄積履歴（オフ会ごと） */
  thumbnailFeedbackHistory: string[];
  /** 進行イメージ（時刻＋項目名）を詳細（公開情報）に載せるか（既定ON） */
  includeTimetableInAnnouncement: boolean;
  /** どちらの版を開いているか。ステップごとに独立して覚える
   *  （説明文は落ち着かせて宣伝文だけ振り切る、といった使い分けができるように） */
  announcementLane: StyleLane;
  chatSetupLane: StyleLane;
  shareLane: StyleLane;
  /** @deprecated 3ステップ独立化より前の共通レーン。読み込み時の移行にのみ使う */
  styleLane?: StyleLane;
  /** 遊び心版を作るときに選んでいる文体（ピルの選択状態。オフ会ごとに1つ） */
  playfulStylePreset: string;
  /** 遊び心版の文体の自由入力（未入力なら空） */
  playfulStyleCustom: string;
  /** 詳細の遊び心版が実際に作られたときの文体名。タブの表示に使う
   *  （その後に文体を選び直しても、既にある本文のラベルが嘘にならないように） */
  announcementPlayfulStyle: string;
  /** 告知の遊び心版が実際に作られたときの文体名 */
  sharePlayfulStyle: string;
  /** 遊び心版の詳細（公開情報）本文。標準版は announcement 側に入る */
  announcementPlayful: string;
  /** 遊び心版の詳細（公開情報）に対する「書き直してほしい点」の履歴 */
  announcementPlayfulFeedbackHistory: string[];
  /** 遊び心版の告知文（支部チャット・つぶやき） */
  shareTextsPlayful: ShareTexts | null;
  /** 遊び心版の告知文が「どの詳細文から作られたか」の指紋 */
  sharePlayfulSourceKey: string;
  /** 遊び心版の告知文に対する「書き直してほしい点」の履歴 */
  sharePlayfulFeedbackHistory: string[];
}

export interface SavedEvent {
  id: string;
  updatedAt: number;
  snapshot: EventSnapshot;
}
