import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AppStep,
  OrganizerProfile,
  IdeaConcept,
  PlanIdea,
  EventBasics,
  ScheduleItem,
  IconPromptResult,
  ThumbnailAssets,
  ShareTexts,
  EventSnapshot,
  SavedEvent,
} from './types';
import type { AnnouncementResult, StyleLane, SurveyPlan } from './types';
import { buildStyleDirective, playfulStyleLabel } from './textStyles';
import {
  saveToStorage,
  loadFromStorage,
  clearAllStorage,
  createDebouncedStorage,
} from './utils/storage';
import { APP_NAME } from './constants';
import Hub from './components/Hub';
import ProfileInput from './components/ProfileInput';
import IdeasStep from './components/IdeasStep';
import BasicsStep from './components/BasicsStep';
import ScheduleStep from './components/ScheduleStep';
import AnnouncementStep from './components/AnnouncementStep';
import ImagePromptStep from './components/ImagePromptStep';
import ChatSetupStep from './components/ChatSetupStep';
import ShareStep from './components/ShareStep';
import SurveyStep from './components/SurveyStep';
import {
  generatePlanIdeas,
  generateTitleCandidates,
  suggestCapacity,
  generateSchedule,
  reviseSchedule,
  generateAnnouncement,
  reviseAnnouncement,
  generateIconPrompt,
  buildIconPromptCandidates,
  generateSurveyPlan,
  generateThumbnailAssets,
  reviseThumbnailPrompt,
  generateShareTexts,
  AI_STUDIO_SESSION_KEY,
} from './services/geminiService';
import { formatDateJa, removeTimetableSection, buildTimetableSection, insertTimetableSection } from './utils/time';
import { MAX_PINNED_IDEAS, MAX_SAVED_EVENTS, officeLabel, GEMINI_API_KEY_PAGE_URL } from './constants';
import StepIndicator, { stepOrder } from './components/StepIndicator';
import LoadingOverlay from './components/LoadingOverlay';
import ErrorBoundary from './components/ErrorBoundary';
import { KeyIcon } from './components/icons';
import { EntakuLogo } from './components/Entaku';
import { confirmDialog, ConfirmDialogHost } from './utils/confirmDialog';
import { downloadBackup, parseBackup, applyBackup } from './utils/backup';

const INITIAL_PROFILE: OrganizerProfile = {
  organizerName: '',
  selfIntro: '',
  interests: '',
  venuePreference: 'offline',
  desiredArea: '',
  plannedTheme: '',
};

const INITIAL_BASICS: EventBasics = {
  title: '',
  titleCandidates: [],
  date: '',
  startTime: '19:00',
  durationMinutes: 120,
  venueType: 'offline',
  officeKey: '',
  venueDetail: '',
  capacity: 6,
  capacitySuggestion: null,
  onlineTool: '',
  onlineToolOther: '',
};

/** 旧バージョンの保存データにofficeKey等が無くても壊れないようにマージする */
function migrateBasics(stored: Partial<EventBasics> | null): EventBasics {
  return { ...INITIAL_BASICS, ...(stored || {}) };
}

/** 旧バージョンのiconPrompt（単一prompt形式）を3スタイル候補形式へ移行する */
function migrateIconPrompt(stored: (Partial<IconPromptResult> & { prompt?: string }) | null): IconPromptResult | null {
  if (!stored) return null;
  if (Array.isArray(stored.candidates) && stored.candidates.length > 0) return stored as IconPromptResult;
  const word = String(stored.word || '').trim();
  if (!word) return null;
  const motif = String(stored.motif || '').trim() || word;
  const colorPalette = String(stored.colorPalette || '').trim();
  return {
    word,
    motif,
    emoji: String(stored.emoji || '').trim() || '🎉',
    colorPalette,
    candidates: buildIconPromptCandidates(word, motif, colorPalette),
    styleNote: String(stored.styleNote || ''),
  };
}

/** 旧バージョンの保存データ（region・hostingConcern）を新フォーマットへ移行する */
function migrateProfile(
  stored: (Partial<OrganizerProfile> & { region?: string; hostingConcern?: string }) | null
): OrganizerProfile {
  if (!stored) return INITIAL_PROFILE;
  const { region, hostingConcern, ...rest } = stored;
  const migrated: OrganizerProfile = { ...INITIAL_PROFILE, ...rest };
  if (region && !migrated.desiredArea) {
    migrated.desiredArea = region;
  }
  return migrated;
}

// ── 前工程の変更検知（指紋） ──────────────────────────
// 各生成物が「どの上流入力から作られたか」を文字列化し、次に進む前に
// 現在の上流入力と食い違っていないかを比較する。食い違っていれば
// 「作り直しますか？」と確認する。
function basicsFingerprint(basics: EventBasics): string {
  return JSON.stringify({
    title: basics.title,
    date: basics.date,
    startTime: basics.startTime,
    durationMinutes: basics.durationMinutes,
    venueType: basics.venueType,
    officeKey: basics.officeKey,
    venueDetail: basics.venueDetail,
    capacity: basics.capacity,
    onlineTool: basics.onlineTool,
    onlineToolOther: basics.onlineToolOther,
  });
}
function conceptFingerprint(concept: IdeaConcept | null): string {
  return concept ? JSON.stringify(concept) : '';
}
function basicsConceptFingerprint(basics: EventBasics, concept: IdeaConcept | null): string {
  return `${basicsFingerprint(basics)}|${conceptFingerprint(concept)}`;
}
// 詳細（公開情報）の「作り直しますか？」判定は基本情報・コンセプトの変更のみで行う。
// スケジュール変更は「■当日の流れ」の機械差し替えのみで対応するため指紋から除外する。
function announcementSourceFingerprint(basics: EventBasics, concept: IdeaConcept | null): string {
  return basicsConceptFingerprint(basics, concept);
}
function shareSourceFingerprint(basics: EventBasics, announcement: string, regionHint: string): string {
  return `${basicsFingerprint(basics)}|${announcement}|${regionHint}`;
}

/** 支部チャット推定のための地域ヒント: 公式オフィス名、またはその他対面の会場テキスト（オンラインは空） */
function computeRegionHint(basics: EventBasics): string {
  if (basics.officeKey) return officeLabel(basics.officeKey);
  return basics.venueType === 'offline' ? basics.venueDetail : '';
}

/** 先行生成をまとめて投げると、1分あたりの上限にいっぺんに当たる。
 *  配布版は利用者全員が同じキーを共有するため、1人がボタンを押しただけでも
 *  4本同時だと上限に届いてしまう。順番に間隔を空けて投げて、山を作らない。 */
function runStaggered(tasks: Array<() => void>, intervalMs = 1800): void {
  tasks.forEach((task, i) => {
    if (i === 0) task();
    else setTimeout(task, intervalMs * i);
  });
}

/** APIキーがどこから来たか。認証エラーの原因切り分けに使う
 *  （手動保存したキーが古いまま残っていると、AI Studio側は正常でも権限エラーが出続けるため） */
type ApiKeySource = 'stored' | 'session' | 'env' | 'none';

const API_KEY_SOURCE_LABEL: Record<ApiKeySource, string> = {
  stored: '鍵アイコンから手動保存したキー',
  session: 'AI Studioのセッション（キーの用意は不要）',
  env: '環境変数のキー（AI Studioが用意したキーを含む）',
  none: '（キーが見つかっていません）',
};

/** キーが原因で失敗したエラーか。どのキーを使っているかを併記して切り分けられるようにする */
const API_KEY_ERROR_PATTERN = /利用権限がありません|APIキーが無効|APIキーが設定されていません|利用上限に達しました/;

function resolveAutoApiKey(): { key: string; source: ApiKeySource } {
  // 順序は実績のある SkillMarket Creator (PJ013/PJ015) と同一に揃える:
  // 環境変数（AI Studioがビルド時に用意するキーを含む）→ AI Studioセッション任せ。
  // window.aistudio.apiKey を自前で取り出して渡す旧方式は、アカウントによって
  // PERMISSION_DENIED になっていた（AI_STUDIO_SESSION_KEY のコメント参照）
  if (process.env.API_KEY) {
    return { key: process.env.API_KEY, source: 'env' };
  }
  if (process.env.GEMINI_API_KEY) {
    return { key: process.env.GEMINI_API_KEY, source: 'env' };
  }
  if (typeof window !== 'undefined' && (window as any).aistudio) {
    return { key: AI_STUDIO_SESSION_KEY, source: 'session' };
  }
  return { key: '', source: 'none' };
}

function getAutoApiKey(): string {
  return resolveAutoApiKey().key;
}

/** 保存済みステップが現在のフローに存在するか検証（旧MVVステップ等からの移行用） */
function loadValidStep(key: string, fallback: AppStep): AppStep {
  const stored = loadFromStorage<AppStep>(key);
  return stored && Object.values(AppStep).includes(stored) ? stored : fallback;
}

/** 標準版／遊び心版のどちらを開いているか。ステップごとに独立して持つ。
 *  3ステップ独立化より前は共通の styleLane 1つだったので、旧データはその値を初期値にする */
function loadLane(key: string): StyleLane {
  const stored = loadFromStorage<StyleLane>(key) ?? loadFromStorage<StyleLane>('styleLane');
  return stored === 'playful' ? 'playful' : 'standard';
}

