import type {
  OrganizerProfile,
  IdeaConcept,
  PlanIdea,
  VenueType,
  CapacitySuggestion,
  EventBasics,
  ScheduleItem,
  IconPromptResult,
  IconStyleCandidate,
  ThumbnailAssets,
  ShareTexts,
  AnnouncementResult,
} from '../types';

export const AI_STUDIO_SESSION_KEY = '__aistudio-session__';

async function postApi<T>(endpoint: string, body: any): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errMessage = 'AIとの通信中にエラーが発生しました';
    try {
      const errData = await res.json();
      if (errData?.error) errMessage = errData.error;
    } catch {
      errMessage = `HTTP error ${res.status}: ${res.statusText}`;
    }
    throw new Error(errMessage);
  }
  return res.json();
}

export function extractJSON(text: string): any {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    const start = jsonStr.indexOf('{');
    const startArr = jsonStr.indexOf('[');
    const idx = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
    if (idx === -1) throw new Error('AIの応答からJSONを解析できませんでした');
    const sub = jsonStr.slice(idx);
    try {
      return JSON.parse(sub);
    } catch {
      throw new Error('AIの応答が途中で切れたため、JSONを解析できませんでした。再度お試しください。');
    }
  }
}

export function venueLabelOf(basics: EventBasics): string {
  if (basics.venueType !== 'online') return basics.venueDetail;
  if (!basics.onlineTool) return 'オンライン';
  const toolName = basics.onlineTool === 'other' ? basics.onlineToolOther : basics.onlineTool;
  return toolName ? `オンライン（${toolName}）` : 'オンライン';
}

const ICON_PROMPT_BASE = `あなたはプロのデザイナーです。オフ会のSNS用チャットアイコンをデザインしてください。
・完全な円形のアイコン
・モチーフ・文字などすべての要素を円の内側に完全に収めること（円からは絶対にはみ出させない。円の縁との間に余白を残す）
・小さく表示されても一目で内容が伝わる視認性とコントラスト
・ごちゃつかせない`;

export function buildIconPromptCandidates(word: string, motif: string): IconStyleCandidate[] {
  return [
    {
      key: 'text',
      label: '文字メイン',
      prompt: `${ICON_PROMPT_BASE}
・背景はシンプル（無地〜ゆるやかなグラデーション。細かい描写・イラストは入れない）
・中央に「${word}」という文字を大きく・はっきり・読みやすく配置（文字がアイコンの主役）
・装飾は最小限`,
    },
    {
      key: 'motif',
      label: 'モチーフ＋文字',
      prompt: `${ICON_PROMPT_BASE}
・背景はシンプル（無地〜ゆるやかなグラデーション）
・中央に「${motif}」のモチーフを大きく描く（アイコンの主役）
・モチーフの下に「${word}」という文字を、一字一句このまま・読みやすく添える`,
    },
    {
      key: 'clay',
      label: 'ぷっくり3D',
      prompt: `${ICON_PROMPT_BASE}
・「${motif}」のモチーフを、ぷっくりとした3D（クレイ調で丸みがあり、柔らかく可愛い立体感のあるスタイル）で大きく描く
・「${word}」という文字を、一字一句このまま・読みやすく配置する
・明るく親しみやすい配色`,
    },
  ];
}

export async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const data = await postApi<{ text: string }>('/api/gemini/call', { apiKey, prompt });
  return data.text;
}

export async function generatePlanIdeas(
  apiKey: string,
  profile: OrganizerProfile,
  feedbackHistory: string[] = []
): Promise<PlanIdea[]> {
  return postApi<PlanIdea[]>('/api/gemini/generate-plan-ideas', { apiKey, profile, feedbackHistory });
}

export async function generateTitleCandidates(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea
): Promise<string[]> {
  return postApi<string[]>('/api/gemini/generate-title-candidates', { apiKey, concept, idea });
}

export async function suggestCapacity(
  apiKey: string,
  idea: PlanIdea,
  venueTypeOrBasics: VenueType | EventBasics,
  venueDetail?: string,
  durationMinutes?: number
): Promise<CapacitySuggestion> {
  return postApi<CapacitySuggestion>('/api/gemini/suggest-capacity', {
    apiKey,
    idea,
    venueTypeOrBasics,
    venueDetail,
    durationMinutes,
  });
}

export async function generateSchedule(
  apiKey: string,
  basics: EventBasics,
  concept: IdeaConcept,
  idea: PlanIdea
): Promise<Omit<ScheduleItem, 'id'>[]> {
  return postApi<Omit<ScheduleItem, 'id'>[]>('/api/gemini/generate-schedule', { apiKey, basics, concept, idea });
}

export async function reviseSchedule(
  apiKey: string,
  basics: EventBasics,
  concept: IdeaConcept,
  idea: PlanIdea,
  currentSchedule: ScheduleItem[],
  feedbackHistory: string[]
): Promise<Omit<ScheduleItem, 'id'>[]> {
  return postApi<Omit<ScheduleItem, 'id'>[]>('/api/gemini/revise-schedule', {
    apiKey,
    basics,
    concept,
    idea,
    currentSchedule,
    feedbackHistory,
  });
}

export async function generateAnnouncement(
  apiKey: string,
  profile: OrganizerProfile,
  concept: IdeaConcept,
  basics: EventBasics,
  formattedDate: string
): Promise<AnnouncementResult> {
  return postApi<AnnouncementResult>('/api/gemini/generate-announcement', {
    apiKey,
    profile,
    concept,
    basics,
    formattedDate,
  });
}

export async function reviseAnnouncement(
  apiKey: string,
  profile: OrganizerProfile,
  currentAnnouncement: string,
  feedbackHistory: string[],
  basics: EventBasics,
  styleDirective = ''
): Promise<AnnouncementResult> {
  return postApi<AnnouncementResult>('/api/gemini/revise-announcement', {
    apiKey,
    profile,
    currentAnnouncement,
    feedbackHistory,
    basics,
    styleDirective,
  });
}

export async function generateIconPrompt(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea,
  basics: EventBasics
): Promise<IconPromptResult> {
  return postApi<IconPromptResult>('/api/gemini/generate-icon-prompt', { apiKey, concept, idea, basics });
}

export async function generateThumbnailAssets(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea,
  basics: EventBasics,
  formattedDate: string
): Promise<ThumbnailAssets> {
  return postApi<ThumbnailAssets>('/api/gemini/generate-thumbnail-assets', {
    apiKey,
    concept,
    idea,
    basics,
    formattedDate,
  });
}

export async function reviseThumbnailPrompt(
  apiKey: string,
  currentPrompt: string,
  feedbackHistory: string[],
  formattedDate: string
): Promise<ThumbnailAssets> {
  return postApi<ThumbnailAssets>('/api/gemini/revise-thumbnail-prompt', {
    apiKey,
    currentPrompt,
    feedbackHistory,
    formattedDate,
  });
}

export async function generateShareTexts(
  apiKey: string,
  announcement: string,
  basics: EventBasics,
  region: string,
  formattedDate: string,
  organizerName?: string,
  feedbackHistory: string[] = [],
  styleDirective = ''
): Promise<ShareTexts> {
  return postApi<ShareTexts>('/api/gemini/generate-share-texts', {
    apiKey,
    announcement,
    basics,
    region,
    formattedDate,
    organizerName,
    feedbackHistory,
    styleDirective,
  });
}
