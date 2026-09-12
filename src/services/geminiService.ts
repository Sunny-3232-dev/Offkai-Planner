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
  SurveyPlan,
  SurveyQuestionDef,
} from '../types';

export const AI_STUDIO_SESSION_KEY = '__aistudio-session__';

async function postApi<T>(endpoint: string, body: any): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 配信側のサーバーが古いと、まだ無いAPIパスに対してページ本体(HTML)を200で返してくる。
  // そのままJSONとして読むと「Unexpected token '<'」という意味の取れないエラーになるので、
  // 先に見分けて、何をすればいいかを伝える
  const contentType = res.headers.get('content-type') || '';
  if (res.ok && !contentType.includes('application/json')) {
    throw new Error(
      'アプリの更新がまだサーバー側に反映されていないようです。' +
        'ページを再読み込みしても直らない場合は、作者側で最新版を取り込む必要があります。'
    );
  }
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

/** 配色指定の行。AIが決めた配色を全スタイルへ同じ形で流し込み、同じ会のアイコンとして色が揃うようにする */
function colorLine(colorPalette?: string): string {
  const trimmed = (colorPalette || '').trim();
  return trimmed ? `\n・配色は「${trimmed}」を基調にする` : '';
}

/** アイコン文字は改行で2行に分けられる。表示・プロンプト埋め込み用に行へ分解する */
export function iconWordLines(word: string): string[] {
  return word.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
}

/** プロンプトに埋め込む一続きの文字（改行はレイアウト指示側で伝えるため、ここでは連結する） */
function joinedWord(word: string): string {
  const lines = iconWordLines(word);
  return lines.length > 0 ? lines.join('') : word.trim();
}

/** 文字が長いと円の中で潰れるため、改行位置を各スタイルへ共通で添える。
 *  主催者が改行を入れていればその位置を尊重し、無ければ長いときだけAIに任せる */
function wordLayoutLine(word: string): string {
  const lines = iconWordLines(word);
  if (lines.length >= 2) {
    return `（「${lines[0]}」を1行目、「${lines[1]}」を2行目にして、必ず2行で組む）`;
  }
  return joinedWord(word).length >= 5
    ? `（5文字以上あるので、意味の切れ目で2行に分けて組む。1行に詰め込まない）`
    : '';
}

export function buildIconPromptCandidates(
  word: string,
  motif: string,
  colorPalette?: string
): IconStyleCandidate[] {
  const color = colorLine(colorPalette);
  const layout = wordLayoutLine(word);
  const wordText = joinedWord(word);
  return [
    {
      key: 'text',
      label: '文字メイン',
      prompt: `${ICON_PROMPT_BASE}
・背景はシンプル（無地〜ゆるやかなグラデーション。細かい描写・イラストは入れない）
・中央に「${wordText}」という文字を大きく・はっきり・読みやすく配置（文字がアイコンの主役）${layout}
・装飾は最小限${color}`,
    },
    {
      key: 'motif',
      label: 'モチーフ＋文字',
      prompt: `${ICON_PROMPT_BASE}
・背景はシンプル（無地〜ゆるやかなグラデーション）
・中央に「${motif}」のモチーフを大きく描く（アイコンの主役）
・モチーフの下に「${wordText}」という文字を、一字一句このまま・読みやすく添える${layout}${color}`,
    },
    {
      key: 'clay',
      label: 'ぷっくり3D',
      prompt: `${ICON_PROMPT_BASE}
・「${motif}」のモチーフを、ぷっくりとした3D（クレイ調で丸みがあり、柔らかく可愛い立体感のあるスタイル）で大きく描く
・「${wordText}」という文字を、一字一句このまま・読みやすく配置する${layout}
・明るく親しみやすい配色${color}`,
    },
    {
      key: 'badge',
      label: 'バッジ風',
      prompt: `${ICON_PROMPT_BASE}
・記章（エンブレム）のデザインにする。円のかたちを活かした構成
・円の内側に沿って細いリングを1本引き、その内側に「${motif}」のモチーフを中央配置で大きく描く
・「${wordText}」という文字を、一字一句このまま・モチーフの下に読みやすく置く${layout}
・リングの上側の弧に沿って「OFFKAI」の英字を小さく回す（下側の弧には何も置かない）
・左右対称に整え、余計な装飾は足さない${color}`,
    },
  ];
}

/** 「画風は指定しない」というAIへの制約が、出力プロンプトに断り書きとして漏れることがある。
 *  画風はツール側で末尾に足すため、その断り書きが残ると同じプロンプト内で矛盾する。取り除く */
export function stripStyleDisclaimer(prompt: string): string {
  return prompt
    // 括弧書き:（画風の指定は行いません）（画風はツール側で付与します）など
    .replace(/[（(][^（）()]*画風[^（）()]*(?:指定|付与|別途)[^（）()]*[）)]/g, '')
    // 地の文: 画風は指定しない。／画風の指定はしません。など
    .replace(/画風(?:は|の|を)?(?:ここでは)?指定(?:は|を)?(?:しない|しません|行いません|行わない)[。、]?/g, '')
    .replace(/[ \t]+([。、）)])/g, '$1')
    .trim();
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

export async function generateSurveyPlan(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea,
  basics: EventBasics,
  organizerName: string
): Promise<SurveyPlan> {
  return postApi<SurveyPlan>('/api/gemini/generate-survey-plan', {
    apiKey,
    concept,
    idea,
    basics,
    organizerName,
  });
}

/** GASの文字列リテラルに埋め込むためのエスケープ（引用符・改行でコードが壊れないように） */
function escapeForGas(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

/** アンケート設定から、Google Apps Scriptにそのまま貼れるコードを組み立てる */
export function buildSurveyGasCode(plan: SurveyPlan): string {
  const questionCode = plan.questions
    .map((q: SurveyQuestionDef) => {
      const title = escapeForGas(q.title);
      const help = q.helpText ? `\n    .setHelpText('${escapeForGas(q.helpText)}')` : '';
      const required = `\n    .setRequired(${q.required ? 'true' : 'false'})`;
      const options = (q.options || []).map((o) => `'${escapeForGas(o)}'`).join(', ');
      switch (q.type) {
        case 'TEXT':
          return `  form.addTextItem()\n    .setTitle('${title}')${help}${required};`;
        case 'RADIO':
          return `  form.addMultipleChoiceItem()\n    .setTitle('${title}')\n    .setChoiceValues([${options}])${help}${required};`;
        case 'CHECKBOX':
          return `  form.addCheckboxItem()\n    .setTitle('${title}')\n    .setChoiceValues([${options}])${help}${required};`;
        default:
          return `  form.addParagraphTextItem()\n    .setTitle('${title}')${help}${required};`;
      }
    })
    .join('\n\n');

  return `function createOffkaiSurvey() {
  // 1. フォームを作る
  var form = FormApp.create('${escapeForGas(plan.formTitle)}');
  form.setDescription('${escapeForGas(plan.formDescription)}');

  // 2. 回答後に表示されるお礼メッセージ
  form.setConfirmationMessage('${escapeForGas(plan.thanksMessage)}');

  // 3. 質問を追加
${questionCode}

  // 4. できあがったURLをログに出す
  Logger.log('--------------------------------------------------');
  Logger.log('編集用URL（主催者用）: ' + form.getEditUrl());
  Logger.log('回答用URL（参加者へ配る）: ' + form.getPublishedUrl());
  Logger.log('--------------------------------------------------');
}`;
}
