import { GoogleGenAI } from '@google/genai';
import type {
  OrganizerProfile,
  IdeaConcept,
  PlanIdea,
  IdeaCategory,
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
} from '../src/types';
import { removeTimetableSection } from '../src/utils/time';

const MODEL = 'gemini-3.6-flash';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
// 1分あたりの上限は数秒〜十数秒で空くことが多い。30秒待って1回だけ試すより、
// 短い間隔から段階的に粘るほうが復帰しやすい（合計でも約40秒に収まる）
const RATE_LIMIT_RETRY_DELAYS_MS = [5000, 12000, 25000];
// 混雑（503）は数秒で解消することが多いので、レート制限より短い間隔から始める
const OVERLOADED_RETRY_DELAY_MS = 2000;

export const AI_STUDIO_SESSION_KEY = '__aistudio-session__';

/** 利用者が自分のキーを設定しておらず、作者のキー（配布版で全員が共有）を使う状態か。
 *  getClient のフォールバック条件と必ず同じにすること */
function isSharedKey(userApiKey?: string): boolean {
  return !userApiKey || userApiKey === AI_STUDIO_SESSION_KEY;
}

function getClient(userApiKey?: string) {
  let keyToUse = userApiKey;
  if (!keyToUse || keyToUse === AI_STUDIO_SESSION_KEY) {
    keyToUse = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  }

  if (!keyToUse) {
    return new GoogleGenAI({
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  return new GoogleGenAI({
    apiKey: keyToUse,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const TEXT_REPLACEMENTS: [RegExp, string][] = [
  [/リベ大/g, 'リベシティ'],
];

function normalizePrompt(text: string): string {
  return TEXT_REPLACEMENTS.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), text);
}

function rawErrorDetail(errorStr: string): string {
  const redacted = errorStr.replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza…(伏せました)');
  const trimmed = redacted.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return `\n\n［Googleからの応答］\n${trimmed.slice(0, 500)}`;
}

function classifyError(error: any, sharedKey = false): { type: 'rate-limit' | 'overloaded' | 'auth' | 'network' | 'timeout' | 'unknown'; message: string } {
  const errorStr = error?.message || String(error);
  const status = error?.status || error?.code;

  if (status === 429 || errorStr.includes('quota') || errorStr.includes('rate limit') || errorStr.includes('RESOURCE_EXHAUSTED')) {
    // 配布版は利用者全員が作者のキーを共有するため、自分の使いすぎではなく
    // 同時に使っている人との取り合いで当たることが多い。原因を取り違えないよう文面を分ける
    if (sharedKey) {
      return {
        type: 'rate-limit',
        message:
          'いまアクセスが集中していて、1分あたりの利用上限に当たりました。' +
          'あなたの使いすぎではなく、同じ時間に使っている人と枠を分け合っているためです。' +
          '少し待つと直ります（自動でも数回やり直しています）。入力した内容は残っているので、そのままやり直せます。' +
          '何度も出る場合は、自分のGoogleアカウントで無料のAPIキーを作り、画面右上の鍵アイコンから設定すると、他の人と取り合わずに使えます。',
      };
    }
    return {
      type: 'rate-limit',
      message:
        '無料枠の利用上限に達しました。' +
        '1分あたりの上限であることが多く、その場合は1分ほど待ってから再実行すると直ります（自動での再試行も数回行っています）。' +
        '何度も出る場合は1日あたりの上限に達している可能性があり、翌日まで待つか、別のGoogleアカウントで作成したAPIキーを画面右上の鍵アイコンから設定してください。' +
        '※上限はAPIキーではなくGoogleアカウント単位のため、同じアカウントでキーを作り直しても解消しません。',
    };
  }
  // 503 UNAVAILABLE はGoogle側が混み合っているだけで、こちらの設定は正しい。
  // 分類していないと生のJSONがそのまま利用者に出てしまうため、専用の文言を返す
  if (status === 503 || errorStr.includes('UNAVAILABLE') || /high demand|overloaded|currently unavailable/i.test(errorStr)) {
    return {
      type: 'overloaded',
      message:
        'いまGoogle側のAIが混み合っていて、応答を返せませんでした。設定の問題ではないので、少し時間をおいてもう一度お試しください' +
        '（自動でも数回やり直しています）。入力した内容と、いまできている文章はそのまま残っています。',
    };
  }
  if (/permission.?denied/i.test(errorStr) || errorStr.includes('PERMISSION_DENIED')) {
    return {
      type: 'auth',
      message:
        'Gemini APIの利用権限がありません。よくある原因は次の3つです。' +
        '(1) このアカウントでAPIキーをまだ作っていない・利用規約に同意していない → 別タブで https://aistudio.google.com/apikey を開いて作成してください。' +
        '(2) キーが属するGoogle Cloudプロジェクト側の問題（Generative Language APIが無効、またはプロジェクトがアクセス拒否状態）→ 別プロジェクトで作ったキーを画面右上の鍵アイコンから設定すると切り分けられます。' +
        '(3) 会社・学校のGoogleアカウントで管理者によりAI Studioが無効化されている → 個人アカウントをお使いください。' +
        '※AI Studioで開いている場合は、しばらく操作しないと接続が切れることがあります。まずページを再読み込みしてみてください。' +
        '下の［Googleからの応答］に、どれに当たるかが書かれています。' +
        rawErrorDetail(errorStr),
    };
  }
  if (status === 401 || status === 403 || errorStr.includes('API key') || errorStr.includes('unauthorized')) {
    return {
      type: 'auth',
      message:
        'APIキーが無効です。画面右上の鍵アイコンからGemini APIキーを設定し直してください。' +
        rawErrorDetail(errorStr),
    };
  }
  if (error?.name === 'AbortError' || errorStr.includes('timeout')) {
    return { type: 'timeout', message: 'リクエストがタイムアウトしました。接続を確認して再度お試しください。' };
  }
  if (errorStr.includes('network') || errorStr.includes('fetch')) {
    return { type: 'network', message: 'ネットワーク接続を確認してください。' };
  }
  return { type: 'unknown', message: errorStr || 'AIとの通信中にエラーが発生しました。' };
}

export async function callGemini(apiKey: string, prompt: string, retryCount = 0): Promise<string> {
  try {
    const client = getClient(apiKey);
    const response = await client.models.generateContent({
      model: MODEL,
      contents: normalizePrompt(prompt),
    });
    const text = response.text;
    if (!text) throw new Error('AIからの応答がありませんでした');
    return text;
  } catch (error: any) {
    const classification = classifyError(error, isSharedKey(apiKey));

    if (classification.type === 'rate-limit' && retryCount < RATE_LIMIT_RETRY_DELAYS_MS.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAYS_MS[retryCount]));
      return callGemini(apiKey, prompt, retryCount + 1);
    }

    // 混雑は待てば直ることが多いので、ネットワーク断と同じく段階的に間隔を空けて試し直す
    if (classification.type === 'overloaded' && retryCount < MAX_RETRIES) {
      const delayMs = OVERLOADED_RETRY_DELAY_MS * Math.pow(2, retryCount);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return callGemini(apiKey, prompt, retryCount + 1);
    }

    if (classification.type === 'network' && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_MS * Math.pow(2, retryCount);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return callGemini(apiKey, prompt, retryCount + 1);
    }

    throw new Error(classification.message);
  }
}

export function repairTruncatedJSON(jsonStr: string): string {
  let s = jsonStr.trim();
  s = s.replace(/,\s*$/, '');

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  if (inString) s += '"';
  while (braces > 0) { s += '}'; braces--; }
  while (brackets > 0) { s += ']'; brackets--; }

  return s;
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
      const repaired = repairTruncatedJSON(sub);
      try {
        return JSON.parse(repaired);
      } catch {
        throw new Error('AIの応答が途中で切れたため、JSONを解析できませんでした。再度お試しください。');
      }
    }
  }
}

