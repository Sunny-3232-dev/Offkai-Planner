import React, { useState } from 'react';
import { SurveyPlan } from '../types';
import { buildSurveyGasCode } from '../services/geminiService';
import { ArrowRightIcon, ChevronLeftIcon, RefreshIcon, CopyIcon, CheckIcon, SendIcon } from './icons';

interface SurveyStepProps {
  surveyPlan: SurveyPlan | null;
  loading: boolean;
  onGenerate: () => void;
  /** お礼メッセージの手直し（GASコードにも即反映される） */
  onChangeThanks: (text: string) => void;
  onFinish: () => void;
  onBack: () => void;
}

const GAS_URL = 'https://script.google.com/home/projects/create';

function CopyButton({ text, label = 'コピー' }: { text: string; label?: string }) {
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
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors ${
        copied ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white hover:bg-slate-700'
      }`}
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      {copied ? 'コピーしました' : label}
    </button>
  );
}

const TYPE_LABEL: Record<string, string> = {
  TEXT: '短い記述',
  PARAGRAPH: '記述',
  RADIO: '1つ選ぶ',
  CHECKBOX: '複数選べる',
  SCALE: '段階',
};

export default function SurveyStep({
  surveyPlan,
  loading,
  onGenerate,
  onChangeThanks,
  onFinish,
  onBack,
}: SurveyStepProps) {
  const [codeOpen, setCodeOpen] = useState(false);
  const gasCode = surveyPlan ? buildSurveyGasCode(surveyPlan) : '';

  return (
    <div className="max-w-2xl mx-auto py-8 animate-fade-in">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">終わったあとの声を集めましょう</h2>
      <p className="text-sm text-slate-500 mb-6">
        開催後に配るアンケートを用意します。コードを貼り付けるだけでGoogleフォームができます。
        次回やるかどうか、何を変えるかの判断材料になります。
      </p>

      {!surveyPlan ? (
        loading ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center mb-8" role="status" aria-live="polite">
            <div className="flex justify-center mb-3">
              <div className="w-8 h-8 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin-slow" aria-hidden="true" />
            </div>
            <p className="text-sm text-slate-500">アンケートを設計しています...</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center mb-8">
            <p className="text-sm text-slate-500 mb-4">この会に合わせたアンケートをAIが作ります</p>
            <button
              onClick={onGenerate}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors"
            >
              アンケートを作ってもらう
            </button>
          </div>
        )
      ) : (
        <>
          {/* 設問のプレビュー */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
            <h3 className="text-sm font-bold text-slate-700 mb-1">{surveyPlan.formTitle}</h3>
            {surveyPlan.formDescription && (
              <p className="text-xs text-slate-500 mb-3 whitespace-pre-wrap">{surveyPlan.formDescription}</p>
            )}
            <ol className="space-y-2">
              {surveyPlan.questions.map((q, i) => (
                <li key={`${q.title}-${i}`} className="border-l-2 border-sky-200 pl-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-700">
                      {i + 1}. {q.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                      {TYPE_LABEL[q.type] || q.type}
                    </span>
                    {!q.required && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 shrink-0">任意</span>
                    )}
                  </div>
                  {q.options && q.options.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-0.5">{q.options.join(' / ')}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* 回答後のお礼（手で直せる） */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
            <label htmlFor="thanksMessage" className="block text-sm font-bold text-slate-700 mb-1">
              回答したあとに表示されるお礼
            </label>
            <p className="text-[11px] text-slate-400 mb-2">
              送信ボタンを押した参加者に、この文章が表示されます。自分の言葉に直してください
            </p>
            <textarea
              id="thanksMessage"
              value={surveyPlan.thanksMessage}
              onChange={(e) => onChangeThanks(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
            />
          </div>

          {/* GASコード */}
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <h3 className="text-sm font-bold text-sky-800">フォームを作るコード</h3>
              <CopyButton text={gasCode} label="コードをコピー" />
            </div>
            <ol className="text-xs text-sky-700 space-y-1 list-decimal list-inside mb-3">
              <li>上のボタンでコードをコピーします</li>
              <li>下のボタンでApps Scriptを開き、最初から入っているコードを全部消します</li>
              <li>貼り付けて、上の「実行」を押します（初回は許可を求められます）</li>
              <li>下部のログに出てくる「回答用URL」を参加者へ配ります</li>
            </ol>
            <a
              href={GAS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors"
            >
              <SendIcon size={15} />
              Apps Scriptを開く
            </a>
            <button
              type="button"
              onClick={() => setCodeOpen((v) => !v)}
              className="block mt-3 text-xs text-sky-700 hover:underline"
            >
              {codeOpen ? '▲ コードを隠す' : '▼ コードを表示'}
            </button>
            {codeOpen && (
              <pre className="mt-2 max-h-64 overflow-auto bg-white border border-sky-200 rounded-xl p-3 text-[11px] text-slate-600 whitespace-pre-wrap break-words">
                {gasCode}
              </pre>
            )}
          </div>

          {/* ヘッダー画像 */}
          {surveyPlan.headerImagePrompt && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                <h3 className="text-sm font-bold text-slate-700">フォームのヘッダー画像</h3>
                <CopyButton text={surveyPlan.headerImagePrompt} label="プロンプトをコピー" />
              </div>
              <p className="text-[11px] text-slate-400 mb-2">
                ChatGPTやGeminiに貼ると画像ができます。フォーム編集画面の上部から差し替えられます
              </p>
              <p className="text-xs text-slate-600 bg-slate-50 rounded-xl p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {surveyPlan.headerImagePrompt}
              </p>
            </div>
          )}

          <button
            onClick={onGenerate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-800 disabled:opacity-40 transition-colors mb-8"
          >
            <RefreshIcon size={13} />
            {loading ? '作り直しています...' : 'アンケートを作り直す'}
          </button>
        </>
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
          これで完成！
          <ArrowRightIcon size={18} />
        </button>
      </div>
    </div>
  );
}
