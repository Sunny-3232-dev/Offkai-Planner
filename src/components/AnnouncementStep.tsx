import React, { useEffect, useState } from 'react';
import { VenueType, StyleLane } from '../types';
import { ArrowRightIcon, ChevronLeftIcon, RefreshIcon } from './icons';
import LaneTabs from './LaneTabs';
import PlayfulStylePicker from './PlayfulStylePicker';

interface AnnouncementStepProps {
  announcement: string;
  venueType: VenueType;
  /** バックグラウンド先行生成が進行中かどうか */
  loading?: boolean;
  onChange: (text: string) => void;
  /** feedbackが空文字の場合は初回生成（同条件での再生成）、それ以外は要望を反映して書き直す */
  onRegenerate: (feedback: string) => void;
  /** これまでに蓄積された「書き直してほしい点」の履歴（オフ会ごと・レーンごと） */
  feedbackHistory?: string[];
  /** 進行イメージから自動挿入される「■当日の流れ」セクション（空なら挿入なし） */
  timetableSection?: string;
  /** このステップで開いている版（チャット作成・告知とは独立） */
  styleLane: StyleLane;
  onChangeLane: (lane: StyleLane) => void;
  /** 標準版の本文があるか。遊び心版は標準版を土台に作るため、無いと生成できない */
  standardReady: boolean;
  playfulStylePreset: string;
  playfulStyleCustom: string;
  /** 遊び心版が実際に作られたときの文体名。まだ無ければ空文字 */
  playfulLabel: string;
  onGeneratePlayful: (preset: string, custom: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function AnnouncementStep({
  announcement,
  venueType,
  loading = false,
  onChange,
  onRegenerate,
  feedbackHistory = [],
  timetableSection = '',
  styleLane,
  onChangeLane,
  standardReady,
  playfulStylePreset,
  playfulStyleCustom,
  playfulLabel,
  onGeneratePlayful,
  onNext,
  onBack,
}: AnnouncementStepProps) {
  const [feedback, setFeedback] = useState('');
  const [preset, setPreset] = useState(playfulStylePreset);
  const [custom, setCustom] = useState(playfulStyleCustom);

  // 別のオフ会を開いたときなど、外から文体が入れ替わったら追従する
  useEffect(() => { setPreset(playfulStylePreset); }, [playfulStylePreset]);
  useEffect(() => { setCustom(playfulStyleCustom); }, [playfulStyleCustom]);

  const playful = styleLane === 'playful';
  const styleChosen = !!preset || !!custom.trim();

  const handleRewrite = () => {
    onRegenerate(feedback);
    setFeedback('');
  };

  return (
    <div className="max-w-2xl mx-auto py-8 animate-fade-in">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">みんなへの案内文ができました</h2>
      <p className="text-sm text-slate-500 mb-6">
        オフ会チャット作成フォームの「詳細（公開情報）」欄にそのまま貼れる文章を作りました。
        自分の言葉に直したいところは自由に編集してください。
        丁寧な標準版と、文体で遊んだ版を2つ持っておいて、見比べて選べます。
      </p>

      <LaneTabs
        lane={styleLane}
        onChange={onChangeLane}
        styleName={playfulLabel}
        hint="2つの版はどちらも残ります。どちらを使うかはチャット作成・告知でも別々に選べます"
      />

      {playful && (
        <div className="bg-rose-50/60 border border-rose-200 rounded-2xl p-4 mb-4">
          <p className="text-xs font-semibold text-rose-700 mb-2">どんな文体にしますか？</p>
          <PlayfulStylePicker
            preset={preset}
            custom={custom}
            onChangePreset={setPreset}
            onChangeCustom={setCustom}
            inputId="announcementPlayfulStyleCustom"
            madeWithLabel={playfulLabel}
          />
          <button
            onClick={() => onGeneratePlayful(preset, custom)}
            disabled={!standardReady || !styleChosen || loading}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow"
          >
            <RefreshIcon size={13} />
            {loading ? '書いています...' : announcement ? 'この文体で作り直す' : 'この文体で作る'}
          </button>
          <p className="mt-2 text-[11px] text-slate-500">
            {standardReady
              ? '標準版の内容（日時・場所・定員）はそのままに、文体だけを変えて作ります'
              : '先に標準版の詳細（公開情報）を作ってください'}
          </p>
        </div>
      )}

      {announcement ? (
        <>
          <div className="relative mb-4">
            <textarea
              value={announcement}
              onChange={(e) => onChange(e.target.value)}
              rows={20}
              aria-label="詳細（公開情報）"
              className="w-full px-4 py-4 text-sm leading-relaxed border border-slate-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
            />
          </div>
          <p className="text-xs text-slate-400 mb-4">{announcement.length}文字</p>

          {timetableSection && (
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 mb-4">
              <p className="text-xs font-semibold text-sky-700 mb-1.5">
                進行イメージから自動で追記されます（チャット作成時のコピーに含まれます）
              </p>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                {timetableSection}
              </p>
              <p className="mt-1.5 text-[11px] text-sky-600/70">
                内容を変えたい場合は進行イメージのステップで編集してください。載せたくない場合も進行イメージのステップでOFFにできます
              </p>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-8">
            <label htmlFor="announcementFeedback" className="block text-xs font-semibold text-slate-600 mb-1.5">
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
                '絵文字を多めに',
                '絵文字を少なめに',
                '自己紹介を手厚く',
                '初心者歓迎を強調',
                // 対面は途中参加・退出を安易にOKにすると安全面のリスクがあるため、オンラインのみ表示
                ...(venueType === 'online' ? ['途中参加・退出OKも書く'] : []),
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
              id="announcementFeedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="例: もっとカジュアルな文体にしてほしい／絵文字を減らしてほしい／自己紹介をもっと詳しく書いてほしい"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white mb-2"
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <button
                onClick={handleRewrite}
                disabled={!feedback.trim()}
                className="self-start inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow"
              >
                <RefreshIcon size={13} />
                この内容で書き直す
              </button>
            </div>
          </div>
        </>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center mb-8">
          <div className="inline-block w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-500" role="status">
            AIが詳細（公開情報）の文章を書いています...（そのままお待ちください）
          </p>
        </div>
      ) : playful ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center mb-8">
          <p className="text-sm text-slate-500">
            まだ遊び心版がありません。上で文体を選んで「この文体で作る」を押してください
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center mb-8">
          <p className="text-sm text-slate-500 mb-4">まだ詳細（公開情報）の文章がありません</p>
          <button
            onClick={() => onRegenerate('')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors"
          >
            AIに書いてもらう
          </button>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-5 py-2.5 rounded-full bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
        >
          <ChevronLeftIcon size={16} />
          進行イメージに戻る
        </button>
        <button
          onClick={onNext}
          disabled={!announcement}
          className="inline-flex items-center gap-2 px-8 py-3 rounded-full bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg shadow-sky-600/20"
        >
          画像を用意する
          <ArrowRightIcon size={18} />
        </button>
      </div>
    </div>
  );
}
