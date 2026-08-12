/** 「遊び心版」で使う文体プリセット。
 * ラベルだけをAIに渡すと生成のたびに解釈がぶれるため、directiveで特徴を言語化して添える。 */
export const PLAYFUL_STYLE_PRESETS = [
  {
    key: 'takarazuka',
    label: '宝塚風',
    directive:
      '宝塚歌劇のように華やかで優雅な舞台調。「皆様、ごきげんよう」のような気品のある呼びかけと、少し芝居がかった言い回しを使う',
  },
  {
    key: 'tsundere',
    label: 'ツンデレ系',
    directive:
      '素直じゃない照れ隠しの口調。「別にあなたのために開くわけじゃないけど」のように一度強がってから、最後は歓迎する気持ちがちゃんとにじむように書く',
  },
  {
    key: 'oraora',
    label: 'オラオラ系',
    directive: '勢いのある熱血な口調。短く言い切って、ぐいぐい押し出すテンションで書く',
  },
  {
    key: 'kansai',
    label: '関西弁',
    directive: '親しみやすい関西弁。距離が近く、目の前で話しかけているような軽さで書く',
  },
] as const;

export type PlayfulStyleKey = (typeof PLAYFUL_STYLE_PRESETS)[number]['key'];

function findPreset(presetKey: string) {
  return PLAYFUL_STYLE_PRESETS.find((p) => p.key === presetKey);
}

/** プリセットと自由入力から、AIに渡す文体指示を1つ組み立てる。
 * 両方ある場合は自由入力を主に据え、プリセットは補足として併記する（片方を取りこぼさないため）。 */
export function buildStyleDirective(presetKey: string, customText: string): string {
  const preset = findPreset(presetKey);
  const custom = customText.trim();
  if (!custom) return preset ? `${preset.label}：${preset.directive}` : '';
  if (!preset) return custom;
  return `${custom}（ベースは「${preset.label}」＝${preset.directive}。両者が食い違う場合は前者を優先）`;
}

/** タブやバッジに添える文体の呼び名。未指定なら空文字（呼び出し側で「遊び心版」とだけ出す）。
 *  自由入力はタブに収まるよう丸める */
export function playfulStyleLabel(presetKey: string, customText: string): string {
  const preset = findPreset(presetKey);
  if (preset) return preset.label;
  const custom = customText.trim();
  if (!custom) return '';
  return custom.length > 12 ? `${custom.slice(0, 12)}…` : custom;
}
