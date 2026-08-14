import React from 'react';
import { AppStep } from '../types';
import { EntakuProgress } from './Entaku';

interface StepDef {
  step: AppStep;
  label: string;
}

// ラベルは「何をする画面か」を話し言葉で書く。
// 「基本情報」「詳細情報」のような書類的な名前は、初めて主催する人に堅苦しい印象を与えるため使わない。
const STEPS: StepDef[] = [
  { step: AppStep.PROFILE, label: 'あなたのこと' },
  { step: AppStep.IDEAS, label: 'どんな会にする？' },
  { step: AppStep.BASICS, label: 'いつ・どこで？' },
  { step: AppStep.SCHEDULE, label: '当日の流れ' },
  { step: AppStep.ANNOUNCEMENT, label: 'みんなへの案内' },
  { step: AppStep.IMAGE_PROMPTS, label: 'アイコンと画像' },
  { step: AppStep.CHAT_SETUP, label: 'チャットを立てる' },
  { step: AppStep.SHARE, label: 'みんなに知らせる' },
];

const STEP_LABELS = STEPS.map((s) => s.label);

interface StepIndicatorProps {
  current: AppStep;
  /** 到達済みの最大ステップ（これ以前はクリックで戻れる） */
  maxReached: AppStep;
  onNavigate: (step: AppStep) => void;
}

export function stepOrder(step: AppStep): number {
  const idx = STEPS.findIndex((s) => s.step === step);
  return idx === -1 ? -1 : idx;
}

export default function StepIndicator({ current, maxReached, onNavigate }: StepIndicatorProps) {
  const currentIdx = stepOrder(current);
  const maxIdx = stepOrder(maxReached);

  if (currentIdx === -1) return null; // HUBでは表示しない

  return (
    <div className="flex items-center gap-3 py-2">
      {/* 円卓プログレス: 席をクリックで到達済みステップへ移動 */}
      <EntakuProgress
        currentIdx={currentIdx}
        maxIdx={maxIdx}
        size={46}
        labels={STEP_LABELS}
        onSeatClick={(i) => onNavigate(STEPS[i].step)}
      />
      <div className="shrink-0">
        <p className="text-sm font-bold text-slate-800 leading-tight">{STEPS[currentIdx].label}</p>
        <p className="text-[11px] text-slate-400 tabular-nums">{currentIdx + 1} / 8</p>
      </div>

      {/* ステップ名ナビ（到達済みはクリック可） */}
      <nav aria-label="ステップ" className="ml-auto overflow-x-auto scrollbar-thin">
        <ol className="flex items-center gap-3 min-w-max px-1">
          {STEPS.map((s, idx) => {
            const isCurrent = idx === currentIdx;
            const isReachable = idx <= maxIdx && !isCurrent;
            return (
              <li key={s.step}>
                <button
                  onClick={() => isReachable && onNavigate(s.step)}
                  disabled={!isReachable}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`text-xs whitespace-nowrap transition-colors ${
                    isCurrent
                      ? 'font-bold text-slate-800'
                      : isReachable
                        ? 'text-sky-700 hover:underline cursor-pointer'
                        : 'text-slate-300 cursor-default'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
