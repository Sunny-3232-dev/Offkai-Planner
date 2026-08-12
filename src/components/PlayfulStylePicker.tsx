import React from 'react';
import { PLAYFUL_STYLE_PRESETS, playfulStyleLabel } from '../textStyles';

interface PlayfulStylePickerProps {
  preset: string;
  custom: string;
  onChangePreset: (preset: string) => void;
  onChangeCustom: (custom: string) => void;
  /** 入力欄のid（同じ画面に複数置いた場合の衝突回避用） */
  inputId?: string;
  /** すでにある遊び心版が作られたときの文体名。いまの選択と違うときだけ補足を出す */
  madeWithLabel?: string;
}

/** 遊び心版の文体を選ぶピル＋自由入力。詳細ステップと告知ステップの両方で使う。
 *  文体はオフ会ごとに1つなので、どちらで選んでも同じ値を書き換える。 */
export default function PlayfulStylePicker({
  preset,
  custom,
  onChangePreset,
  onChangeCustom,
  inputId = 'playfulStyleCustom',
  madeWithLabel = '',
}: PlayfulStylePickerProps) {
  const selectedLabel = playfulStyleLabel(preset, custom);
  const differs = !!madeWithLabel && madeWithLabel !== selectedLabel;
  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-2.5" aria-label="文体のプリセット">
        {PLAYFUL_STYLE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={preset === p.key}
            onClick={() => onChangePreset(preset === p.key ? '' : p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              preset === p.key
                ? 'bg-rose-500 text-white border-rose-500'
                : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:text-rose-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        id={inputId}
        type="text"
        value={custom}
        onChange={(e) => onChangeCustom(e.target.value)}
        placeholder="自由に書いてもOK（例: 執事風で／落語家みたいに）"
        aria-label="文体の自由入力"
        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-300 bg-white mb-2"
      />
      {differs && (
        <p className="text-[11px] text-rose-700/80 mb-2">
          いま表示しているのは「{madeWithLabel}」で作った版です。作り直すと「{selectedLabel}」に変わります
        </p>
      )}
    </>
  );
}