const DESIGNER_PREFIX = 'あなたはプロのデザイナーです。';
/** 「画風は指定しない」というAIへの制約が、出力プロンプトに断り書きとして漏れることがある。
 *  画風はツール側で末尾に足すため、その断り書きが残ると同じプロンプト内で矛盾する。取り除く */
function stripStyleDisclaimer(prompt: string): string {
  return prompt
    // 括弧書き:（画風の指定は行いません）（画風はツール側で付与します）など
    .replace(/[（(][^（）()]*画風[^（）()]*(?:指定|付与|別途)[^（）()]*[）)]/g, '')
    // 地の文: 画風は指定しない。／画風の指定はしません。など
    .replace(/画風(?:は|の|を)?(?:ここでは)?指定(?:は|を)?(?:しない|しません|行いません|行わない)[。、]?/g, '')
    .replace(/[ \t]+([。、）)])/g, '$1')
    .trim();
}

function ensureDesignerPrefix(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.startsWith(DESIGNER_PREFIX) ? trimmed : `${DESIGNER_PREFIX}${trimmed}`;
}

function conceptLines(concept: IdeaConcept): string {
  return [
    `- 会の目的: ${concept.purpose}`,
    `- 来てほしい人（ペルソナ）: ${concept.persona}`,
    `- 大切にしたいこと: ${concept.cherish.join(' / ')}`,
  ].join('\n');
}

function organizerNameDirective(organizerName: string): string {
  const scopeNote =
    '- 主催者は一人のリベシティ会員であり、リベシティの運営・公式スタッフではない。「リベシティの○○です」のように運営・公式を代表するかのような名乗り方を絶対にしないこと（「○○です」のように個人として名乗ること）\n' +
    '- このツールは初めてオフ会を主催する人だけでなく、開催に慣れた主催者も使う。自己紹介欄に本人が書いていない限り、「初主催」「初めて」等の経験有無を勝手に決めつけて書かないこと\n' +
    '- 上記2点は文体の指定より優先する。どんな文体で書く場合でも、公式を代表する名乗りと、書かれていない経験有無の記述はしないこと';
  if (!organizerName || !organizerName.trim()) {
    return `- 主催者名: 未記入（名前は無理に入れず、自然な一人称の自己紹介にすること）\n${scopeNote}`;
  }
  return `- 主催者名: ${organizerName}（主催者本人です。自己紹介・呼びかけでは一人称として名前を使い、「${organizerName}です」のように書くこと。自分の名前に「さん」など敬称は絶対に付けないこと。参加者や他の人を指す場合は従来通り敬称を使ってよい）\n${scopeNote}`;
}

export function venueLabelOf(basics: EventBasics): string {
  if (basics.venueType !== 'online') return basics.venueDetail;
  if (!basics.onlineTool) return 'オンライン';
  const toolName = basics.onlineTool === 'other' ? basics.onlineToolOther : basics.onlineTool;
  return toolName ? `オンライン（${toolName}）` : 'オンライン';
}

const IDEA_CATEGORIES: { id: IdeaCategory; label: string; direction: string }[] = [
  {
    id: 'save',
    label: '貯める',
    direction:
      '家計管理・固定費見直し・ライフプラン・節約でお金を貯める会（例: 家計簿もくもく会、固定費見直しシェア会、ライフプラン相談会、節約術シェア会）',
  },
  {
    id: 'earn',
    label: '稼ぐ',
    direction:
      '副業・IT・スキルアップで収入を増やす会（例: 副業もくもく会、プログラミング勉強会、Claude Code・AI活用勉強会、ブログ/SNS運用会、せどり情報交換会）',
  },
  {
    id: 'protect',
    label: '守る',
    direction:
      '保険・税金・詐欺回避・リスク管理でお金を守る会（例: 保険を学ぶ会、確定申告もくもく会、詐欺・情報リテラシー勉強会）',
  },
  {
    id: 'grow',
    label: '増やす',
    direction:
      '投資（新NISA・株・投資信託等）でお金を増やす会（例: 新NISA勉強会、投資雑談会、米国株もくもく会、投資信託の情報交換会）',
  },
  {
    id: 'use',
    label: '使う',
    direction:
      'お金を使って人生を豊かにする会（例: ランチ会、BBQ、日帰り旅行、カフェ会、趣味の体験イベント）',
  },
  {
    id: 'other',
    label: 'その他',
    direction:
      '上記に当てはまらない雑談・交流全般の会（例: 雑談会、交流会、もくもく会、朝活、散歩会、テニス・バドミントン等の運動系、ボードゲーム会）',
  },
];

const IDEAS_PER_CATEGORY = 4;
const THEME_IDEAS_COUNT = 5;

function venuePreferenceDirective(profile: OrganizerProfile): string {
  if (profile.venuePreference === 'online') {
    return '- 開催形態: 主催者はオンライン開催を選んでいます。全案を必ずオンライン前提の企画にすること。実際に集まる前提の要素（飲食店・会場・現地集合など）を入れないこと。';
  }
  return '- 開催形態: 主催者は対面（オフライン）開催を選んでいます。全案を必ず実際に集まって行う企画にすること。title・summary・進め方に「オンライン」という語やオンライン開催前提の内容を絶対に入れないこと。';
}

function communityToneNote(profile: OrganizerProfile): string {
  if (profile.venuePreference === 'online') {
    return '- リベシティでは実際に「初心者歓迎」「途中参加・退出OK」を明記したオンラインの気軽な会が多く開催され、参加のハードルを下げて人が集まりやすくなっている。企画案にもこの空気感を活かしてよい';
  }
  return '- リベシティでは「初心者歓迎」を明記した対面の気軽な会が多く開催され、参加のハードルを下げて人が集まりやすくなっている。企画案にもこの空気感を活かしてよいが、対面では安全・トラブル防止のため「途中参加・退出OK」を安易に前提にしないこと（集合・解散のタイミングを明確にする企画にすること）';
}

function ideasFeedbackSection(feedbackHistory: string[]): string {
  if (feedbackHistory.length === 0) return '';
  const lines = feedbackHistory.map((f, i) => `${i + 1}. ${f}`).join('\n');
  return `\n## 主催者からの追加の要望（すべて反映すること）\n${lines}\n`;
}

