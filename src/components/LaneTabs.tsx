import React from 'react';
import { StyleLane } from '../types';

interface LaneTabsProps {
  lane: StyleLane;
  onChange: (lane: StyleLane) => void;
  /** 遊び心版の文体名（未指定なら空文字） */
  styleName?: string;
  /** 遊び心版に切り替えられるか。falseなら理由をhintに出す */
  playfulEnabled?: boolean;
  hint?: string;
}

/** 「標準版 / 遊び心版」の切り替え。詳細（公開情報）と告知文で共通の1本のレーンを操作する。
 *  どちらのステップで切り替えても連動するので、公開物の文体が食い違わない。 */
export default function LaneTabs({
  lane,
  onChange,
  styleName = '',
  playfulEnabled = true,
  hint = '',
}: LaneTabsProps) {
  const base = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:cursor-not-allowed';
  return (
    <div className="mb-4">
      <div className="inline-flex p-1 bg-slate-100 rounded-full" role="tablist" aria-label="文体の版">
        <button
          type="button"
          role="tab"
          aria-selected={lane === 'standard'}
          onClick={() => onChange('standard')}
          className={`${base} ${
            lane === 'standard' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          標準版
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={lane === 'playful'}
          disabled={!playfulEnabled}
          onClick={() => onChange('playful')}
          className={`${base} ${
            lane === 'playful'
              ? 'bg-white text-rose-600 shadow-sm'
              : playfulEnabled
                ? 'text-slate-500 hover:text-slate-700'
                : 'text-slate-300'
          }`}
        >
          遊び心版{styleName ? `（${styleName}）` : ''}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
