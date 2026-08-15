import React, { useState, useMemo, useEffect } from 'react';
import { ShareTexts, EventBasics, StyleLane } from '../types';
import { BRANCH_CHATS, OVICE_CHAT_URL, branchChatUrl, guessBranch } from '../constants';
import { formatEventDateJa, extractAnnouncementSection } from '../utils/time';
import { ChevronLeftIcon, RefreshIcon, CopyIcon, CheckIcon, SendIcon, KanpaiIcon } from './icons';
import LaneTabs from './LaneTabs';
import PlayfulStylePicker from './PlayfulStylePicker';

/** oVice内イベント告知の定型テンプレート（リベシティのoViceチャットの公式テンプレに準拠） */
function buildOviceEventText(basics: EventBasics, announcement: string, organizerName: string): string {
  const detail = extractAnnouncementSection(announcement, '■イベント・オフ会内容') || basics.title;
  const dateLine = basics.date
    ? `${formatEventDateJa(basics.date)} ${basics.startTime}〜（${basics.durationMinutes}分）`
    : '';
  return [
    '━━━━━━━━━━━━━━━━━━━',
    '',
    '📢 ovice内イベントを開催します！',
    '',
    '━━━━━━━━━━━━━━━━━━━',
    '',
    '■ イベント名',
    basics.title || '（未定）',
    '',
    '■ 日時',
    dateLine || '（未定）',
    '',
    '■ イベント運営メンバー',
    organizerName || '（お名前）',
    '',
    '■ イベント内容詳細',
    detail,
  ].join('\n');
}

const CHAT_URL_PLACEHOLDER = '{チャットURL}';

/**
 * 本文中の {チャットURL} プレースホルダーを実際のURLに置き換える。
 * URL未入力ならプレースホルダー行を取り除く。
 * プレースホルダーが無い旧データは従来どおり末尾にURLを付ける。
 */
function applyChatUrl(text: string, chatUrl: string): string {
  const url = chatUrl.trim();
  if (text.includes(CHAT_URL_PLACEHOLDER)) {
    if (url) return text.split(CHAT_URL_PLACEHOLDER).join(url).trim();
    return text
      .split('\n')
      .filter((l) => l.trim() !== CHAT_URL_PLACEHOLDER)
      .join('\n')
      .trim();
  }
  return url ? `${text.trim()}\n\n${url}` : text.trim();
}

/** 本文プリセット済みのつぶやき作成画面URL（既存ツールと同じ導線） */
function buildLibetterUrl(text: string): string {
  return `https://libecity.com/tweet/all?create=${encodeURIComponent(text)}`;
}

interface ShareStepProps {
  shareTexts: ShareTexts | null;
  basics: EventBasics;
  region: string;
  offkaiChatUrl: string;
  announcement: string;
  organizerName: string;
  onChangeChatUrl: (url: string) => void;
  /** feedbackが空文字の場合は同条件での作り直し、それ以外は要望を反映して作り直す。
   *  遊び心版のときは、この画面で選んだ文体をstyleとして渡す */
  onGenerate: (feedback: string, style?: { preset: string; custom: string }) => void;
  /** これまでに蓄積された「書き直してほしい点」の履歴（オフ会ごと・レーンごと） */
  feedbackHistory?: string[];
  /** このステップで開いている版（詳細・チャット作成とは独立） */
  styleLane: StyleLane;
  onChangeLane: (lane: StyleLane) => void;
  /** 遊び心版の告知文を作れるか（土台になる詳細文があるか） */
  playfulAvailable: boolean;
  /** タブに添える文体名（未指定なら空文字） */
  playfulLabel: string;
  playfulStylePreset: string;
  playfulStyleCustom: string;
  onBack: () => void;
  onFinish: () => void;
}