async function generateIdeasForCategoryGroup(
  apiKey: string,
  profile: OrganizerProfile,
  categories: { id: IdeaCategory; label: string; direction: string }[],
  feedbackHistory: string[]
): Promise<PlanIdea[]> {
  const categorySections = categories
    .map((c) => `### ${c.id}（${c.label}）\n${c.direction}`)
    .join('\n');
  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
初めてオフ会を主催する人のために、以下の${categories.length}ジャンルそれぞれについて、オフ会企画案を各${IDEAS_PER_CATEGORY}件提案してください。

## ジャンル一覧
${categorySections}

## 主催者プロフィール
- 自己紹介: ${profile.selfIntro}
- 興味・好きなこと: ${profile.interests}
- 開催したいエリア: ${profile.desiredArea || '未記入'}
${venuePreferenceDirective(profile)}
${ideasFeedbackSection(feedbackHistory)}

## 各フィールドの意味
- title: 企画名（30文字以内。参加者が内容をイメージできる具体的な名前）
- summary: どんな会か（80文字以内）
- persona: 来てほしい人の具体像・ペルソナ（50文字以内）
- purpose: この会の目的をひとことで（40文字以内。会の「軽いミッション」にあたるもの）
- cherish: 会で大切にしたいこと2〜3個（各15文字以内。例:「全員が話せる」「否定しない」）
- recommendedCapacity: 目安の定員（主催者含む人数。初主催なら4〜8人を中心に）
- firstTimerFriendlyPoint: 初主催でもやりやすい理由（60文字以内）

## 注意事項
- 初主催者が「これならできそう」と思える、運営が簡単な企画を優先すること
${communityToneNote(profile)}
- 会場手配・機材・事前準備のハードルが高い企画は避けること
- 各案は必ずそのジャンルのテーマに沿わせること。ジャンルをまたいだ内容の重複は避けること
${feedbackHistory.length > 0 ? '- 「主催者からの追加の要望」は、当たり障りのない範囲に薄めず、要望の意図どおりに企画へ反映すること\n' : ''}
- 各ジャンルの${IDEAS_PER_CATEGORY}件はテーマ・時間帯にバリエーションを持たせること
- 主催者の個性やニッチな趣味に引っ張られすぎないこと。初主催者は突飛な会だと立てづらいので、まずは各ジャンルのお金のテーマに沿った王道・定番の形（上記「ジャンル一覧」の例のような、参加者がイメージしやすく集まりやすい形）を優先する
- 興味・好きなことは、会話のきっかけや切り口として“軽く”反映する程度でよい（企画の主役をニッチな個性にしない）
- personaとpurposeは企画ごとに具体的に変えること（汎用文の使い回しをしない）

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。ジャンルID（${categories.map((c) => c.id).join(' / ')}）をキーにしたオブジェクトで、各キーに${IDEAS_PER_CATEGORY}件の配列を入れます。

\`\`\`json
{
  "${categories[0].id}": [
    {
      "title": "...",
      "summary": "...",
      "persona": "...",
      "purpose": "...",
      "cherish": ["...", "..."],
      "recommendedCapacity": 6,
      "firstTimerFriendlyPoint": "..."
    }
  ]
}
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const ideas: PlanIdea[] = [];
  for (const category of categories) {
    const list: any[] = Array.isArray(parsed?.[category.id]) ? parsed[category.id] : [];
    for (const i of list) {
      if (!i || !i.title) continue;
      ideas.push({
        id: crypto.randomUUID(),
        category: category.id,
        title: String(i.title || ''),
        summary: String(i.summary || ''),
        persona: String(i.persona || ''),
        purpose: String(i.purpose || ''),
        cherish: Array.isArray(i.cherish) ? i.cherish.map(String).slice(0, 3) : [],
        venueHint: String(i.venueHint || ''),
        recommendedCapacity: Number(i.recommendedCapacity) || 6,
        firstTimerFriendlyPoint: String(i.firstTimerFriendlyPoint || ''),
      });
    }
  }
  if (ideas.length === 0) {
    throw new Error('企画案の生成結果を読み取れませんでした。再度お試しください。');
  }
  return ideas;
}

async function generateThemedIdeas(
  apiKey: string,
  profile: OrganizerProfile,
  feedbackHistory: string[]
): Promise<PlanIdea[]> {
  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
主催者は既にテーマを決めています: 「${profile.plannedTheme}」。
このテーマ・この表現に忠実な企画案を${THEME_IDEAS_COUNT}件提案してください。あなたの仕事はテーマを考えることではなく、主催者が決めたテーマを開催可能な形に具体化することだけです。

## 主催者プロフィール
- 自己紹介: ${profile.selfIntro}
- 興味・好きなこと: ${profile.interests}
- 開催したいエリア: ${profile.desiredArea || '未記入'}
${venuePreferenceDirective(profile)}
${ideasFeedbackSection(feedbackHistory)}

## 各フィールドの意味
- title: 企画名（30文字以内。参加者が内容をイメージできる具体的な名前）
- summary: どんな会か（80文字以内）
- persona: 来てほしい人の具体像・ペルソナ（50文字以内）
- purpose: この会の目的をひとことで（40文字以内。会の「軽いミッション」にあたるもの）
- cherish: 会で大切にしたいこと2〜3個（各15文字以内。例:「全員が話せる」「否定しない」）
- recommendedCapacity: 目安の定員（主催者含む人数。初主催なら4〜8人を中心に）
- firstTimerFriendlyPoint: 初主催でもやりやすい理由（60文字以内）

## 注意事項（テーマへの忠実性が最優先）
${feedbackHistory.length > 0 ? '- 「主催者からの追加の要望」は、当たり障りのない範囲に薄めず、要望の意図どおりに企画へ反映すること（テーマへの忠実性と両立させること）\n' : ''}- ${THEME_IDEAS_COUNT}件すべてが、主催者の決めたテーマ「${profile.plannedTheme}」の企画であること。テーマを外れた案・別ジャンルの案は1件も混ぜないこと
- titleには原則、主催者が書いたテーマの言葉（キーワード）を**一字一句正確にコピーして**含めること。文字の脱落・変更は厳禁（例:「スキルマ」を「スキマ」と書かない）。別の言葉への言い換え・置き換えも禁止（例: テーマが「ボドゲ会」なら「ボドゲ」をタイトルに残す。「テーブルゲーム交流会」等に言い換えない）
- summary・purposeでも主催者の表現・ニュアンスを尊重し、勝手に上位概念・別テーマへ拡大解釈しないこと
- ${THEME_IDEAS_COUNT}件の違いは「切り口・進め方・時間帯・対象の絞り方」だけで出すこと。テーマそのものは変えないこと
- 初主催者が「これならできそう」と思える、運営が簡単な企画を優先すること
${communityToneNote(profile)}
- プロフィールの興味・自己紹介はあくまで補足情報。テーマとの優先順位で迷ったら必ずテーマを優先すること

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。

\`\`\`json
[
  {
    "title": "...",
    "summary": "...",
    "persona": "...",
    "purpose": "...",
    "cherish": ["...", "..."],
    "recommendedCapacity": 6,
    "firstTimerFriendlyPoint": "..."
  }
]
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const list: any[] = Array.isArray(parsed) ? parsed : parsed?.ideas || [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('企画案の生成結果を読み取れませんでした。再度お試しください。');
  }
  return list
    .filter((i) => i && i.title)
    .map((i) => ({
      id: crypto.randomUUID(),
      category: 'other' as IdeaCategory,
      title: String(i.title || ''),
      summary: String(i.summary || ''),
      persona: String(i.persona || ''),
      purpose: String(i.purpose || ''),
      cherish: Array.isArray(i.cherish) ? i.cherish.map(String).slice(0, 3) : [],
      venueHint: String(i.venueHint || ''),
      recommendedCapacity: Number(i.recommendedCapacity) || 6,
      firstTimerFriendlyPoint: String(i.firstTimerFriendlyPoint || ''),
    }));
}

export async function generatePlanIdeasServer(
  apiKey: string,
  profile: OrganizerProfile,
  feedbackHistory: string[] = []
): Promise<PlanIdea[]> {
  if (profile.plannedTheme && profile.plannedTheme.trim()) {
    return generateThemedIdeas(apiKey, profile, feedbackHistory);
  }
  const groups = [IDEA_CATEGORIES.slice(0, 3), IDEA_CATEGORIES.slice(3)];
  const results = await Promise.allSettled(
    groups.map((g) => generateIdeasForCategoryGroup(apiKey, profile, g, feedbackHistory))
  );
  const ideas = results
    .filter((r): r is PromiseFulfilledResult<PlanIdea[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);
  if (ideas.length === 0) {
    const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error('企画案の生成に失敗しました。再度お試しください。');
  }
  return ideas;
}

export async function generateTitleCandidatesServer(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea
): Promise<string[]> {
  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
以下のオフ会企画のタイトル候補を5件提案してください。

## 企画内容
- 企画名（仮）: ${idea.title}
- 概要: ${idea.summary}
${conceptLines(concept)}

## タイトルの条件
- 30文字以内
- 何をする会か・誰向けかが一目でわかること
- 初参加でも気軽に申し込めそうな親しみやすい表現
- 絵文字は多くても1つまで
- 5件はそれぞれ違う切り口にすること（内容説明型 / 呼びかけ型 / 数字入り / ターゲット明示型 / キャッチー型 など）

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。

\`\`\`json
{ "titles": ["...", "...", "...", "...", "..."] }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const titles: any[] = Array.isArray(parsed) ? parsed : parsed?.titles || [];
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new Error('タイトル候補の生成結果を読み取れませんでした。再度お試しください。');
  }
  return titles.map(String).filter(Boolean).slice(0, 5);
}

export async function suggestCapacityServer(
  apiKey: string,
  idea: PlanIdea,
  venueTypeOrBasics: VenueType | EventBasics,
  venueDetail?: string,
  durationMinutes?: number
): Promise<CapacitySuggestion> {
  let finalVenueType: VenueType;
  let finalVenueDetail: string;
  let finalDurationMinutes: number;

  if (typeof venueTypeOrBasics === 'object' && venueTypeOrBasics !== null) {
    finalVenueType = venueTypeOrBasics.venueType;
    finalVenueDetail = venueTypeOrBasics.venueDetail;
    finalDurationMinutes = venueTypeOrBasics.durationMinutes;
  } else {
    finalVenueType = venueTypeOrBasics as VenueType;
    finalVenueDetail = venueDetail || '';
    finalDurationMinutes = durationMinutes || 120;
  }

  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
初めてオフ会を主催する人のために、以下の条件に合った定員（主催者を含む人数）を提案してください。

## 条件
- 企画: ${idea.title}（${idea.summary}）
- 開催形態: ${finalVenueType === 'online' ? 'オンライン' : 'オフライン（対面）'}
- 場所: ${finalVenueDetail || '未定'}
- 開催時間: ${finalDurationMinutes}分

## 考慮すること
- 初主催者が全員に目を配れる人数であること（多すぎは禁物）
- 時間内に全員が自己紹介や会話に参加できること
- 1〜2人欠席しても会が成立する人数であること

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。reasonは80文字以内。

\`\`\`json
{ "recommended": 6, "min": 4, "max": 8, "reason": "..." }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const recommended = Number(parsed?.recommended);
  if (!recommended) {
    throw new Error('定員の提案結果を読み取れませんでした。再度お試しください。');
  }
  return {
    recommended,
    min: Number(parsed?.min) || Math.max(2, recommended - 2),
    max: Number(parsed?.max) || recommended + 2,
    reason: String(parsed?.reason || ''),
  };
}

export async function generateScheduleServer(
  apiKey: string,
  basics: EventBasics,
  concept: IdeaConcept,
  idea: PlanIdea
): Promise<Omit<ScheduleItem, 'id'>[]> {
  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
初めてオフ会を主催する人のために、当日の進行イメージ（タイムスケジュール）を作ってください。

## オフ会の情報
- タイトル: ${basics.title}
- 企画: ${idea.title}（${idea.summary}）
- 開催形態: ${basics.venueType === 'online' ? 'オンライン' : 'オフライン（対面）'}
- 場所: ${venueLabelOf(basics)}
- 開催時間: ${basics.durationMinutes}分
- 定員: ${basics.capacity}人（主催者含む）
${conceptLines(concept)}

## 進行イメージの条件
- 各項目は {title, description, durationMinutes} で構成
- durationMinutesは10分単位（10, 20, 30...）にすること
- **durationMinutesの合計が必ず${basics.durationMinutes}分ちょうどになること**
- 冒頭にオープニング（挨拶・趣旨説明）、終盤にクロージング（まとめ・次回予告・解散）を入れること
- 定員${basics.capacity}人が全員話せるよう、自己紹介の時間は1人あたり1〜2分で計算すること
- descriptionには主催者向けの進行のコツを書くこと（50文字以内。例: 「主催者から先に話すと場が和みます」）
- 項目数は4〜5個。細かく刻みすぎず、大まかなブロックにまとめること
- 休憩の項目は入れないこと（必要なら主催者があとから追加します）
- 初主催者が迷わない、シンプルで無理のない進行にすること

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。

\`\`\`json
[
  { "title": "オープニング", "description": "...", "durationMinutes": 10 }
]
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const list: any[] = Array.isArray(parsed) ? parsed : parsed?.schedule || [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('進行イメージの生成結果を読み取れませんでした。再度お試しください。');
  }
  return list
    .filter((i) => i && i.title)
    .map((i) => ({
      title: String(i.title),
      description: String(i.description || ''),
      durationMinutes: Math.max(1, Number(i.durationMinutes) || 10),
    }));
}

function scheduleLinesForRevise(basics: EventBasics, schedule: ScheduleItem[]): string {
  if (schedule.length === 0) return '（項目なし）';
  return schedule
    .map((s, i) => `${i + 1}. ${s.title}（${s.durationMinutes}分）${s.description ? ` - ${s.description}` : ''}`)
    .join('\n');
}

export async function reviseScheduleServer(
  apiKey: string,
  basics: EventBasics,
  concept: IdeaConcept,
  idea: PlanIdea,
  currentSchedule: ScheduleItem[],
  feedbackHistory: string[]
): Promise<Omit<ScheduleItem, 'id'>[]> {
  const historyText =
    feedbackHistory.length > 0
      ? feedbackHistory.map((f, i) => `${i + 1}. ${f}`).join('\n')
      : '（なし）';

  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
以下は主催者がすでに編集済みの「現在の進行イメージ（タイムスケジュール）」です。
ゼロから作り直すのではなく、この現在の構成をベースに、主催者からの要望を反映して調整してください。

## オフ会の情報
- タイトル: ${basics.title}
- 企画: ${idea.title}（${idea.summary}）
- 開催形態: ${basics.venueType === 'online' ? 'オンライン' : 'オフライン（対面）'}
- 場所: ${venueLabelOf(basics)}
- 開催時間: ${basics.durationMinutes}分
- 定員: ${basics.capacity}人（主催者含む）
${conceptLines(concept)}

## 現在の進行イメージ（この構成・順序をベースにすること）
${scheduleLinesForRevise(basics, currentSchedule)}

## 主催者からの要望（これまでに伝えた分をすべて含む。すべて反映すること）
${historyText}

## 調整方針（重要）
- 主催者からの要望は、単なる言葉尻や時間配分の微調整ではなく、**進行の構成そのもの（部制・回数・繰り返し方）を変える指示であることが多い**。要望の意図を薄めて、当たり障りのない一般的な進行（オープニング→説明→Q&A、等）に置き換えないこと
- 例えば「2部制にしたい」「同じ説明を2回に分けたい」「途中参加者のために繰り返したい」といった要望は、**該当する内容の項目を実際に複製・繰り返す**形でそのまま反映すること（項目名や説明文を変えるだけでお茶を濁さない。同じ内容の項目が2つ並ぶのが正しい反映であれば、そうすること）
- **「N部制」「N回に分ける」の要望で、目的が途中参加者への対応（遅れて来た人にも内容が伝わるようにしたい）である場合は、1つの項目の時間を機械的に前半・後半へ分割するだけでは不十分。オープニングから本編の説明までの一連の流れを、それぞれ単独でも内容が完結する「1セット」として丸ごと複製し、そのセットをN回繰り返す構成にすること（例: 「20分×2の2部制」→ 20分の中に導入〜説明が収まった1セットを作り、それを2セット並べる。1セット目だけ参加した人にも2セット目だけ参加した人にも、内容が完結して伝わるようにする）**
- 要望が現在の構成の前提そのものを変える場合は、項目の入れ替え・複製・大幅な再編成を行ってよい
- 主催者が既に削除した項目を勝手に復活させないこと。主催者が並べ替えた順序は、要望と矛盾しない範囲でできるだけ尊重すること
- ゼロから新しい進行を作るのではなく、現在の構成・主催者の要望の両方を踏まえて調整すること
- durationMinutesは10分単位（10, 20, 30...）にすること
- **durationMinutesの合計が必ず${basics.durationMinutes}分ちょうどになること**
- 各項目は {title, description, durationMinutes} で構成
- descriptionには主催者向けの進行のコツを書くこと（50文字以内）

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。

\`\`\`json
[
  { "title": "オープニング", "description": "...", "durationMinutes": 10 }
]
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const list: any[] = Array.isArray(parsed) ? parsed : parsed?.schedule || [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('進行イメージの生成結果を読み取れませんでした。再度お試しください。');
  }
  return list
    .filter((i) => i && i.title)
    .map((i) => ({
      title: String(i.title),
      description: String(i.description || ''),
      durationMinutes: Math.max(1, Number(i.durationMinutes) || 10),
    }));
}

const GUIDELINE_LINE_1 = '▶ オフ会ガイドラインはこちら';
const GUIDELINE_LINE_2 = 'https://site.libecity.com/meetup-guidelines';

function ensureGuidelineFooter(body: string): string {
  if (body.includes(GUIDELINE_LINE_2)) return body;
  return `${body.trim()}\n\n${GUIDELINE_LINE_1}\n${GUIDELINE_LINE_2}`;
}

export async function generateAnnouncementServer(
  apiKey: string,
  profile: OrganizerProfile,
  concept: IdeaConcept,
  basics: EventBasics,
  formattedDate: string
): Promise<AnnouncementResult> {
  const venueLabel = venueLabelOf(basics);

  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
初めてオフ会を主催する人のために、リベシティのオフ会チャット作成フォームの「詳細（公開情報）」欄に掲載する告知文と、チャット作成フォームに入力するタグを書いてください。

## オフ会の情報
- タイトル: ${basics.title}
- 日時: ${formattedDate} ${basics.startTime}〜（${basics.durationMinutes}分）
- 開催形態: ${basics.venueType === 'online' ? 'オンライン' : 'オフライン（対面）'}
- 場所: ${venueLabel}
- 定員: ${basics.capacity}人（主催者含む）
${conceptLines(concept)}

## 主催者について
${profile.selfIntro}
${organizerNameDirective(profile.organizerName)}

## 告知文（body）の構成（必ずこのテンプレート構成で出力すること）
以下の見出し（■・▶）と改行構成を必ずそのまま使い、各セクションの中身だけを埋めてください。
「■当日の流れ」などのタイムテーブルセクションは絶対に含めないでください（当日の流れは主催者だけが見る別ページで管理し、公開情報には載せません）。

\`\`\`
■イベント・オフ会内容
（会の紹介: 挨拶・自己紹介・どんな会か・こんな人に来てほしい・日時・場所・定員を、このセクション内に読みやすくまとめる。挨拶と自己紹介は1〜2文で親しみやすく、どんな会かは目的・大切にしたいことを自然な文章で、こんな人に来てほしいはペルソナをやわらかい表現で、開催概要は日時・場所・定員を見やすくまとめる。「初主催」「初めて主催する」等の記述は、主催者について（自己紹介欄）に本人がそう書いている場合のみ触れてよく、書かれていない場合は絶対に書かないこと（事実と異なる可能性があるため）。場所は「基本情報」で入力された内容（オフィス名・エリア名等）以上に詳細な住所・地図リンク・店名などを書き足さないこと（不特定多数が見る公開情報のため、詳細な待ち合わせ場所は書かない）。当日の流れ・タイムテーブルはここに書かないこと）

■参加費用（内訳があれば明記してください）
（${basics.venueType === 'offline' ? '対面なら「実費（カフェ代等は各自ご負担）」のような想定を書き、主催者が編集しやすい形にすること' : 'オンラインなら「無料」等、実態に即した内容にすること'}）

■参加方法
参加希望の方は、こちらのチャットに参加申請をお願いします。

■注意事項
（${basics.venueType === 'online'
    ? 'オンライン開催なので、「無断キャンセル厳禁」等の強い表現は使わないこと。「参加が難しくなったら早めにひとことお知らせください」程度のやわらかい表現にすること'
    : '対面開催なので、会場予約や人数の都合があるため、無断キャンセルは控えてほしい旨を含める（キャンセル連絡・遅刻連絡など、初主催でも書きやすい定番の注意事項を1〜3行）'
  }）

▶ オフ会ガイドラインはこちら
https://site.libecity.com/meetup-guidelines
\`\`\`

- 「■参加方法」の本文2行目（「参加希望の方は、こちらのチャットに参加申請をお願いします。」）と、末尾の「▶ オフ会ガイドラインはこちら」「https://site.libecity.com/meetup-guidelines」の2行は、一字一句この通りに出力すること（絶対に変えない）
- 各見出し（■参加費用 等）はそのまま残し、中身だけを埋めること

## 注意事項
- ■イベント・オフ会内容セクションは全体で500〜800文字程度
- 一文は短く（目安40文字以内）。長くなりそうな文は2つに分けること
- 文のまとまりごとに改行し、話題の変わり目には空行を入れて、スマホでも読みやすくすること
- 絵文字を適度に使い、堅くなりすぎないこと
- 「初めての方も大歓迎」の空気を作ること
- リベシティの仕様上、Markdown記法（# 見出し、**太字**、* 箇条書き など）は使用できません。絶対にアスタリスク「**」やシャープ「#」などのマークダウン記号は含めず、プレーンテキスト（空白行、改行、全角の「■」「▼」「・」など）を使って見やすく整形して出力してください。

## タグ（tags）
リベシティのオフ会チャット作成フォームに入力する、この会に合ったタグを3〜5個考えてください。
- 例: オフ会 / 交流 / 初心者大歓迎 / 朝活 / もくもく会
- 「#」記号は付けないこと
- この会の内容・雰囲気に合った具体的なタグにすること
- 必ず3個以上5個以内に収めること

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。bodyに告知文全体、tagsにタグの配列を入れること。

\`\`\`json
{ "body": "...", "tags": ["...", "...", "...", "...", "..."] }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const body = String(parsed?.body || '');
  if (!body) {
    throw new Error('告知文の生成結果を読み取れませんでした。再度お試しください。');
  }
  const tags: string[] = Array.isArray(parsed?.tags)
    ? parsed.tags.map(String).filter(Boolean).slice(0, 5)
    : [];
  return {
    body: removeTimetableSection(ensureGuidelineFooter(body)),
    tags,
  };
}

export async function reviseAnnouncementServer(
  apiKey: string,
  profile: OrganizerProfile,
  currentAnnouncement: string,
  feedbackHistory: string[],
  basics: EventBasics,
  styleDirective = ''
): Promise<AnnouncementResult> {
  const historyText =
    feedbackHistory.length > 0
      ? feedbackHistory.map((f, i) => `${i + 1}. ${f}`).join('\n')
      : '（なし）';

  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
以下は、リベシティのオフ会チャット作成フォームの「詳細（公開情報）」欄に掲載する、現在の告知文です。
ゼロから書き直すのではなく、この現在の文章全文をベースに、主催者からの要望（これまでに伝えた分をすべて含む）を反映した改訂版を作ってください。

## 現在の詳細文（このテキストをベースに改訂すること）
${currentAnnouncement}

## 主催者からの書き直し要望（これまでに伝えた分をすべて含む。すべて反映すること）
${historyText}
${styleDirective ? `\n## 文体の指定（本文全体をこの文体に統一すること）\n${styleDirective}\n` : ''}
## オフ会の情報（参考。矛盾があれば現在の詳細文より優先しない）
- タイトル: ${basics.title}
- 開催形態: ${basics.venueType === 'online' ? 'オンライン' : 'オフライン（対面）'}
${organizerNameDirective(profile.organizerName)}

## 改訂方針（重要）
- 現在の詳細文の内容・情報（日時・場所・定員など具体的な事実）を勝手に変えないこと。要望に関係ない部分はできるだけ元の文章を活かすこと
- テンプレート構成（■イベント・オフ会内容 / ■参加費用 / ■参加方法 / ■注意事項 / ▶ オフ会ガイドラインはこちら）は必ずそのまま維持すること。見出しを増減・変更しないこと
- 「■当日の流れ」セクションが残っている場合は丸ごと削除すること（当日の流れは主催者だけが見る別ページで管理し、公開情報には載せない方針になりました）
- 「■募集期限」セクションが残っている場合も丸ごと削除すること（募集期限はAIが勝手に決めず、主催者が必要なときだけ自分で書く方針になりました。ただし主催者からの要望で募集期限の記載を求められた場合はその内容で残してよい）
- 一文は短く（目安40文字以内）。長い文は分割し、文のまとまりごとに改行・話題の変わり目には空行を入れて、スマホでも読みやすくすること
- 「■参加方法」の本文2行目（「参加希望の方は、こちらのチャットに参加申請をお願いします。」）と、末尾の「▶ オフ会ガイドラインはこちら」「https://site.libecity.com/meetup-guidelines」の2行は、一字一句そのまま維持すること（絶対に変えない。文体の指定があっても、この2箇所と■見出しは文体変換の対象外）
- リベシティの仕様上、Markdown記法（# 見出し、**太字**、* 箇条書き など）は使用できません。絶対にアスタリスク「**」やシャープ「#」などのマークダウン記号は含めず、プレーンテキスト（空白行、改行、全角の「■」「▼」「・」など）を使って見やすく整形して出力してください${styleDirective ? '\n- 文体の指定は当たり障りのない範囲に薄めず、本文全体にはっきり効かせること。ただし日時・場所・定員・参加費などの事実は、文体を変えても正確なまま保つこと' : ''}

## タグ（tags）
現在のタグ内容も踏まえつつ、この会に合ったタグを3〜5個考えてください（要望に関係なければ内容を維持してよい）。「#」記号は付けないこと。

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。bodyに告知文全体、tagsにタグの配列を入れること。

\`\`\`json
{ "body": "...", "tags": ["...", "...", "...", "...", "..."] }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const body = String(parsed?.body || '');
  if (!body) {
    throw new Error('詳細（公開情報）の書き直し結果を読み取れませんでした。再度お試しください。');
  }
  const tags: string[] = Array.isArray(parsed?.tags)
    ? parsed.tags.map(String).filter(Boolean).slice(0, 5)
    : [];
  return {
    body: removeTimetableSection(ensureGuidelineFooter(body)),
    tags,
  };
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

export async function generateIconPromptServer(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea,
  basics: EventBasics
): Promise<IconPromptResult> {
  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
オフ会の円形チャットアイコンに使う素材を考えてください。

## オフ会の情報
- タイトル: ${basics.title}
- 内容: ${idea.summary}
- 雰囲気: ${concept.cherish.join('、')}

## 出力する素材
- word: アイコンを見ただけで「何をする会か」が伝わる文字（2〜8文字）
  - **必ず、その会の中身を決める言葉を含めること**（例: 家計簿、Notion、ボードゲーム、ふるさと納税、簿記3級）
  - 「もくもく」「交流」「朝活」「勉強会」「オフ会」のような、集まりの形式だけで終わらせてはいけない。
    形式を入れたい場合は、必ず内容の言葉と組み合わせる（○「家計簿もくもく」「Notion勉強会」／×「もくもく」「交流会」）
  - 悪い例: タイトルが「家計簿もくもく会」なのに word を「もくもく」にする。何の会か分からなくなるため禁止
  - 「会」「の会」で終える必要はない。内容が伝わることを最優先する
  - タイトルにある言葉を使う場合は一字一句正確にコピーすること。文字の脱落・変更は厳禁（例:「スキルマ」を「スキマ」と書かない）
  - 動詞・文の断片・助詞付き表現は禁止。必ず名詞で終えること
- motif: オフ会の内容を象徴する具体的なモチーフ1つ（15文字以内。例: サイコロとカード、湯気の立つコーヒー、芽が出た貯金箱）
- emoji: そのモチーフに最も近い絵文字1つ
- colorPalette: この会の雰囲気に合う配色（30文字以内）。主役の色と背景の色が分かるように具体的な色名で書く
  （例: 「生成りの背景に、若草色と山吹色」「濃紺の背景に、白とゴールド」）

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。

\`\`\`json
{ "word": "...", "motif": "...", "emoji": "...", "colorPalette": "...", "styleNote": "主催者向けの補足（生成のコツ、40文字以内）" }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const word = String(parsed?.word || '').trim();
  const motif = String(parsed?.motif || '').trim();
  if (!word) {
    throw new Error('アイコン用素材の生成結果を読み取れませんでした。再度お試しください。');
  }
  const colorPalette = String(parsed?.colorPalette || '').trim();
  return {
    word,
    motif: motif || word,
    emoji: String(parsed?.emoji || '🎉').trim() || '🎉',
    colorPalette,
    candidates: buildIconPromptCandidates(word, motif || word, colorPalette),
    styleNote: String(parsed?.styleNote || ''),
  };
}

export async function generateThumbnailAssetsServer(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea,
  basics: EventBasics,
  formattedDate: string
): Promise<ThumbnailAssets> {
  const venueLabel = venueLabelOf(basics);
  const dateTimeText = `${formattedDate} ${basics.startTime}〜`;
  const placeText = venueLabel;

  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
オフ会の「告知サムネイル画像」を画像生成AI（ChatGPT/Gemini等）で作るためのプロンプトを作ってください。
この画像には、キャッチーなタイトル・日時・場所の文字を実際に描き込みます（あとからの文字入れは行いません）。

## オフ会の情報
- タイトル: ${basics.title}
- 内容: ${idea.summary}
- 雰囲気: ${concept.cherish.join('、')}

## 画像に描き込む文字（この文言・表記のまま使うこと）
- 日時: 「${dateTimeText}」
- 場所: 「${placeText}」
※ キャッチーなタイトルはあなたが考え、そのままimagePrompt内で使うこと

## imagePromptの必須条件（プロンプト文に必ず含めること）
- プロンプトは必ず「あなたはプロのデザイナーです。」という一文で書き始めること
- 横長（16:9）の告知バナー構図
- 会の内容が伝わる構図（人物が楽しそうに集まる様子など、内容が伝わるモチーフを指示する）
- あなたが考えたキャッチーなタイトル（20文字以内）を、画像内で最も大きく目立つように配置すること
- 日時「${dateTimeText}」と場所「${placeText}」を、タイトルより小さく読みやすいサイズで画像内に配置すること
- 文字は背景との十分なコントラストを確保し、はっきり読めるようにすること
- 明るく参加したくなる配色
- 「参考画像（オフ会のチャットアイコンなど）が添付されている場合は、その画像のキャラクターやモチーフを、雰囲気を損なわないよう自然にサムネイル内へ配置・反映すること。」という一文を必ず含めること

## imagePromptに書いてはいけないこと
- 画風・タッチ・質感（実写風、イラスト風、3D風、水彩、ポップなど）の指定。画風はこのツールがあとから別の行として付け足すため、ここで指定すると二重になる
- 「画風は指定しない」「画風はツール側で付与」のような断り書き。これは主催者向けの説明ではなく、あなたへの制約なので、プロンプト文には一切書かない

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。imagePromptに完成したプロンプト全文を入れること。

\`\`\`json
{ "imagePrompt": "..." }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  if (!parsed?.imagePrompt) {
    throw new Error('サムネイル素材の生成結果を読み取れませんでした。再度お試しください。');
  }
  return {
    imagePrompt: ensureDesignerPrefix(stripStyleDisclaimer(String(parsed.imagePrompt))),
  };
}

export async function reviseThumbnailPromptServer(
  apiKey: string,
  currentPrompt: string,
  feedbackHistory: string[],
  formattedDate: string
): Promise<ThumbnailAssets> {
  const historyText =
    feedbackHistory.length > 0
      ? feedbackHistory.map((f, i) => `${i + 1}. ${f}`).join('\n')
      : '（なし）';

  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
以下は、オフ会の「告知サムネイル画像」を画像生成AIで作るための現在のプロンプトです。
主催者からの修正要望を反映して、プロンプトを書き直してください。

## 現在のプロンプト（これをベースに調整すること）
${currentPrompt}

## 主催者からの修正要望（これまでに伝えた分をすべて含む。すべて反映すること）
${historyText}

## 参考情報
- オフ会の開催日: ${formattedDate}（「季節感を入れて」等の要望はこの時期の季節・行事・風物詩を反映すること）

## 調整方針（重要）
- 要望は当たり障りのない範囲に薄めず、要望の意図どおりに大胆に反映すること（例:「漫画風」なら集中線・コマ割り・吹き出し等の漫画的表現、「映画のLPクオリティ」ならシネマティックな光・質感・構図まで踏み込んで指示する）
- ただし以下の必須条件は必ず維持すること:
  - プロンプトは「あなたはプロのデザイナーです。」という一文で書き始める
  - 横長（16:9）の告知バナー構図
  - 現在のプロンプトにあるタイトル・日時・場所の文字（文言・表記そのまま）を画像内に配置する指示を残す
  - 文字は背景との十分なコントラストを確保し、はっきり読めるようにする指示を残す
  - 参考画像（チャットアイコン等）添付時の反映指示の一文を残す
- 画風について:
  - 現在のプロンプトに「画風は指定しない」「画風はツール側で付与」のような断り書きがあれば、それは削除する（主催者向けの文ではない）
  - 主催者の要望に画風・タッチの指定（漫画風、実写風、水彩など）が含まれる場合だけ、その画風をプロンプト文に書く。要望に無ければ画風には触れない

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。imagePromptに完成したプロンプト全文を入れること。

\`\`\`json
{ "imagePrompt": "..." }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  if (!parsed?.imagePrompt) {
    throw new Error('サムネイルプロンプトの修正結果を読み取れませんでした。再度お試しください。');
  }
  return {
    imagePrompt: ensureDesignerPrefix(stripStyleDisclaimer(String(parsed.imagePrompt))),
  };
}

export async function generateShareTextsServer(
  apiKey: string,
  announcement: string,
  basics: EventBasics,
  region: string,
  formattedDate: string,
  organizerName?: string,
  feedbackHistory: string[] = [],
  styleDirective = ''
): Promise<ShareTexts> {
  const historyText =
    feedbackHistory.length > 0
      ? feedbackHistory.map((f, i) => `${i + 1}. ${f}`).join('\n')
      : '';
  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会企画をサポートするAIです。
以下のオフ会告知文をもとに、2つの場所に投稿する文章を作ってください。

## 元の告知文
${announcement}

## オフ会の基本情報
- タイトル: ${basics.title}
- 日時: ${formattedDate} ${basics.startTime}〜
- 主催者の地域: ${region || '未記入'}
${organizerNameDirective(organizerName || '')}
${historyText ? `\n## 主催者からの書き直し要望（これまでに伝えた分をすべて含む。両方の文章に反映すること）\n${historyText}\n` : ''}${styleDirective ? `\n## 文体の指定（両方の文章をこの文体に統一すること）\n${styleDirective}\n` : ''}
## 作る文章
1. regionalChat: 地域支部チャット（例: 関東チャット）向け
   - 「${region || '地域'}の皆さん」への呼びかけで始める
   - ${styleDirective ? '文体は上記「文体の指定」に従う（丁寧さより文体を優先）。長さは300〜400文字程度' : '丁寧め・300〜400文字程度'}
   - 日時・場所・定員を含める
2. tweet: リベシティの「つぶやき」向け
   - ${styleDirective ? '文体は上記「文体の指定」に従う。' : 'カジュアル。'}文字数制限は撤廃。オフ会の魅力・日時・場所・参加方法などを詳しく書いてよい（ただし冗長になりすぎない範囲で）
   - 絵文字を使って気軽な雰囲気に
   - 「初主催」「初めて主催する」等は、元の告知文に本人がそう書いている場合のみ触れてよく、書かれていない場合は絶対に書かないこと（事実と異なる可能性があるため）

## チャットURLの入れ方（両方の文章に必ず適用）
- 文章の終盤に、参加申請を呼びかける一文（例:「🌟参加希望の方はこちらのチャットから参加申請をお願いします！」）を入れること
- その呼びかけ文の直後の行に {チャットURL} とだけ書くこと（この文字列はアプリ側で実際のURLに置き換えるので、一字一句そのまま出力する。自分でURLを作らないこと）
- 呼びかけ文とURL行の後に、短い締めの一言を続けてもよい

## 注意
- 主催者本人の名前には「さん」など敬称を付けないこと（一人称）。参加者や他の人には従来通り敬称OK
- 募集期限は、元の告知文に書かれている場合を除く、勝手に決めて書かないこと
- リベシティの仕様上、Markdown記法（# 見出し、**太字**、* 箇条書き など）は使用できません。絶対にアスタリスク「**」やシャープ「#」などのマークダウン記号は含めず、プレーンテキスト（空白行、改行、絵文字、全角の「■」「・」など）で見やすく整形して出力すること${historyText ? '\n- 書き直し要望は当たり障りのない範囲に薄めず、要望の意図どおりに反映すること' : ''}

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。

\`\`\`json
{ "regionalChat": "...", "tweet": "..." }
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  if (!parsed?.regionalChat && !parsed?.tweet) {
    throw new Error('展開用文章の生成結果を読み取れませんでした。再度お試しください。');
  }
  return {
    regionalChat: String(parsed.regionalChat || ''),
    tweet: String(parsed.tweet || ''),
  };
}

export async function generateSurveyPlanServer(
  apiKey: string,
  concept: IdeaConcept,
  idea: PlanIdea,
  basics: EventBasics,
  organizerName: string
): Promise<SurveyPlan> {
  const venueLabel = venueLabelOf(basics);
  const prompt = `あなたはリベシティ（オンラインコミュニティ）のオフ会をサポートするAIです。
オフ会が終わったあとに参加者へ配る「開催後アンケート」を設計してください。Googleフォームで配ります。

## オフ会の情報
- タイトル: ${basics.title}
- 内容: ${idea.summary}
- 大切にしたいこと: ${concept.cherish.join('、')}
- 開催場所: ${venueLabel}
- 主催者名: ${organizerName || '主催者'}

## 設計のルール
- 回答は2〜3分で終わる分量にする。設問は7〜9問まで
- 本名・住所・連絡先などの個人情報は聞かない
- 選択式で分かることは選択式にし、自由記述は理由の深掘りだけに絞る
- 自由記述には「1〜2行でOK」「箇条書きでも大丈夫です」のような短く書ける案内を helpText に入れる
- 主催者が次回の判断に使える情報を集める。感想を集めるだけで終わらせない
- 「参加してよかったか」だけでなく「次に何をしてほしいか」を必ず1問入れる
- 断定的な言い方（改善します、必ず反映します）は避け、「次回の参考にします」程度にとどめる
- 設問文は話し言葉でやわらかく。堅い敬語や事務的な言い回しにしない

## 必ず入れる設問（この順番で）
1) リベネーム（TEXT・必須）「リベシティでの表示名（リベネーム）を教えてください」
2) 参加のきっかけ（CHECKBOX・必須）オフ会の内容に沿った選択肢を作り、「その他」を必ず含める
3) 満足度（RADIO・必須）「とても満足」「満足」「どちらともいえない」「やや不満」「不満」
4) 進行や時間配分について（RADIO・必須）「ちょうどよかった」「少し長かった」「少し短かった」など
5) よかったところ（PARAGRAPH・必須）1〜2行でOKと案内する
6) 次に取り上げてほしいテーマ（PARAGRAPH または CHECKBOX・必須）
7) また参加したいか（RADIO・必須）
8) 主催者へひとこと（PARAGRAPH・任意）「もしよければ、ひとこといただけると励みになります（任意）」

