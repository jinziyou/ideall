/**
 * NER 命名实体 label → 中文 的全站统一口径。
 *
 * 同时服务 home 订阅流 (subscription-feed) 与 (discover)/info 模块 (实体页 / 关系图谱),
 * 故放在 `src/components/lib/` 供跨模块复用, 避免各处各写一份导致文案漂移。
 */

/** 命名实体 label → 中文。覆盖 super/form NER 产出的全部类别。 */
export const NER_LABEL_TEXT: Record<string, string> = {
  PER: "人物",
  LOC: "地区",
  ORG: "组织",
  TIME: "时间",
  PRODUCT: "产品",
  EVENT: "事件",
}

/** label → 中文; 未知 label 原样返回 (label 为空时回退「实体」)。 */
export function entityLabelText(label: string | undefined): string {
  if (!label) return "实体"
  return NER_LABEL_TEXT[label] ?? label
}
