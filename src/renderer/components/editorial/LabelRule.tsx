export interface LabelRuleProps {
  label: string;
  align?: 'center' | 'left';
}

/**
 * Flanking-rule section label. The `.label-rule` CSS class lives in
 * globals.css; `align="left"` suppresses the leading rule.
 */
export function LabelRule({ label, align = 'center' }: LabelRuleProps): JSX.Element {
  return (
    <div className={`label-rule ${align}`}>
      <span className="rule" aria-hidden="true" />
      <span className="lbl">{label}</span>
      <span className="rule" aria-hidden="true" />
    </div>
  );
}