## そのほかに出すもの
- thanksMessage: 回答し終えた直後にフォーム上へ表示されるお礼文（80〜150文字）。
  主催者本人の言葉として書く。参加への感謝と、次につながる一言を入れる。堅くしない
- headerImagePrompt: このアンケートのGoogleフォームに置くヘッダー画像を、画像生成AIで作るためのプロンプト全文。
  「あなたはプロのデザイナーです。」で書き始め、横長のバナー（1600x400程度）であること、
  オフ会の内容が伝わるモチーフ、文字は入れても短く読みやすくすること、
  上部と左右に余白を取ること（フォームで見切れるため）を必ず含める

## 出力形式（JSON）
必ず有効なJSONのみを出力してください。typeは TEXT / PARAGRAPH / RADIO / CHECKBOX のいずれか。

\`\`\`json
{
  "formTitle": "...",
  "formDescription": "...",
  "questions": [
    { "title": "...", "type": "TEXT", "required": true, "helpText": "..." },
    { "title": "...", "type": "CHECKBOX", "required": true, "options": ["...", "その他"], "helpText": "..." }
  ],
  "thanksMessage": "...",
  "headerImagePrompt": "..."
}
\`\`\``;

  const text = await callGemini(apiKey, prompt);
  const parsed = extractJSON(text);
  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const allowed = ['TEXT', 'PARAGRAPH', 'RADIO', 'CHECKBOX'];
  const questions: SurveyQuestionDef[] = rawQuestions
    .map((q: any) => {
      const type = allowed.includes(String(q?.type)) ? String(q.type) : 'PARAGRAPH';
      const options = Array.isArray(q?.options) ? q.options.map((o: any) => String(o)).filter(Boolean) : undefined;
      return {
        title: String(q?.title || '').trim(),
        type: type as SurveyQuestionDef['type'],
        // 選択式なのに選択肢が無いと、貼り付けたGASがフォーム作成時に落ちる
        options: type === 'RADIO' || type === 'CHECKBOX' ? (options && options.length > 0 ? options : ['はい', 'いいえ']) : undefined,
        required: q?.required !== false,
        helpText: q?.helpText ? String(q.helpText) : undefined,
      };
    })
    .filter((q: SurveyQuestionDef) => q.title);

  if (questions.length === 0) {
    throw new Error('アンケートの設問を読み取れませんでした。再度お試しください。');
  }

  return {
    formTitle: String(parsed?.formTitle || `${basics.title} アンケート`).trim(),
    formDescription: String(parsed?.formDescription || '').trim(),
    questions,
    thanksMessage: String(parsed?.thanksMessage || 'ご参加ありがとうございました！').trim(),
    headerImagePrompt: String(parsed?.headerImagePrompt || '').trim(),
  };
}