function CopyCard({
  title,
  hint,
  text,
}: {
  title: string;
  hint: string;
  text: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // noop
    }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        <button
          onClick={handleCopy}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            copied ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white hover:bg-slate-700'
          }`}
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">{hint}</p>
      <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-xl p-4 whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

export default function ShareStep({
  shareTexts,
  basics,
  region,
  offkaiChatUrl,
  announcement,
  organizerName,
  onChangeChatUrl,
  onGenerate,
  feedbackHistory = [],
  styleLane,
  onChangeLane,
  playfulAvailable,
  playfulLabel,
  playfulStylePreset,
  playfulStyleCustom,
  onBack,
  onFinish,
}: ShareStepProps) {
  const tweetFinal = shareTexts ? applyChatUrl(shareTexts.tweet, offkaiChatUrl) : '';
  const [feedback, setFeedback] = useState('');
  const [preset, setPreset] = useState(playfulStylePreset);
  const [custom, setCustom] = useState(playfulStyleCustom);

  // 詳細ステップ側で文体を選び直したときに追従する（文体はオフ会ごとに1つ）
  useEffect(() => { setPreset(playfulStylePreset); }, [playfulStylePreset]);
  useEffect(() => { setCustom(playfulStyleCustom); }, [playfulStyleCustom]);

  const playful = styleLane === 'playful';
  const styleChosen = !!preset || !!custom.trim();
  const styleArg = playful ? { preset, custom } : undefined;

  const handleRegenerate = () => {
    onGenerate(feedback, styleArg);
    setFeedback('');
  };
  const isOvice = basics.venueType === 'online' && basics.onlineTool === 'oVice';
  const oviceText = useMemo(
    () => buildOviceEventText(basics, announcement, organizerName),
    [basics, announcement, organizerName]
  );

  // 支部チャット: プロフィールの地域から自動推定し、手動でも選べる（oVice開催時は使わない）
  const guessed = useMemo(() => guessBranch(region), [region]);
  const [branchId, setBranchId] = useState<string>(guessed?.id || '');
  const branch = BRANCH_CHATS.find((b) => b.id === branchId) || null;

  return (
    <div className="max-w-2xl mx-auto py-8 animate-fade-in">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">みんなに知らせましょう</h2>
      <p className="text-sm text-slate-500 mb-6">
        支部チャットとつぶやきで、作成したオフ会チャットへの参加を呼びかけましょう。
      </p>

      <LaneTabs
        lane={styleLane}
        onChange={onChangeLane}
        styleName={playfulLabel}
        playfulEnabled={playfulAvailable}
        hint="ここでの選択は告知文だけに効きます。「みんなへの案内」や「チャットを立てる」で選んだ版は変わりません"
      />

      {playful && (
        <div className="bg-rose-50/60 border border-rose-200 rounded-2xl p-4 mb-4">
          <p className="text-xs font-semibold text-rose-700 mb-2">どんな文体にしますか？</p>
          <PlayfulStylePicker
            preset={preset}
            custom={custom}
            onChangePreset={setPreset}
            onChangeCustom={setCustom}
            inputId="sharePlayfulStyleCustom"
            madeWithLabel={playfulLabel}
          />
          <p className="text-[11px] text-slate-500">
            詳細（公開情報）の遊び心版がある場合はそれを、無い場合は標準版を土台に文体を乗せて作ります
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <label htmlFor="offkaiChatUrl" className="block text-xs font-semibold text-slate-700 mb-1">
          作成したオフ会チャットのURL（つぶやきに自動で添付されます）
        </label>
        <input
          id="offkaiChatUrl"
          type="url"
          value={offkaiChatUrl}
          onChange={(e) => onChangeChatUrl(e.target.value)}
          placeholder="https://libecity.com/room_list?room_id=..."
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
        />
      </div>

      {shareTexts ? (
        <div className="space-y-4 mb-8">
          {isOvice ? (
            <>
              {/* oVice開催時: 支部チャットではなく oVice内イベントチャットへ誘導 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                  <h3 className="text-sm font-bold text-slate-700">投稿先：oVice内イベントチャット</h3>
                  <a
                    href={OVICE_CHAT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 transition-colors"
                  >
                    <SendIcon size={13} />
                    oViceチャットを開く
                  </a>
                </div>
                <p className="text-xs text-slate-400">
                  oVice開催のため、支部チャットではなくオンラインスペース（oVice）専用のイベントチャットに投稿しましょう。
                </p>
              </div>

              <CopyCard
                title="oViceチャット向け（公式テンプレート形式）"
                hint="上のボタンでoViceチャットを開き、この文章を貼り付けてください（オフ会チャットのリンクも自動で末尾に付きます）"
                text={applyChatUrl(
                  `${oviceText}\n\n🌟参加希望の方はこちらのチャットから参加申請をお願いします！\n${'{チャットURL}'}`,
                  offkaiChatUrl
                )}
              />
            </>
          ) : (
            <>
              {/* 支部チャットの選択と直リンク */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                  <h3 className="text-sm font-bold text-slate-700">投稿先の支部チャット</h3>
                  {branch && (
                    <a
                      href={branchChatUrl(branch.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 transition-colors"
                    >
                      <SendIcon size={13} />
                      {branch.name}チャットを開く
                    </a>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-2">
                  {guessed ? `プロフィールの地域から「${guessed.name}」を推定しました。違う場合は選び直してください。` : 'お住まいの地域の公式支部チャットを選んでください。'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BRANCH_CHATS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBranchId(b.id)}
                      aria-pressed={branchId === b.id}
                      className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                        branchId === b.id
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>

              <CopyCard
                title={`${branch ? branch.name : `${region || '地域'}支部`}チャット向け`}
                hint="上のボタンで支部チャットを開き、この文章を貼り付けてください（オフ会チャットのリンクも自動で末尾に付きます）"
                text={applyChatUrl(shareTexts.regionalChat, offkaiChatUrl)}
              />
            </>
          )}

          {/* つぶやき: すぐ呟ける導線 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-slate-700">つぶやき向け</h3>
              <a
                href={buildLibetterUrl(tweetFinal)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 transition-colors"
              >
                <SendIcon size={13} />
                この内容でつぶやく
              </a>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              ボタンを押すと、本文が入力済みのつぶやき画面が開きます
              {offkaiChatUrl ? '（前のステップで入力したオフ会チャットURLも自動で結合）' : '（オフ会チャットURLは前のステップで入力できます）'}
            </p>
            <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-xl p-4 whitespace-pre-wrap">
              {tweetFinal}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {tweetFinal.length}文字
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <label htmlFor="shareFeedback" className="block text-xs font-semibold text-slate-600 mb-1.5">
              AIに書き直してほしい点を教えてください
            </label>
            {feedbackHistory.length > 0 && (
              <p className="text-[11px] text-slate-400 mb-2">
                これまでに伝えた指示（{feedbackHistory.length}件）を踏まえて書き直します: {feedbackHistory.join(' / ')}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mb-3" aria-label="おすすめの指示">
              {[
                'もっとカジュアルに',
                '悩み解決型の訴求で',
                'ワクワク感を前面に',
                '初心者歓迎を強調',
                '絵文字を多めに',
                '絵文字を少なめに',
                '短くまとめて',
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setFeedback((prev) => (prev ? `${prev}、${chip}` : chip))}
                  className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600 text-xs hover:border-sky-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                >
                  ＋ {chip}
                </button>
              ))}
            </div>
            <textarea
              id="shareFeedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="例: もっとカジュアルに／絵文字を減らして／短くまとめて"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white mb-2"
            />
            <button
              onClick={handleRegenerate}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-white border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
            >
              <RefreshIcon size={13} />
              文章を作り直す
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center mb-8">
          <p className="text-sm text-slate-500 mb-4">
            {playful
              ? '上で文体を選んで、遊び心版の告知文を作ります'
              : '支部チャット用・つぶやき用の文章を作ります'}
          </p>
          <button
            onClick={() => onGenerate('', styleArg)}
            disabled={!playfulAvailable || (playful && !styleChosen)}
            className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
              playful ? 'bg-rose-500 hover:bg-rose-600' : 'bg-sky-600 hover:bg-sky-700'
            }`}
          >
            展開用の文章を生成する
          </button>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-5 py-2.5 rounded-full bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
        >
          <ChevronLeftIcon size={16} />
          戻る
        </button>
        <button
          onClick={onFinish}
          className="inline-flex items-center gap-2 px-8 py-3 rounded-full bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
        >
          <KanpaiIcon size={17} />
          これで準備完了！
        </button>
      </div>
    </div>
  );
}