function AppContent() {
  const [step, setStep] = useState<AppStep>(() => loadValidStep('step', AppStep.HUB));
  const [maxReached, setMaxReached] = useState<AppStep>(
    () => loadValidStep('maxReached', AppStep.PROFILE)
  );
  const [apiKey, setApiKey] = useState<string>(() => {
    // ユーザーが手動で保存したキーを最優先（AI Studioの自動注入キーより上位）
    const stored = loadFromStorage<string>('apiKey');
    const auto = getAutoApiKey();
    return stored || auto || '';
  });
  const [hasStoredApiKey, setHasStoredApiKey] = useState<boolean>(
    () => !!loadFromStorage<string>('apiKey')
  );
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  // いま実際に使っているキーの出所。手動保存キーは自動取得キーより優先されるため、
  // 古いキーが残っていると AI Studio 側が正常でも権限エラーが出続ける
  const autoApiKey = resolveAutoApiKey();
  const apiKeySource: ApiKeySource = hasStoredApiKey ? 'stored' : apiKey ? autoApiKey.source : 'none';
  const canFallBackToAutoKey = hasStoredApiKey && !!autoApiKey.key && autoApiKey.key !== apiKey;
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const apiKeyPanelRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingSourceText, setLoadingSourceText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<OrganizerProfile>(
    () => migrateProfile(loadFromStorage<OrganizerProfile>('profile'))
  );
  const [concept, setConcept] = useState<IdeaConcept | null>(
    () => loadFromStorage<IdeaConcept>('concept')
  );
  const [planIdeas, setPlanIdeas] = useState<PlanIdea[]>(
    () => loadFromStorage<PlanIdea[]>('planIdeas') || []
  );
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(
    () => loadFromStorage<string>('selectedIdeaId')
  );
  const [pinnedIds, setPinnedIds] = useState<string[]>(
    () => loadFromStorage<string[]>('pinnedIdeaIds') || []
  );
  // 確定した企画（企画案リストと切り離して保持。オフ会切替後もリスト再生成に影響されない）
  const [activeIdea, setActiveIdea] = useState<PlanIdea | null>(
    () => loadFromStorage<PlanIdea>('activeIdea')
  );
  // 保存済みオフ会（最大MAX_SAVED_EVENTS件）と、いま編集中のオフ会ID
  const [events, setEvents] = useState<SavedEvent[]>(
    () => loadFromStorage<SavedEvent[]>('events') || []
  );
  const [activeEventId, setActiveEventId] = useState<string | null>(
    () => loadFromStorage<string>('activeEventId')
  );
  const [basics, setBasics] = useState<EventBasics>(
    () => migrateBasics(loadFromStorage<EventBasics>('basics'))
  );
  const [schedule, setSchedule] = useState<ScheduleItem[]>(
    () => loadFromStorage<ScheduleItem[]>('schedule') || []
  );
  // 詳細（公開情報）は「標準版」「遊び心版」の2レーンを持つ。
  // 既存フィールド(announcement)をそのまま標準レーンの器として使うことで、保存済みデータの移行を不要にしている。
  const [announcementStandard, setAnnouncementStandard] = useState<string>(
    () => loadFromStorage<string>('announcement') || ''
  );
  const [announcementPlayful, setAnnouncementPlayful] = useState<string>(
    () => loadFromStorage<string>('announcementPlayful') || ''
  );
  // どちらの版を開いているかはステップごとに独立して覚える。
  // 詳細（チャットの説明文）は落ち着かせて、告知（宣伝文）だけ振り切る、といった使い分けができる。
  const [announcementLane, setAnnouncementLane] = useState<StyleLane>(() => loadLane('announcementLane'));
  const [chatSetupLane, setChatSetupLane] = useState<StyleLane>(() => loadLane('chatSetupLane'));
  const [shareLane, setShareLane] = useState<StyleLane>(() => loadLane('shareLane'));

  /** 「みんなへの案内」で選んだ版を、下流（チャットを立てる・みんなに知らせる）の初期選択にも配る。
   *  遊び心版を作ったのに次の画面が標準版で開くと、選び直しを毎回強いることになるため。
   *  各ステップの切り替えは残るので、あとから個別に変えられる。 */
  const applyAnnouncementLane = useCallback((lane: StyleLane) => {
    setAnnouncementLane(lane);
    setChatSetupLane(lane);
    setShareLane(lane);
  }, []);

  /** チャットに貼る版を変えたら、その後の告知文も同じ版で始める（公開物の文体を食い違わせないため） */
  const applyChatSetupLane = useCallback((lane: StyleLane) => {
    setChatSetupLane(lane);
    setShareLane(lane);
  }, []);
  // 遊び心版を作るときに選ぶ文体（オフ会ごとに1つ。ピルの選択状態）
  const [playfulStylePreset, setPlayfulStylePreset] = useState<string>(
    () => loadFromStorage<string>('playfulStylePreset') || ''
  );
  const [playfulStyleCustom, setPlayfulStyleCustom] = useState<string>(
    () => loadFromStorage<string>('playfulStyleCustom') || ''
  );
  // 各遊び心版が「実際にどの文体で作られたか」。後から文体を選び直してもタブの表示が嘘にならないように残す
  const [announcementPlayfulStyle, setAnnouncementPlayfulStyle] = useState<string>(
    () => loadFromStorage<string>('announcementPlayfulStyle') || ''
  );
  const [sharePlayfulStyle, setSharePlayfulStyle] = useState<string>(
    () => loadFromStorage<string>('sharePlayfulStyle') || ''
  );
  const [eventTags, setEventTags] = useState<string[]>(
    () => loadFromStorage<string[]>('eventTags') || []
  );
  const [iconPrompt, setIconPrompt] = useState<IconPromptResult | null>(
    () => migrateIconPrompt(loadFromStorage<IconPromptResult>('iconPrompt'))
  );
  const [thumbnailAssets, setThumbnailAssets] = useState<ThumbnailAssets | null>(
    () => loadFromStorage<ThumbnailAssets>('thumbnailAssets')
  );
  const [shareTextsStandard, setShareTextsStandard] = useState<ShareTexts | null>(
    () => loadFromStorage<ShareTexts>('shareTexts')
  );
  const [shareTextsPlayful, setShareTextsPlayful] = useState<ShareTexts | null>(
    () => loadFromStorage<ShareTexts>('shareTextsPlayful')
  );
  const [offkaiChatUrl, setOffkaiChatUrl] = useState<string>(
    () => loadFromStorage<string>('offkaiChatUrl') || ''
  );
  // 開催後アンケート（オフ会ごと）
  const [surveyPlan, setSurveyPlan] = useState<SurveyPlan | null>(
    () => loadFromStorage<SurveyPlan>('surveyPlan')
  );
  const [surveyLoading, setSurveyLoading] = useState(false);
  // 各生成物の「生成時点の上流入力」指紋（前工程の変更検知用）
  const [scheduleSourceKey, setScheduleSourceKey] = useState<string>(
    () => loadFromStorage<string>('scheduleSourceKey') || ''
  );
  const [imagesSourceKey, setImagesSourceKey] = useState<string>(
    () => loadFromStorage<string>('imagesSourceKey') || ''
  );
  const [announcementSourceKey, setAnnouncementSourceKey] = useState<string>(
    () => loadFromStorage<string>('announcementSourceKey') || ''
  );
  const [shareStandardSourceKey, setShareStandardSourceKey] = useState<string>(
    () => loadFromStorage<string>('shareSourceKey') || ''
  );
  const [sharePlayfulSourceKey, setSharePlayfulSourceKey] = useState<string>(
    () => loadFromStorage<string>('sharePlayfulSourceKey') || ''
  );
  // 「AIに書き直してほしい点」の蓄積履歴（オフ会ごと）
  const [announcementFeedbackHistory, setAnnouncementFeedbackHistory] = useState<string[]>(
    () => loadFromStorage<string[]>('announcementFeedbackHistory') || []
  );
  const [scheduleFeedbackHistory, setScheduleFeedbackHistory] = useState<string[]>(
    () => loadFromStorage<string[]>('scheduleFeedbackHistory') || []
  );
  // 企画案の「こういうのがいい」の蓄積履歴（オフ会ごと）
  const [ideasFeedbackHistory, setIdeasFeedbackHistory] = useState<string[]>(
    () => loadFromStorage<string[]>('ideasFeedbackHistory') || []
  );
  // 告知文（支部チャット・つぶやき）の「書き直してほしい点」の蓄積履歴（オフ会ごと）
  const [shareFeedbackHistory, setShareFeedbackHistory] = useState<string[]>(
    () => loadFromStorage<string[]>('shareFeedbackHistory') || []
  );
  // 遊び心レーンの要望履歴（標準レーンと混ざらないよう別枠で持つ）
  const [announcementPlayfulFeedbackHistory, setAnnouncementPlayfulFeedbackHistory] = useState<string[]>(
    () => loadFromStorage<string[]>('announcementPlayfulFeedbackHistory') || []
  );
  const [sharePlayfulFeedbackHistory, setSharePlayfulFeedbackHistory] = useState<string[]>(
    () => loadFromStorage<string[]>('sharePlayfulFeedbackHistory') || []
  );
  // 進行イメージ（時刻＋項目名）を詳細（公開情報）に載せるか（既定ON）
  const [includeTimetable, setIncludeTimetable] = useState<boolean>(
    () => loadFromStorage<boolean>('includeTimetableInAnnouncement') ?? true
  );
  // 告知サムネイルの「AIに修正指示」の蓄積履歴（オフ会ごと）
  const [thumbnailFeedbackHistory, setThumbnailFeedbackHistory] = useState<string[]>(
    () => loadFromStorage<string[]>('thumbnailFeedbackHistory') || []
  );

  // ---- レーンの派生値 ----
  // ステップごとに「いまそこで見ている版」を用意する。
  const announcement = announcementLane === 'playful' ? announcementPlayful : announcementStandard;
  // チャット作成は詳細本文をコピーするだけなので、遊び心版が無ければ標準版を出す
  const announcementForChatSetup =
    chatSetupLane === 'playful' && announcementPlayful ? announcementPlayful : announcementStandard;
  // 告知の遊び心版は、詳細の遊び心版が無ければ標準版を土台に文体だけ乗せて作る
  const announcementForShare =
    shareLane === 'playful' ? announcementPlayful || announcementStandard : announcementStandard;
  const shareTexts = shareLane === 'playful' ? shareTextsPlayful : shareTextsStandard;
  const shareSourceKey = shareLane === 'playful' ? sharePlayfulSourceKey : shareStandardSourceKey;
  const activeAnnouncementFeedback =
    announcementLane === 'playful' ? announcementPlayfulFeedbackHistory : announcementFeedbackHistory;
  const activeShareFeedback = shareLane === 'playful' ? sharePlayfulFeedbackHistory : shareFeedbackHistory;
  const playfulStyleDirective = buildStyleDirective(playfulStylePreset, playfulStyleCustom);
  // タブに出す文体名は、その版が実際に作られているときだけ。
  // まだ無いのに文体名を出すと、もう出来ているように見えてしまう
  const announcementLaneLabel = announcementPlayful ? announcementPlayfulStyle : '';
  const shareLaneLabel = shareTextsPlayful ? sharePlayfulStyle : '';

  /** 詳細ステップでいま開いている版の本文を書き換える（主催者の手編集・旧データの掃除用） */
  const setAnnouncementActive = useCallback(
    (value: React.SetStateAction<string>) => {
      if (announcementLane === 'playful') setAnnouncementPlayful(value);
      else setAnnouncementStandard(value);
    },
    [announcementLane]
  );

  /** 告知ステップでいま開いている版の文章とその指紋を書き換える */
  const setShareTextsActive = useCallback(
    (value: ShareTexts | null) => {
      if (shareLane === 'playful') setShareTextsPlayful(value);
      else setShareTextsStandard(value);
    },
    [shareLane]
  );
  const setShareSourceKeyActive = useCallback(
    (value: string) => {
      if (shareLane === 'playful') setSharePlayfulSourceKey(value);
      else setShareStandardSourceKey(value);
    },
    [shareLane]
  );

  /** 標準版が作り直されたとき、そこから派生している遊び心版は前提が変わるので白紙に戻す。
   *  文体の選択は残すので、遊び心タブに移ればワンクリックで作り直せる */
  const clearPlayfulLane = useCallback(() => {
    setAnnouncementPlayful('');
    setAnnouncementPlayfulStyle('');
    setAnnouncementPlayfulFeedbackHistory([]);
    setShareTextsPlayful(null);
    setSharePlayfulStyle('');
    setSharePlayfulFeedbackHistory([]);
    setSharePlayfulSourceKey('');
  }, []);

  // Scroll to top on step change
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  // 進行イメージ（時刻＋項目名）から公開用の「■当日の流れ」セクションを組み立てる
  const timetableSection = useMemo(
    () => (includeTimetable ? buildTimetableSection(basics.startTime, schedule) : ''),
    [includeTimetable, basics.startTime, schedule]
  );
  // チャット作成フォームへ貼る公開用の詳細文（トグルONなら当日の流れを自動挿入）
  const announcementForPublish = useMemo(
    () =>
      announcementForChatSetup && timetableSection
        ? insertTimetableSection(announcementForChatSetup, timetableSection)
        : announcementForChatSetup,
    [announcementForChatSetup, timetableSection]
  );

  // 詳細（公開情報）ステップに入るたびに「■当日の流れ」セクションが残っていないか掃除する。
  // 当日の流れは主催者だけが進行イメージのページで見る情報にし、公開情報には載せない。
  // 旧バージョンで保存されたオフ会（セクション入り）の移行もこれで吸収する。
  useEffect(() => {
    if (step === AppStep.ANNOUNCEMENT && announcement) {
      setAnnouncementActive((prev) => {
        const cleaned = removeTimetableSection(prev);
        return cleaned === prev ? prev : cleaned;
      });
    }
    // step変更時のみ発火させたいので依存はstepのみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Close API key dropdown on outside click / Esc
  useEffect(() => {
    if (!showApiKeyInput) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (apiKeyPanelRef.current && !apiKeyPanelRef.current.contains(e.target as Node)) {
        setShowApiKeyInput(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowApiKeyInput(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showApiKeyInput]);

  // Debounced storage writers for frequently-modified states
  const debouncedProfileRef = useRef<ReturnType<typeof createDebouncedStorage<OrganizerProfile>> | null>(null);
  const debouncedAnnouncementRef = useRef<ReturnType<typeof createDebouncedStorage<string>> | null>(null);
  const debouncedBasicsRef = useRef<ReturnType<typeof createDebouncedStorage<EventBasics>> | null>(null);
  const debouncedScheduleRef = useRef<ReturnType<typeof createDebouncedStorage<ScheduleItem[]>> | null>(null);

  useEffect(() => {
    if (!debouncedProfileRef.current) {
      debouncedProfileRef.current = createDebouncedStorage('profile', 800);
      debouncedAnnouncementRef.current = createDebouncedStorage('announcement', 800);
      debouncedBasicsRef.current = createDebouncedStorage('basics', 800);
      debouncedScheduleRef.current = createDebouncedStorage('schedule', 800);
    }
    debouncedProfileRef.current?.save(profile);
  }, [profile]);
  useEffect(() => { debouncedAnnouncementRef.current?.save(announcementStandard); }, [announcementStandard]);
  useEffect(() => { debouncedBasicsRef.current?.save(basics); }, [basics]);
  useEffect(() => { debouncedScheduleRef.current?.save(schedule); }, [schedule]);

  // Persist (immediate for less-frequently-modified states)
  useEffect(() => { saveToStorage('step', step); }, [step]);
  useEffect(() => { saveToStorage('maxReached', maxReached); }, [maxReached]);
  useEffect(() => { saveToStorage('concept', concept); }, [concept]);
  useEffect(() => { saveToStorage('planIdeas', planIdeas); }, [planIdeas]);
  useEffect(() => { saveToStorage('selectedIdeaId', selectedIdeaId); }, [selectedIdeaId]);
  useEffect(() => { saveToStorage('pinnedIdeaIds', pinnedIds); }, [pinnedIds]);
  useEffect(() => { saveToStorage('activeIdea', activeIdea); }, [activeIdea]);
  useEffect(() => { saveToStorage('iconPrompt', iconPrompt); }, [iconPrompt]);
  useEffect(() => { saveToStorage('thumbnailAssets', thumbnailAssets); }, [thumbnailAssets]);
  useEffect(() => { saveToStorage('shareTexts', shareTextsStandard); }, [shareTextsStandard]);
  useEffect(() => { saveToStorage('offkaiChatUrl', offkaiChatUrl); }, [offkaiChatUrl]);
  useEffect(() => { saveToStorage('eventTags', eventTags); }, [eventTags]);
  useEffect(() => { saveToStorage('events', events); }, [events]);
  useEffect(() => { saveToStorage('activeEventId', activeEventId); }, [activeEventId]);
  useEffect(() => { saveToStorage('scheduleSourceKey', scheduleSourceKey); }, [scheduleSourceKey]);
  useEffect(() => { saveToStorage('imagesSourceKey', imagesSourceKey); }, [imagesSourceKey]);
  useEffect(() => { saveToStorage('announcementSourceKey', announcementSourceKey); }, [announcementSourceKey]);
  useEffect(() => { saveToStorage('shareSourceKey', shareStandardSourceKey); }, [shareStandardSourceKey]);
  useEffect(() => { saveToStorage('announcementFeedbackHistory', announcementFeedbackHistory); }, [announcementFeedbackHistory]);
  useEffect(() => { saveToStorage('scheduleFeedbackHistory', scheduleFeedbackHistory); }, [scheduleFeedbackHistory]);
  useEffect(() => { saveToStorage('ideasFeedbackHistory', ideasFeedbackHistory); }, [ideasFeedbackHistory]);
  useEffect(() => { saveToStorage('shareFeedbackHistory', shareFeedbackHistory); }, [shareFeedbackHistory]);
  useEffect(() => { saveToStorage('includeTimetableInAnnouncement', includeTimetable); }, [includeTimetable]);
  useEffect(() => { saveToStorage('thumbnailFeedbackHistory', thumbnailFeedbackHistory); }, [thumbnailFeedbackHistory]);
  useEffect(() => { saveToStorage('announcementPlayful', announcementPlayful); }, [announcementPlayful]);
  useEffect(() => { saveToStorage('surveyPlan', surveyPlan); }, [surveyPlan]);
  useEffect(() => { saveToStorage('announcementLane', announcementLane); }, [announcementLane]);
  useEffect(() => { saveToStorage('chatSetupLane', chatSetupLane); }, [chatSetupLane]);
  useEffect(() => { saveToStorage('shareLane', shareLane); }, [shareLane]);
  useEffect(() => { saveToStorage('announcementPlayfulStyle', announcementPlayfulStyle); }, [announcementPlayfulStyle]);
  useEffect(() => { saveToStorage('sharePlayfulStyle', sharePlayfulStyle); }, [sharePlayfulStyle]);
  useEffect(() => { saveToStorage('playfulStylePreset', playfulStylePreset); }, [playfulStylePreset]);
  useEffect(() => { saveToStorage('playfulStyleCustom', playfulStyleCustom); }, [playfulStyleCustom]);
  useEffect(() => { saveToStorage('shareTextsPlayful', shareTextsPlayful); }, [shareTextsPlayful]);
  useEffect(() => { saveToStorage('sharePlayfulSourceKey', sharePlayfulSourceKey); }, [sharePlayfulSourceKey]);
  useEffect(() => { saveToStorage('announcementPlayfulFeedbackHistory', announcementPlayfulFeedbackHistory); }, [announcementPlayfulFeedbackHistory]);
  useEffect(() => { saveToStorage('sharePlayfulFeedbackHistory', sharePlayfulFeedbackHistory); }, [sharePlayfulFeedbackHistory]);

  // 編集中のオフ会スナップショットを保存済みイベントに同期
  useEffect(() => {
    if (!activeEventId) return;
    const snapshot: EventSnapshot = {
      idea: activeIdea,
      concept,
      basics,
      schedule,
      announcement: announcementStandard,
      eventTags,
      iconPrompt,
      thumbnailAssets,
      shareTexts: shareTextsStandard,
      offkaiChatUrl,
      surveyPlan,
      maxReached,
      scheduleSourceKey,
      imagesSourceKey,
      announcementSourceKey,
      shareSourceKey: shareStandardSourceKey,
      announcementFeedbackHistory,
      scheduleFeedbackHistory,
      ideasFeedbackHistory,
      shareFeedbackHistory,
      thumbnailFeedbackHistory,
      includeTimetableInAnnouncement: includeTimetable,
      announcementLane,
      chatSetupLane,
      shareLane,
      playfulStylePreset,
      playfulStyleCustom,
      announcementPlayfulStyle,
      sharePlayfulStyle,
      announcementPlayful,
      announcementPlayfulFeedbackHistory,
      shareTextsPlayful,
      sharePlayfulSourceKey,
      sharePlayfulFeedbackHistory,
    };
    setEvents((prev) =>
      prev.map((ev) => (ev.id === activeEventId ? { ...ev, updatedAt: Date.now(), snapshot } : ev))
    );
  }, [activeEventId, activeIdea, concept, basics, schedule, announcementStandard, eventTags, iconPrompt, thumbnailAssets, shareTextsStandard, offkaiChatUrl, surveyPlan, maxReached, scheduleSourceKey, imagesSourceKey, announcementSourceKey, shareStandardSourceKey, announcementFeedbackHistory, scheduleFeedbackHistory, ideasFeedbackHistory, shareFeedbackHistory, thumbnailFeedbackHistory, includeTimetable, announcementLane, chatSetupLane, shareLane, playfulStylePreset, playfulStyleCustom, announcementPlayfulStyle, sharePlayfulStyle, announcementPlayful, announcementPlayfulFeedbackHistory, shareTextsPlayful, sharePlayfulSourceKey, sharePlayfulFeedbackHistory]);

  const goToStep = useCallback((next: AppStep) => {
    setStep(next);
    setMaxReached((prev) => (stepOrder(next) > stepOrder(prev) ? next : prev));
  }, []);

  const handleSaveApiKey = () => {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) return;
    saveToStorage('apiKey', trimmed);
    setApiKey(trimmed);
    setHasStoredApiKey(true);
    setApiKeyDraft('');
    setShowApiKeyInput(false);
  };

  const handleClearApiKey = () => {
    saveToStorage('apiKey', '');
    localStorage.removeItem('offkai-creator-apiKey');
    const auto = getAutoApiKey();
    setApiKey(auto);
    setHasStoredApiKey(false);
    setApiKeyDraft('');
    setError(auto ? null : 'キーが見つかりません。Gemini APIキーを入力してください。');
    setShowApiKeyInput(false);
  };

  /** 編集中オフ会のワークスペースだけを空にする（プロフィール・企画案リストは残す） */
  const clearWorkspace = useCallback(() => {
    setActiveEventId(null);
    setActiveIdea(null);
    setConcept(null);
    setSelectedIdeaId(null);
    setBasics(INITIAL_BASICS);
    setSchedule([]);
    setAnnouncementStandard('');
    setEventTags([]);
    setIconPrompt(null);
    setThumbnailAssets(null);
    setSurveyPlan(null);
    setShareTextsStandard(null);
    setOffkaiChatUrl('');
    setMaxReached(AppStep.PROFILE);
    setScheduleSourceKey('');
    setImagesSourceKey('');
    setAnnouncementSourceKey('');
    setShareStandardSourceKey('');
    setAnnouncementFeedbackHistory([]);
    setScheduleFeedbackHistory([]);
    setIdeasFeedbackHistory([]);
    setShareFeedbackHistory([]);
    setThumbnailFeedbackHistory([]);
    setIncludeTimetable(true);
    setAnnouncementLane('standard');
    setChatSetupLane('standard');
    setShareLane('standard');
    setPlayfulStylePreset('');
    setPlayfulStyleCustom('');
    clearPlayfulLane();
  }, [clearPlayfulLane]);

  const handleReset = useCallback(async () => {
    const ok = await confirmDialog(
      '入力した内容・生成結果に加えて、保存済みのオフ会もすべて削除して初期化します。よろしいですか？'
    );
    if (!ok) return;
    const storedKey = loadFromStorage<string>('apiKey');
    clearAllStorage();
    if (storedKey) saveToStorage('apiKey', storedKey);
    setProfile(INITIAL_PROFILE);
    setPlanIdeas([]);
    setPinnedIds([]);
    setEvents([]);
    clearWorkspace();
    setStep(AppStep.PROFILE);
  }, [clearWorkspace]);

  /** 全データをJSONファイルとしてダウンロード（APIキーは含めない） */
  const handleExportBackup = useCallback(() => {
    // デバウンス書き込み待ちの編集内容を確定させてから出力する
    debouncedProfileRef.current?.flush();
    debouncedAnnouncementRef.current?.flush();
    debouncedBasicsRef.current?.flush();
    debouncedScheduleRef.current?.flush();
    downloadBackup();
  }, []);

  /** バックアップJSONを読み込んで全データを復元し、リロードして反映する */
  const handleImportBackup = useCallback(async (file: File) => {
    try {
      const backup = parseBackup(await file.text());
      const eventCount = Array.isArray(backup.data.events) ? backup.data.events.length : 0;
      const ok = await confirmDialog(
        `バックアップ（オフ会${eventCount}件）を読み込みます。いまこのブラウザに保存されている内容はすべて上書きされます。よろしいですか？`
      );
      if (!ok) return;
      applyBackup(backup);
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || 'バックアップの読み込みに失敗しました。');
    }
  }, []);

  /** 新しいオフ会の企画を開始（保存枠が埋まっている場合は開始できない） */
  const startNewEvent = useCallback(() => {
    if (events.length >= MAX_SAVED_EVENTS) {
      setError(
        `保存できるオフ会は最大${MAX_SAVED_EVENTS}件です。終了したオフ会をトップ画面で削除してから、新しいオフ会を企画してください。`
      );
      return;
    }
    clearWorkspace();
    setStep(AppStep.PROFILE);
  }, [events.length, clearWorkspace]);

  /** 保存済みオフ会を開いて編集を再開する */
  const openEvent = useCallback((id: string) => {
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    const s = ev.snapshot;
    setActiveEventId(id);
    setActiveIdea(s.idea);
    setConcept(s.concept);
    setSelectedIdeaId(s.idea?.id || null);
    setBasics(migrateBasics(s.basics));
    setSchedule(s.schedule || []);
    setAnnouncementStandard(s.announcement || '');
    setEventTags(s.eventTags || []);
    setIconPrompt(migrateIconPrompt(s.iconPrompt));
    setThumbnailAssets(s.thumbnailAssets);
    setShareTextsStandard(s.shareTexts);
    setOffkaiChatUrl(s.offkaiChatUrl || '');
    setSurveyPlan(s.surveyPlan || null);
    setMaxReached(s.maxReached || AppStep.BASICS);
    setScheduleSourceKey(s.scheduleSourceKey || '');
    setImagesSourceKey(s.imagesSourceKey || '');
    setAnnouncementSourceKey(s.announcementSourceKey || '');
    setShareStandardSourceKey(s.shareSourceKey || '');
    setAnnouncementFeedbackHistory(s.announcementFeedbackHistory || []);
    setScheduleFeedbackHistory(s.scheduleFeedbackHistory || []);
    setIdeasFeedbackHistory(s.ideasFeedbackHistory || []);
    setShareFeedbackHistory(s.shareFeedbackHistory || []);
    setThumbnailFeedbackHistory(s.thumbnailFeedbackHistory || []);
    setIncludeTimetable(s.includeTimetableInAnnouncement ?? true);
    // 遊び心レーン（2レーン化より前に保存されたオフ会には無いので、既定は標準レーン）
    // 旧スナップショット（共通レーン1つだった頃）は styleLane を3つの初期値に流用する
    const legacyLane: StyleLane = s.styleLane === 'playful' ? 'playful' : 'standard';
    setAnnouncementLane(s.announcementLane || legacyLane);
    setChatSetupLane(s.chatSetupLane || legacyLane);
    setShareLane(s.shareLane || legacyLane);
    setPlayfulStylePreset(s.playfulStylePreset || '');
    setPlayfulStyleCustom(s.playfulStyleCustom || '');
    setAnnouncementPlayfulStyle(s.announcementPlayfulStyle || '');
    setSharePlayfulStyle(s.sharePlayfulStyle || '');
    setAnnouncementPlayful(s.announcementPlayful || '');
    setAnnouncementPlayfulFeedbackHistory(s.announcementPlayfulFeedbackHistory || []);
    setShareTextsPlayful(s.shareTextsPlayful || null);
    setSharePlayfulSourceKey(s.sharePlayfulSourceKey || '');
    setSharePlayfulFeedbackHistory(s.sharePlayfulFeedbackHistory || []);
    setStep(s.maxReached || AppStep.BASICS);
  }, [events]);

  /** 保存済みオフ会を削除する（終了したオフ会の後片付け用） */
  const deleteEvent = useCallback(async (id: string) => {
    const ev = events.find((e) => e.id === id);
    const title = ev?.snapshot.basics.title || ev?.snapshot.idea?.title || 'このオフ会';
    const ok = await confirmDialog(`「${title}」を削除しますか？（元に戻せません）`);
    if (!ok) return;
    setEvents((prev) => prev.filter((e) => e.id !== id));
    if (activeEventId === id) clearWorkspace();
  }, [events, activeEventId, clearWorkspace]);

  const hasProgress =
    !!profile.selfIntro || !!concept || planIdeas.length > 0 || schedule.length > 0;

  /** APIキー未設定なら鍵パネルを開いてfalseを返す */
  const ensureApiKey = useCallback((): boolean => {
    if (apiKey) return true;
    setError('Gemini APIキーが設定されていません。画面右上の鍵アイコンから設定してください。');
    setShowApiKeyInput(true);
    return false;
  }, [apiKey]);

  const [suggestingCapacity, setSuggestingCapacity] = useState(false);

  const runGenerateTitles = useCallback(async (confirmedConcept?: IdeaConcept, ideaOverride?: PlanIdea) => {
    const useConcept = confirmedConcept || concept;
    const useIdea = ideaOverride || activeIdea;
    if (!ensureApiKey() || !useConcept || !useIdea) return;
    setLoading(true);
    setLoadingMessage('タイトル候補を考えています...');
    setLoadingSourceText(`${useIdea.title} ${useIdea.summary}`);
    setError(null);
    try {
      const titles = await generateTitleCandidates(apiKey, useConcept, useIdea);
      // タイトル候補はあくまで代替候補。title（企画案で選んだタイトル）は自動で上書きしない
      setBasics((prev) => ({
        ...prev,
        titleCandidates: titles,
      }));
    } catch (e: any) {
      setError(e?.message || 'タイトル候補の生成に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [apiKey, concept, activeIdea, ensureApiKey]);

  const runSuggestCapacity = useCallback(async () => {
    if (!ensureApiKey() || !activeIdea) return;
    setSuggestingCapacity(true);
    setError(null);
    try {
      const suggestion = await suggestCapacity(apiKey, activeIdea, basics);
      setBasics((prev) => ({
        ...prev,
        capacitySuggestion: suggestion,
        capacity: suggestion.recommended,
      }));
    } catch (e: any) {
      setError(e?.message || '定員の提案に失敗しました。');
    } finally {
      setSuggestingCapacity(false);
    }
  }, [apiKey, activeIdea, basics, ensureApiKey]);

  const runGenerateSchedule = useCallback(async (opts?: { confirm?: boolean; feedback?: string }) => {
    if (!ensureApiKey() || !concept || !activeIdea) return;
    const hasFeedback = !!opts?.feedback && opts.feedback.trim().length > 0;
    if (opts?.confirm && schedule.length > 0 && !hasFeedback) {
      const ok = await confirmDialog('当日の流れをAIで作り直すと、いまの編集内容は上書きされます。よろしいですか？');
      if (!ok) return;
    }
    setLoading(true);
    setLoadingMessage('タイムスケジュールを組み立てています...');
    setLoadingSourceText(`${basics.title} ${basics.durationMinutes}分 ${basics.capacity}人`);
    setError(null);
    try {
      if (hasFeedback) {
        // 「作り直してほしい点」指定時は、現在のscheduleをベースに、蓄積した指示履歴を反映して調整する
        // （ゼロから作り直さない。ユーザーの削除・並べ替えを尊重する）
        const nextHistory = [...scheduleFeedbackHistory, opts!.feedback!.trim()];
        const items = await reviseSchedule(apiKey, basics, concept, activeIdea, schedule, nextHistory);
        setSchedule(items.map((i) => ({ ...i, id: crypto.randomUUID() })));
        setScheduleFeedbackHistory(nextHistory);
      } else {
        // 基本情報変更起因の再生成等（feedback無し）はゼロから生成
        const items = await generateSchedule(apiKey, basics, concept, activeIdea);
        setSchedule(items.map((i) => ({ ...i, id: crypto.randomUUID() })));
      }
      setScheduleSourceKey(basicsConceptFingerprint(basics, concept));
    } catch (e: any) {
      setError(e?.message || '当日の流れの生成に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [apiKey, concept, activeIdea, basics, schedule, scheduleFeedbackHistory, ensureApiKey]);

  // 詳細（公開情報）は基本情報の完了時にバックグラウンドで先行生成し、待ち時間を減らす
  // （タイムテーブルを載せない方針にしたため、進行イメージの完成を待つ必要がなくなった）
  const [announcementLoading, setAnnouncementLoading] = useState(false);

  const runGenerateAnnouncement = useCallback(async (
    feedback: string,
    opts?: { silent?: boolean; skipConfirm?: boolean }
  ) => {
    const silent = !!opts?.silent;
    if (!concept || !activeIdea || announcementLoading) return;
    if (silent) {
      // 先行生成・バックグラウンド再生成: キー未設定なら黙って見送る
      if (!apiKey) return;
    } else if (!ensureApiKey()) {
      return;
    }
    const hasFeedback = !!feedback && feedback.trim().length > 0;
    const playful = announcementLane === 'playful';
    const currentBody = playful ? announcementPlayful : announcementStandard;
    // skipConfirm: 呼び出し側で既に「作り直しますか？」の確認を取っている場合は二重に聞かない
    if (!silent && !opts?.skipConfirm && currentBody && !hasFeedback) {
      const ok = await confirmDialog('詳細（公開情報）をAIで書き直すと、いまの編集内容は上書きされます。よろしいですか？');
      if (!ok) return;
    }
    setAnnouncementLoading(true);
    if (!silent) {
      setLoading(true);
      setLoadingMessage('詳細（公開情報）の文章を書いています...');
      setLoadingSourceText(`${basics.title} ${concept.purpose} ${concept.persona}`);
      setError(null);
    }
    try {
      if (hasFeedback && currentBody) {
        // 「書き直してほしい点」指定時は、現在表示中の詳細文をベースに、蓄積した指示履歴を反映して改訂する
        const nextHistory = [
          ...(playful ? announcementPlayfulFeedbackHistory : announcementFeedbackHistory),
          feedback.trim(),
        ];
        const result: AnnouncementResult = await reviseAnnouncement(
          apiKey,
          profile,
          currentBody,
          nextHistory,
          basics,
          playful ? playfulStyleDirective : ''
        );
        if (playful) {
          // タグは検索用で文体に左右されないため、標準版のものを両レーンで共有する
          setAnnouncementPlayful(result.body);
          setAnnouncementPlayfulFeedbackHistory(nextHistory);
        } else {
          setAnnouncementStandard(result.body);
          setEventTags(result.tags);
          setAnnouncementFeedbackHistory(nextHistory);
          clearPlayfulLane();
        }
      } else {
        // ゼロ生成は常に標準版を作る（遊び心版はそこから派生させ直す）
        const result: AnnouncementResult = await generateAnnouncement(
          apiKey,
          profile,
          concept,
          basics,
          formatDateJa(basics.date)
        );
        setAnnouncementStandard(result.body);
        setEventTags(result.tags);
        clearPlayfulLane();
        if (playful) setAnnouncementLane('standard');
      }
      setAnnouncementSourceKey(announcementSourceFingerprint(basics, concept));
    } catch (e: any) {
      // 先行生成の失敗は黙って見送る（詳細ステップで手動生成できる）
      if (!silent) setError(e?.message || '詳細（公開情報）の生成に失敗しました。');
    } finally {
      setAnnouncementLoading(false);
      if (!silent) setLoading(false);
    }
  }, [apiKey, profile, concept, activeIdea, basics, announcementLane, announcementStandard, announcementPlayful, announcementFeedbackHistory, announcementPlayfulFeedbackHistory, playfulStyleDirective, announcementLoading, clearPlayfulLane, ensureApiKey]);

  /** 標準版の詳細文を土台に「遊び心版」を作る（文体だけを変え、日時・場所などの事実は保つ）。
   *  ゼロから作り直すと事実が標準版とズレる危険があるため、必ず標準版からの変換にする */
  const runGeneratePlayfulAnnouncement = useCallback(async (preset: string, custom: string) => {
    if (!ensureApiKey() || announcementLoading) return;
    if (!announcementStandard) {
      setError('先に標準版の詳細（公開情報）を作ってください。');
      return;
    }
    const directive = buildStyleDirective(preset, custom);
    if (!directive) {
      setError('文体を選ぶか、どんな文体にしたいかを入力してください。');
      return;
    }
    setPlayfulStylePreset(preset);
    setPlayfulStyleCustom(custom);
    setAnnouncementLoading(true);
    setLoading(true);
    setLoadingMessage('遊び心版の詳細（公開情報）を書いています...');
    setLoadingSourceText(directive);
    setError(null);
    try {
      const result: AnnouncementResult = await reviseAnnouncement(
        apiKey,
        profile,
        announcementStandard,
        [],
        basics,
        directive
      );
      setAnnouncementPlayful(result.body);
      setAnnouncementPlayfulStyle(playfulStyleLabel(preset, custom));
      setAnnouncementPlayfulFeedbackHistory([]);
      applyAnnouncementLane('playful');
    } catch (e: any) {
      setError(e?.message || '遊び心版の生成に失敗しました。');
    } finally {
      setAnnouncementLoading(false);
      setLoading(false);
    }
  }, [apiKey, profile, basics, announcementStandard, announcementLoading, ensureApiKey, applyAnnouncementLane]);

  // 画像プロンプトは待ち時間を作らないため、グローバルオーバーレイを使わず
  // バックグラウンドで生成する（BASICS完了時に先行生成を開始）。
  const [iconLoading, setIconLoading] = useState(false);
  const [thumbLoading, setThumbLoading] = useState(false);

  const runGenerateIconPrompt = useCallback(async (opts?: { silent?: boolean }) => {
    if (!concept || !activeIdea || iconLoading) return;
    if (opts?.silent) {
      if (!apiKey) return;
    } else if (!ensureApiKey()) {
      return;
    }
    setIconLoading(true);
    if (!opts?.silent) setError(null);
    try {
      setIconPrompt(await generateIconPrompt(apiKey, concept, activeIdea, basics));
      setImagesSourceKey(basicsConceptFingerprint(basics, concept));
    } catch (e: any) {
      // 先行生成の失敗は黙って見送る（画像ステップで手動生成できる）
      if (!opts?.silent) setError(e?.message || 'アイコンプロンプトの生成に失敗しました。');
    } finally {
      setIconLoading(false);
    }
  }, [apiKey, concept, activeIdea, basics, iconLoading, ensureApiKey]);

  const runGenerateThumbnail = useCallback(async (opts?: { silent?: boolean }) => {
    if (!concept || !activeIdea || thumbLoading) return;
    if (opts?.silent) {
      if (!apiKey) return;
    } else if (!ensureApiKey()) {
      return;
    }
    setThumbLoading(true);
    if (!opts?.silent) setError(null);
    try {
      setThumbnailAssets(
        await generateThumbnailAssets(apiKey, concept, activeIdea, basics, formatDateJa(basics.date))
      );
      setImagesSourceKey(basicsConceptFingerprint(basics, concept));
    } catch (e: any) {
      if (!opts?.silent) setError(e?.message || 'サムネイル素材の生成に失敗しました。');
    } finally {
      setThumbLoading(false);
    }
  }, [apiKey, concept, activeIdea, basics, thumbLoading, ensureApiKey]);

  /** サムネイルプロンプトの修正（要望を蓄積して反映。現在のプロンプトをベースに調整する） */
  const runReviseThumbnail = useCallback(async (feedback: string) => {
    if (!ensureApiKey() || !thumbnailAssets || thumbLoading) return;
    const trimmed = feedback.trim();
    if (!trimmed) return;
    const nextHistory = [...thumbnailFeedbackHistory, trimmed];
    setThumbLoading(true);
    setError(null);
    try {
      setThumbnailAssets(
        await reviseThumbnailPrompt(apiKey, thumbnailAssets.imagePrompt, nextHistory, formatDateJa(basics.date))
      );
      setThumbnailFeedbackHistory(nextHistory);
    } catch (e: any) {
      setError(e?.message || 'サムネイルプロンプトの修正に失敗しました。');
    } finally {
      setThumbLoading(false);
    }
  }, [apiKey, thumbnailAssets, thumbLoading, thumbnailFeedbackHistory, basics, ensureApiKey]);

  /** アイコンに載せる文字を主催者が手で直す（3スタイルのプロンプトも組み立て直す） */
  const handleChangeIconWord = useCallback((word: string) => {
    setIconPrompt((prev) =>
      prev
        ? { ...prev, word, candidates: buildIconPromptCandidates(word, prev.motif, prev.colorPalette) }
        : prev
    );
  }, []);

  /** feedbackが空文字の場合は同条件での作り直し、それ以外は要望を反映して作り直す。
   *  遊び心版は、詳細の遊び心版があればそれを、無ければ標準版を土台に文体を乗せて作る
   *  （告知だけ振り切りたいときに、詳細ステップへ戻らなくて済むように）。
   *  styleは告知ステップで文体を選び直したときに渡す（stateの反映待ちを避けるため引数で受ける） */
  const runGenerateShareTexts = useCallback(async (
    feedback?: string,
    style?: { preset: string; custom: string }
  ) => {
    if (!ensureApiKey() || !announcementForShare) return;
    const playful = shareLane === 'playful';
    const preset = style ? style.preset : playfulStylePreset;
    const custom = style ? style.custom : playfulStyleCustom;
    const directive = style ? buildStyleDirective(preset, custom) : playfulStyleDirective;
    if (playful && !directive) {
      setError('文体を選ぶか、どんな文体にしたいかを入力してください。');
      return;
    }
    const trimmed = feedback?.trim();
    const baseHistory = playful ? sharePlayfulFeedbackHistory : shareFeedbackHistory;
    const nextHistory = trimmed ? [...baseHistory, trimmed] : baseHistory;
    if (style) {
      setPlayfulStylePreset(preset);
      setPlayfulStyleCustom(custom);
    }
    setLoading(true);
    setLoadingMessage('チャット・つぶやき用の文章を書いています...');
    setLoadingSourceText(announcementForShare.slice(0, 200));
    setError(null);
    const regionHint = computeRegionHint(basics);
    try {
      setShareTextsActive(
        await generateShareTexts(
          apiKey,
          announcementForShare,
          basics,
          regionHint,
          formatDateJa(basics.date),
          profile.organizerName,
          nextHistory,
          playful ? directive : ''
        )
      );
      if (trimmed) {
        if (playful) setSharePlayfulFeedbackHistory(nextHistory);
        else setShareFeedbackHistory(nextHistory);
      }
      if (playful) setSharePlayfulStyle(playfulStyleLabel(preset, custom));
      setShareSourceKeyActive(shareSourceFingerprint(basics, announcementForShare, regionHint));
    } catch (e: any) {
      setError(e?.message || '展開用文章の生成に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [apiKey, announcementForShare, basics, profile, shareLane, shareFeedbackHistory, sharePlayfulFeedbackHistory, playfulStylePreset, playfulStyleCustom, playfulStyleDirective, setShareTextsActive, setShareSourceKeyActive, ensureApiKey]);

  const runGenerateSurveyPlan = useCallback(async () => {
    if (!ensureApiKey() || !concept || !activeIdea || surveyLoading) return;
    setSurveyLoading(true);
    setError(null);
    try {
      setSurveyPlan(await generateSurveyPlan(apiKey, concept, activeIdea, basics, profile.organizerName));
    } catch (e: any) {
      setError(e?.message || 'アンケートの生成に失敗しました。');
    } finally {
      setSurveyLoading(false);
    }
  }, [apiKey, concept, activeIdea, basics, profile.organizerName, surveyLoading, ensureApiKey]);

  /** お礼メッセージだけを手直しする（貼り付けるコードにも即反映される） */
  const handleChangeThanks = useCallback((thanksMessage: string) => {
    setSurveyPlan((prev) => (prev ? { ...prev, thanksMessage } : prev));
  }, []);

  /** feedbackが空文字の場合は同条件での作り直し、それ以外は要望を反映して作り直す */
  const runGenerateIdeas = useCallback(async (feedback?: string) => {
    if (!ensureApiKey()) return;
    const trimmed = feedback?.trim();
    const nextHistory = trimmed ? [...ideasFeedbackHistory, trimmed] : ideasFeedbackHistory;
    setLoading(true);
    setLoadingMessage('企画のアイデアを考えています...');
    setLoadingSourceText(`${profile.selfIntro} ${profile.interests}`);
    setError(null);
    try {
      const ideas = await generatePlanIdeas(apiKey, profile, nextHistory);
      // ピン留めした案は再生成後も残す
      setPlanIdeas((prev) => [...prev.filter((i) => pinnedIds.includes(i.id)), ...ideas]);
      setSelectedIdeaId((prev) => (prev && pinnedIds.includes(prev) ? prev : null));
      if (trimmed) setIdeasFeedbackHistory(nextHistory);
      goToStep(AppStep.IDEAS);
    } catch (e: any) {
      setError(e?.message || '企画案の生成に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [apiKey, profile, pinnedIds, ideasFeedbackHistory, ensureApiKey, goToStep]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= MAX_PINNED_IDEAS) return prev; // 上限到達時は無視
      return [...prev, id];
    });
  }, []);

  const renderStep = () => {
    switch (step) {
      case AppStep.HUB:
        return (
          <Hub
            hasProgress={hasProgress}
            events={events}
            activeEventId={activeEventId}
            canCreate={events.length < MAX_SAVED_EVENTS}
            onStart={startNewEvent}
            onResume={() => setStep(maxReached)}
            onOpenEvent={openEvent}
            onDeleteEvent={deleteEvent}
            onReset={handleReset}
            onExport={handleExportBackup}
            onImport={handleImportBackup}
          />
        );
      case AppStep.PROFILE:
        return (
          <ProfileInput
            profile={profile}
            onChange={setProfile}
            // 2回目以降に押しても常に初期化・再生成する（古い企画案を暗黙に使い回さない）
            // 引数なしで呼ぶこと（ProfileInput側のonClickイベントをfeedbackとして渡さないため）
            onNext={() => runGenerateIdeas()}
          />
        );
      case AppStep.IDEAS:
        return (
          <IdeasStep
            ideas={planIdeas}
            selectedIdeaId={selectedIdeaId}
            pinnedIds={pinnedIds}
            plannedTheme={profile.plannedTheme}
            onSelect={setSelectedIdeaId}
            onTogglePin={togglePin}
            onRegenerate={runGenerateIdeas}
            feedbackHistory={ideasFeedbackHistory}
            onProceed={async (idea) => {
              // 保存枠の空きを確認（編集中のオフ会があればその枠を使う）
              if (!activeEventId && events.length >= MAX_SAVED_EVENTS) {
                setError(
                  `保存できるオフ会は最大${MAX_SAVED_EVENTS}件です。トップ画面で終了したオフ会を削除してから進めてください。`
                );
                return;
              }
              // 既存オフ会の企画を「別の案」に変更しようとしている場合、
              // 下流の生成物がすべて作り直し対象になることを確認する
              const isIdeaChange = !!activeEventId && activeIdea && activeIdea.id !== idea.id;
              const hasDownstream =
                schedule.length > 0 || !!announcementStandard || !!iconPrompt || !!thumbnailAssets || !!shareTextsStandard;
              if (isIdeaChange && hasDownstream) {
                const ok = await confirmDialog(
                  '企画を変更すると、当日の流れ・みんなへの案内・アイコンと画像・告知文をすべて作り直すことになります。よろしいですか？'
                );
                if (!ok) return;
              }
              // コンセプト（軽いMVV）は企画案から自動で引き継ぐ（編集UIは出さない）
              const derivedConcept = {
                purpose: idea.purpose,
                persona: idea.persona,
                cherish: idea.cherish,
              };
              setSelectedIdeaId(idea.id);
              setActiveIdea(idea);
              setConcept(derivedConcept);
              // 基本情報のタイトルは、企画案で選んだタイトルをそのまま初期値にする
              // （タイトル候補生成でtitleを上書きしないため、ここで確定させる）
              setBasics((prev) => ({ ...prev, title: idea.title }));
              if (isIdeaChange) {
                // 企画が変わったので下流の生成物をすべて空にし、作り直しの土台を作る
                setBasics((prev) => ({ ...prev, titleCandidates: [], capacitySuggestion: null }));
                setSchedule([]);
                setAnnouncementStandard('');
                setEventTags([]);
                setIconPrompt(null);
                setThumbnailAssets(null);
                setShareTextsStandard(null);
                setScheduleSourceKey('');
                setImagesSourceKey('');
                setAnnouncementSourceKey('');
                setShareStandardSourceKey('');
                setAnnouncementFeedbackHistory([]);
                setScheduleFeedbackHistory([]);
                setShareFeedbackHistory([]);
                setThumbnailFeedbackHistory([]);
                setAnnouncementLane('standard');
                setChatSetupLane('standard');
                setShareLane('standard');
                clearPlayfulLane();
              }
              if (!activeEventId) {
                // 新規オフ会の開始時のみ、プロフィールの開催希望をbasics.venueTypeへ反映する
                // （既存オフ会を編集中の場合は上書きしない）
                setBasics((prev) => ({ ...prev, venueType: profile.venuePreference }));
                // ここで初めて「1件のオフ会」として保存枠を確保する
                const id = crypto.randomUUID();
                setEvents((prev) => [
                  ...prev,
                  {
                    id,
                    updatedAt: Date.now(),
                    snapshot: {
                      idea,
                      concept: derivedConcept,
                      basics,
                      schedule,
                      announcement: announcementStandard,
                      eventTags,
                      iconPrompt,
                      thumbnailAssets,
                      shareTexts: shareTextsStandard,
                      offkaiChatUrl,
                      maxReached,
                      scheduleSourceKey: '',
                      imagesSourceKey: '',
                      announcementSourceKey: '',
                      shareSourceKey: '',
                      announcementFeedbackHistory: [],
                      scheduleFeedbackHistory: [],
                      ideasFeedbackHistory,
                      shareFeedbackHistory: [],
                      thumbnailFeedbackHistory: [],
                      includeTimetableInAnnouncement: includeTimetable,
                      announcementLane: 'standard',
                      chatSetupLane: 'standard',
                      shareLane: 'standard',
                      playfulStylePreset: '',
                      playfulStyleCustom: '',
                      announcementPlayfulStyle: '',
                      sharePlayfulStyle: '',
                      announcementPlayful: '',
                      announcementPlayfulFeedbackHistory: [],
                      shareTextsPlayful: null,
                      sharePlayfulSourceKey: '',
                      sharePlayfulFeedbackHistory: [],
                    },
                  },
                ]);
                setActiveEventId(id);
              }
              goToStep(AppStep.BASICS);
              // タイトル候補が未生成なら自動で提案
              if (basics.titleCandidates.length === 0 || isIdeaChange) runGenerateTitles(derivedConcept, idea);
            }}
            onBack={() => setStep(AppStep.PROFILE)}
          />
        );
      case AppStep.BASICS:
        return (
          <BasicsStep
            basics={basics}
            idea={activeIdea}
            onChange={setBasics}
            onRegenerateTitles={() => runGenerateTitles()}
            onSuggestCapacity={runSuggestCapacity}
            suggestingCapacity={suggestingCapacity}
            onNext={async () => {
              // 基本情報を変更した後だと、既存の進行イメージ・詳細（公開情報）・画像は前提が食い違っている可能性がある
              const currentKey = basicsConceptFingerprint(basics, concept);
              const scheduleStale =
                schedule.length > 0 && scheduleSourceKey !== '' && currentKey !== scheduleSourceKey;
              const imagesStale =
                (!!iconPrompt || !!thumbnailAssets) && imagesSourceKey !== '' && currentKey !== imagesSourceKey;
              const announcementStale =
                !!announcementStandard &&
                announcementSourceKey !== '' &&
                currentKey !== announcementSourceKey &&
                // 旧バージョン（schedule込み指紋）は新フォーマットを前方一致で含むため一致とみなす
                !announcementSourceKey.startsWith(`${currentKey}|`);
              if (scheduleStale || imagesStale || announcementStale) {
                const parts = [
                  scheduleStale && '当日の流れ',
                  announcementStale && 'みんなへの案内',
                  imagesStale && 'アイコンと画像',
                ].filter(Boolean);
                const ok = await confirmDialog(`「いつ・どこで？」の内容が変更されています。${parts.join('・')}を作り直しますか？`);
                if (ok) {
                  // 画面で待たせる「当日の流れ」を先に投げ、案内文は間隔を空けて続ける
                  runStaggered([
                    ...(scheduleStale ? [() => runGenerateSchedule()] : []),
                    ...(announcementStale ? [() => runGenerateAnnouncement('', { silent: true })] : []),
                  ]);
                  // アイコンと画像は2つ先のステップで使う。ここで作り直すと、
                  // その前にまた内容を変えられたときに二度手間になるうえ、
                  // 同じ瞬間に投げるリクエストが増えて利用上限に当たりやすくなる。
                  // 古い前提のものを捨てておき、そのステップに入ったときに作り直す
                  if (imagesStale) {
                    setIconPrompt(null);
                    setThumbnailAssets(null);
                    setImagesSourceKey('');
                  }
                } else {
                  // 作り直さない場合は「確認済み」として記録し、以後の誤検知を防ぐ
                  if (scheduleStale) setScheduleSourceKey(currentKey);
                  if (announcementStale) setAnnouncementSourceKey(currentKey);
                  if (imagesStale) setImagesSourceKey(currentKey);
                }
              } else {
                // 先行生成は「次に見るステップ」までにとどめる。
                // アイコンと画像は2つ先なので、ここでは作らない（作っても途中で前提が変わりやすく、
                // 一度に投げるリクエストが増えて利用上限に当たりやすくなるため）
                runStaggered([
                  ...(schedule.length === 0 ? [() => runGenerateSchedule()] : []),
                  ...(!announcementStandard ? [() => runGenerateAnnouncement('', { silent: true })] : []),
                ]);
              }
              goToStep(AppStep.SCHEDULE);
            }}
            onBack={() => setStep(AppStep.IDEAS)}
          />
        );
      case AppStep.SCHEDULE:
        return (
          <ScheduleStep
            schedule={schedule}
            basics={basics}
            onChange={setSchedule}
            onRegenerate={(feedback) => runGenerateSchedule({ confirm: true, feedback })}
            feedbackHistory={scheduleFeedbackHistory}
            includeTimetable={includeTimetable}
            onChangeIncludeTimetable={setIncludeTimetable}
            onNext={async () => {
              // 詳細（公開情報）にタイムテーブルは載せないため、scheduleの変更はここでは影響しない
              if (!announcementStandard) {
                // 先行生成が失敗/未実行だった場合のフォールバック（生成中ならそのまま進んで待つ）
                if (!announcementLoading) runGenerateAnnouncement('', { skipConfirm: true });
              } else {
                // 基本情報・コンセプトを変更した後だと、既存の詳細文は前提が食い違っている可能性がある
                // （ステップナビで直接ジャンプして基本情報を変えた場合などの保険）
                const currentKey = announcementSourceFingerprint(basics, concept);
                // 旧バージョン（schedule込み指紋）のannouncementSourceKeyは
                // 新フォーマット（basicsConcept指紋）を前方一致で含むため、それも一致とみなす
                const isLegacyMatch = announcementSourceKey.startsWith(`${currentKey}|`);
                const stale =
                  announcementSourceKey !== '' && currentKey !== announcementSourceKey && !isLegacyMatch;
                if (stale) {
                  const ok = await confirmDialog(
                    '「いつ・どこで？」の内容が変更されています。みんなへの案内を作り直しますか？'
                  );
                  if (ok) {
                    runGenerateAnnouncement('', { skipConfirm: true });
                  } else {
                    setAnnouncementSourceKey(currentKey);
                  }
                }
              }
              goToStep(AppStep.ANNOUNCEMENT);
            }}
            onBack={() => setStep(AppStep.BASICS)}
          />
        );
      case AppStep.ANNOUNCEMENT:
        return (
          <AnnouncementStep
            announcement={announcement}
            venueType={basics.venueType}
            loading={announcementLoading}
            onChange={setAnnouncementActive}
            onRegenerate={runGenerateAnnouncement}
            feedbackHistory={activeAnnouncementFeedback}
            timetableSection={timetableSection}
            styleLane={announcementLane}
            onChangeLane={applyAnnouncementLane}
            standardReady={!!announcementStandard}
            playfulStylePreset={playfulStylePreset}
            playfulStyleCustom={playfulStyleCustom}
            playfulLabel={announcementLaneLabel}
            onGeneratePlayful={runGeneratePlayfulAnnouncement}
            onNext={() => {
              goToStep(AppStep.IMAGE_PROMPTS);
              // アイコンと画像はここで用意する（次に開く画面で使うため）。
              // 2本を同時に投げず間隔を空けて、利用上限に当たりにくくする
              runStaggered([
                ...(!iconPrompt ? [() => runGenerateIconPrompt({ silent: true })] : []),
                ...(!thumbnailAssets ? [() => runGenerateThumbnail({ silent: true })] : []),
              ]);
            }}
            onBack={() => setStep(AppStep.SCHEDULE)}
          />
        );
      case AppStep.IMAGE_PROMPTS:
        return (
          <ImagePromptStep
            iconPrompt={iconPrompt}
            thumbnailAssets={thumbnailAssets}
            iconLoading={iconLoading}
            thumbnailLoading={thumbLoading}
            onChangeIconWord={handleChangeIconWord}
            onGenerateIcon={() => runGenerateIconPrompt()}
            onGenerateThumbnail={() => runGenerateThumbnail()}
            onReviseThumbnail={runReviseThumbnail}
            thumbnailFeedbackHistory={thumbnailFeedbackHistory}
            onNext={() => goToStep(AppStep.CHAT_SETUP)}
            onBack={() => setStep(AppStep.ANNOUNCEMENT)}
          />
        );
      case AppStep.CHAT_SETUP:
        return (
          <ChatSetupStep
            basics={basics}
            announcement={announcementForPublish}
            eventTags={eventTags}
            styleLane={chatSetupLane}
            onChangeLane={applyChatSetupLane}
            playfulAvailable={!!announcementPlayful}
            playfulLabel={announcementPlayfulStyle}
            onNext={async () => {
              // 詳細（公開情報）を書き直した後だと、既存の展開用文章は前提が食い違っている可能性がある
              const currentKey = shareSourceFingerprint(basics, announcementForShare, computeRegionHint(basics));
              const stale = !!shareTexts && shareSourceKey !== '' && currentKey !== shareSourceKey;
              if (stale) {
                const ok = await confirmDialog('詳細（公開情報）が変更されています。展開用の文章を作り直しますか？');
                if (ok) {
                  runGenerateShareTexts();
                } else {
                  setShareSourceKeyActive(currentKey);
                }
              } else if (!shareTexts) {
                runGenerateShareTexts();
              }
              goToStep(AppStep.SHARE);
            }}
            onBack={() => setStep(AppStep.IMAGE_PROMPTS)}
          />
        );
      case AppStep.SHARE:
        return (
          <ShareStep
            shareTexts={shareTexts}
            basics={basics}
            region={computeRegionHint(basics)}
            offkaiChatUrl={offkaiChatUrl}
            announcement={announcementForShare}
            organizerName={profile.organizerName}
            onChangeChatUrl={setOffkaiChatUrl}
            onGenerate={runGenerateShareTexts}
            feedbackHistory={activeShareFeedback}
            styleLane={shareLane}
            onChangeLane={setShareLane}
            playfulAvailable={!!announcementStandard || !!announcementPlayful}
            playfulLabel={shareLaneLabel}
            playfulStylePreset={playfulStylePreset}
            playfulStyleCustom={playfulStyleCustom}
            onBack={() => setStep(AppStep.CHAT_SETUP)}
            onFinish={() => {
              goToStep(AppStep.SURVEY);
              // 開催後に配るものなので、この画面へ来た人にだけ用意する
              if (!surveyPlan) runGenerateSurveyPlan();
            }}
          />
        );
      case AppStep.SURVEY:
        return (
          <SurveyStep
            surveyPlan={surveyPlan}
            loading={surveyLoading}
            onGenerate={runGenerateSurveyPlan}
            onChangeThanks={handleChangeThanks}
            onFinish={() => setStep(AppStep.HUB)}
            onBack={() => setStep(AppStep.SHARE)}
          />
        );
      default:
        // 各ステップはP3以降で実装
        return (
          <div className="max-w-2xl mx-auto py-16 text-center animate-fade-in">
            <p className="text-slate-500 text-sm mb-6">このステップは準備中です（{step}）</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setStep(AppStep.HUB)}
                className="px-5 py-2 rounded-full bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                トップへ戻る
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen paper-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <button
            onClick={() => setStep(AppStep.HUB)}
            className="flex items-center gap-2 text-slate-800 font-bold hover:opacity-80 transition-opacity"
          >
            <EntakuLogo size={20} />
            {APP_NAME}
          </button>

          <div className="relative" ref={apiKeyPanelRef}>
            <button
              onClick={() => setShowApiKeyInput((v) => !v)}
              className={`p-2 rounded-full transition-colors ${
                apiKey ? 'text-sky-600 hover:bg-sky-50' : 'text-red-500 hover:bg-red-50'
              }`}
              title="Gemini APIキー設定"
              aria-label="Gemini APIキー設定"
            >
              <KeyIcon size={18} />
            </button>
            {showApiKeyInput && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl p-4 z-50">
                <p className="text-sm font-semibold text-slate-700 mb-1">Gemini APIキー</p>
                <p className="text-xs text-slate-500 mb-1">
                  いま使っているキー: <span className="font-semibold text-slate-700">{API_KEY_SOURCE_LABEL[apiKeySource]}</span>
                </p>
                <p className="text-xs text-slate-500 mb-3">
                  {apiKeySource === 'stored'
                    ? '手動保存したキーは自動取得のキーより優先されます。権限エラーが出る場合は、下の「保存したキーを削除」でAI Studioのキーに戻せます。'
                    : apiKey
                      ? '別のキーを使う場合は下に入力してください。'
                      : 'Gemini APIキーを入力してください。'}
                </p>
                <a
                  href={GEMINI_API_KEY_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors mb-2"
                >
                  自分のAPIキーを無料で作る（別タブ）
                </a>
                <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                  Googleアカウントでログインして「Create API key」を押すと作れます。
                  作ったキー（AIza… で始まる文字列）を下に貼り付けてください。
                </p>
                <input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                  placeholder="AIza..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 mb-2"
                />
                <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                  キーはこのブラウザにのみ保存され、外部には送信されません（バックアップにも含まれません）。
                  他の人には教えないでください。
                </p>
                <div className="flex justify-end gap-2">
                  {hasStoredApiKey && (
                    <button
                      onClick={handleClearApiKey}
                      className="px-3 py-1.5 text-xs rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      保存したキーを削除
                    </button>
                  )}
                  <button
                    onClick={handleSaveApiKey}
                    disabled={!apiKeyDraft.trim()}
                    className="px-4 py-1.5 text-xs rounded-full bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-40 transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {step !== AppStep.HUB && (
          <div className="max-w-4xl mx-auto px-4">
            <StepIndicator current={step} maxReached={maxReached} onNavigate={setStep} />
          </div>
        )}
      </header>

      {/* Error banner */}
      {error && (
        <div className="max-w-4xl mx-auto px-4 mt-4">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-red-700 whitespace-pre-wrap">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600 text-sm font-bold shrink-0"
                aria-label="エラーを閉じる"
              >
                ✕
              </button>
            </div>
            {API_KEY_ERROR_PATTERN.test(error) && (
              <div className="mt-2.5 pt-2.5 border-t border-red-200">
                <p className="text-xs text-red-700/80">
                  いま使っているキー: {API_KEY_SOURCE_LABEL[apiKeySource]}
                </p>
                <p className="mt-1 text-xs text-red-700/80">
                  自分のGoogleアカウントで無料のAPIキーを作り、画面右上の鍵アイコンから設定すると使えるようになります。
                </p>
                <a
                  href={GEMINI_API_KEY_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
                >
                  自分のAPIキーを無料で作る（別タブ）
                </a>
                {canFallBackToAutoKey && (
                  <>
                    <p className="mt-1 text-xs text-red-700/80">
                      手動保存したキーは自動取得のキーより優先されます。古いキーや別アカウントのキーが残っていると、
                      AI Studio側が正常でもこのエラーが出続けます。
                    </p>
                    <button
                      onClick={handleClearApiKey}
                      className="mt-2 inline-flex items-center px-4 py-1.5 rounded-full bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors"
                    >
                      保存したキーを削除して、AI Studioのキーに戻す
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 pb-16">{renderStep()}</main>

      {loading && <LoadingOverlay message={loadingMessage} sourceText={loadingSourceText} />}
      <ConfirmDialogHost />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
