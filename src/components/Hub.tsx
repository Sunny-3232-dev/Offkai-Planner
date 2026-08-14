import React from 'react';
import { SavedEvent } from '../types';
import { APP_NAME, APP_TAGLINE, MAX_SAVED_EVENTS } from '../constants';
import { formatDateJa } from '../utils/time';
import { ArrowRightIcon, RefreshIcon, TrashIcon, UserIcon, LightbulbIcon, CalendarIcon, ClockIcon, FileTextIcon, ImageIcon, MessagePlusIcon, MegaphoneIcon } from './icons';
import { EntakuProgress } from './Entaku';

interface HubProps {
  hasProgress: boolean;
  events: SavedEvent[];
  activeEventId: string | null;
  canCreate: boolean;
  onStart: () => void;
  onResume: () => void;
  onOpenEvent: (id: string) => void;
  onDeleteEvent: (id: string) => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

const FLOW = [
  { Icon: UserIcon, title: 'あなたのこと', desc: '興味のあることと、開きたい場所を書くだけ' },
  { Icon: LightbulbIcon, title: 'どんな会にする？', desc: 'お金の5つのテーマ（貯める/稼ぐ/守る/増やす/使う）＋その他でAIが提案。気になる案はピン留め' },
  { Icon: CalendarIcon, title: 'いつ・どこで？', desc: 'タイトル・日時・場所・定員を決める' },
  { Icon: ClockIcon, title: '当日の流れ', desc: '何時に何をするか、ざっくり組み立て' },
  { Icon: FileTextIcon, title: 'みんなへの案内', desc: 'そのまま貼れる案内文ができる' },
  { Icon: ImageIcon, title: 'アイコンと画像', desc: 'チャットアイコンと告知画像のプロンプト' },
  { Icon: MessagePlusIcon, title: 'チャットを立てる', desc: 'コピペするだけでオフ会チャットが完成' },
  { Icon: MegaphoneIcon, title: 'みんなに知らせる', desc: 'チャットURLを添えて支部チャット・つぶやきへ' },
];

function eventTitle(ev: SavedEvent): string {
  return ev.snapshot.basics.title || ev.snapshot.idea?.title || '（タイトル未定）';
}

export default function Hub({
  hasProgress,
  events,
  activeEventId,
  canCreate,
  onStart,
  onResume,
  onOpenEvent,
  onDeleteEvent,
  onReset,
  onExport,
  onImport,
}: HubProps) {
  return (
    <div className="relative min-h-[70vh] flex flex-col items-center justify-center py-12 px-4">
      <div className="relative z-10 text-center max-w-2xl animate-fade-in">
        <div className="flex justify-center mb-3" aria-hidden="true"><EntakuProgress currentIdx={8} size={76} /></div>

        {/* サービス名は小さく添える程度にして、主役はキャッチにする */}
        <p className="font-hand text-sm sm:text-base tracking-[0.22em] text-slate-600">{APP_NAME}</p>
        <svg className="mx-auto mt-0.5 text-sky-500/80" width="172" height="11" viewBox="0 0 186 12" fill="none" aria-hidden="true">
          <path d="M3 7C40 2 62 9 96 6c30-3 52 3 87-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M92 6c3-3 7-1 5 2s-8 1-5-2z" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>

        <h1 className="font-hand text-4xl sm:text-5xl leading-[1.35] mt-6 text-slate-800">
          じゃあ、<span className="block text-sky-700">やってみようか。</span>
        </h1>
        <svg className="mx-auto mt-1 max-w-[85%] text-sky-500/80" width="300" height="15" viewBox="0 0 330 16" fill="none" aria-hidden="true">
          <path d="M6 11C74 4 138 12 210 6c40-3 76 4 114 1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>

        <p className="text-slate-600 mt-5 mb-1">{APP_TAGLINE}</p>
        <p className="text-sm text-slate-500 mb-8">
          「何から始めればいいかわからない」を、8つのステップに分けました。
        </p>

        {/* 保存済みのオフ会 */}
        {events.length > 0 && (
          <div className="mb-8 text-left">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-slate-700">あなたのオフ会</h2>
              <p className="text-xs text-slate-400">{events.length} / {MAX_SAVED_EVENTS}件</p>
            </div>
            <div className="space-y-2">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className={`flex items-center gap-3 bg-white rounded-xl border p-3 ${
                    ev.id === activeEventId ? 'border-sky-400 ring-1 ring-sky-200' : 'border-slate-200'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{eventTitle(ev)}</p>
                    <p className="text-xs text-slate-400">
                      {ev.snapshot.basics.date
                        ? `${formatDateJa(ev.snapshot.basics.date)} ${ev.snapshot.basics.startTime}〜`
                        : '日時未定'}
                      {ev.id === activeEventId ? '・編集中' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => onOpenEvent(ev.id)}
                    className="shrink-0 px-4 py-1.5 rounded-full bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition-colors"
                  >
                    開く
                  </button>
                  <button
                    onClick={() => onDeleteEvent(ev.id)}
                    aria-label={`「${eventTitle(ev)}」を削除`}
                    className="shrink-0 p-2 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              オフ会が終了したら削除してください（最大{MAX_SAVED_EVENTS}件まで保存できます）
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10 text-left">
          {FLOW.map((f, i) => (
            <div key={f.title} className="card-hover bg-white/85 rounded-2xl border border-sky-100 p-3.5">
              <div className="flex items-center gap-1.5 mb-1">
                <f.Icon size={16} className="text-sky-600" />
                <span className="text-[11px] text-sky-600/70 font-semibold">STEP {i + 1}</span>
              </div>
              <p className="text-sm font-bold text-slate-700">{f.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {hasProgress && (
            <button
              onClick={onResume}
              className="inline-flex items-center gap-2 px-8 py-3 rounded-full bg-sky-600 text-white font-bold hover:bg-sky-700 transition-colors shadow-lg shadow-sky-600/20"
            >
              続きから再開する
              <ArrowRightIcon size={18} className="text-amber-300" />
            </button>
          )}
          <button
            onClick={onStart}
            disabled={!canCreate}
            title={canCreate ? undefined : `保存できるオフ会は最大${MAX_SAVED_EVENTS}件です。終了したオフ会を削除してください`}
            className={`inline-flex items-center gap-2 px-8 py-3 rounded-full font-bold transition-colors ${
              hasProgress
                ? 'bg-white/85 border border-sky-200 text-slate-600 hover:bg-white'
                : 'bg-sky-600 text-white hover:bg-sky-700 shadow-lg shadow-sky-600/20'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            新しいオフ会を企画する
            <ArrowRightIcon size={18} className={hasProgress ? undefined : 'text-amber-300'} />
          </button>
          {hasProgress && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/85 border border-sky-200 text-slate-500 text-sm font-medium hover:bg-white transition-colors"
            >
              <RefreshIcon size={15} />
              すべて初期化
            </button>
          )}
        </div>

        <p className="mt-6 text-xs text-slate-400">
          入力した内容はこのブラウザの中にだけ保存されます（サーバーには送信されません）
        </p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <button
            onClick={onExport}
            className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600 transition-colors"
          >
            バックアップを保存
          </button>
          <label className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600 transition-colors cursor-pointer">
            バックアップを読み込む
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          ブラウザの変更・キャッシュ削除でデータは消えます。大事なオフ会はバックアップを保存しておいてください
        </p>
      </div>
    </div>
  );
}
