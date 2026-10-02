import React from 'react';
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { Card } from './ui/card';
import { ChartContainer } from './ui/chart';
import { Info } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';

const dimensionHelp = {
  responsibilities: 'Would the daily management work suit you? Looks for enjoyable, sustainable duties, clear boundaries and limited firefighting.',
  evidence: 'Can you already do this work well? Looks for demonstrated experience that matches the requirements, without a major professional reinvention.',
  scope: 'How much would you have to carry? Looks for manageable accountability, clear authority and adequate support. Bigger teams or titles do not automatically score higher.',
  direction: 'Does this support your move towards your own businesses? Values useful learning and room for outside projects, rather than promotion prospects.',
  practical: 'Does this fit your life? Considers pay, remote working, travel and employment arrangements that fit your life.',
};

// shadcn radial-chart composition with the dashboard's Card/ChartContainer pattern.
const config = { score: { label: 'Rating', color: 'var(--primary)' } };
function DimensionHelp({ label, children }) {
  const [open, setOpen] = React.useState(false);
  const pointerType = React.useRef('');
  const triggerRef = React.useRef(null);
  return <TooltipProvider><Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild
      onPointerDown={event => {
        pointerType.current = event.pointerType;
        // Radix otherwise closes on pointerdown and again on click. Touch opens
        // explicitly below, without a focus event reopening a second-tap close.
        if (event.pointerType === 'touch') event.preventDefault();
      }}
      onClick={event => {
        event.preventDefault();
        setOpen(previous => event.detail !== 0 && pointerType.current === 'touch' ? !previous : true);
      }}>
      <Button ref={triggerRef} type="button" variant="ghost" className="dimension-help-trigger" aria-label={`About ${label}`}>
        <Info aria-hidden="true" size={14} />
      </Button>
    </TooltipTrigger>
    <TooltipContent className="dimension-help-content" side="top" collisionPadding={12}
      onPointerDownOutside={event => {
        // The trigger is outside the portalled content. Let its click toggle
        // once, rather than dismissing first and reopening on the same tap.
        if (triggerRef.current?.contains(event.detail.originalEvent.target)) event.preventDefault();
      }}>{children}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
export function ScoreGauge({ dimension, label, value, weight }) {
  const legacyIds = { 'Responsibilities fit': 'responsibilities', 'Evidence of capability': 'evidence', 'Seniority and scope': 'scope', 'Career direction': 'direction', 'Practical compatibility': 'practical' };
  const help = dimensionHelp[dimension || legacyIds[label]];
  const parsed = value === '' || value == null ? NaN : Number(value);
  const score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
  return <Card className="score-gauge">
    <h3 className="dimension-heading"><span>{label}</span>{help ? <DimensionHelp label={label}>{help}</DimensionHelp> : null}</h3>
    <div className="gauge-visual" role={score === null ? 'img' : 'meter'} aria-label={label + (score === null ? ': not assessed' : '')}
      aria-valuemin={score === null ? undefined : 0} aria-valuemax={score === null ? undefined : 100}
      aria-valuenow={score ?? undefined} aria-valuetext={score === null ? undefined : `${score} out of 100`}>
      <div aria-hidden="true">
        <ChartContainer config={config} className="gauge-chart">
          <RadialBarChart data={[{ score: score ?? 0 }]} innerRadius="78%" outerRadius="100%" startAngle={90} endAngle={-270} accessibilityLayer={false}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="score" fill="var(--color-score)" background={{ fill: 'var(--muted)' }} cornerRadius={8} isAnimationActive={false} />
          </RadialBarChart>
        </ChartContainer>
        <span className="gauge-value">{score ?? '—'}<small>{score === null ? 'Not assessed' : '/ 100'}</small></span>
      </div>
    </div>
    <p>{weight}% of total score</p>
  </Card>;
}
