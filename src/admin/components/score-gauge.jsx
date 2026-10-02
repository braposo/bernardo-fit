import React from 'react';
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { Card } from './ui/card';
import { ChartContainer } from './ui/chart';
import { Info } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';

const dimensionHelp = {
  responsibilities: 'Would the daily management work suit you? Looks for enjoyable, sustainable duties, clear boundaries and limited firefighting.',
  evidence: 'Can you already do this work well? Looks for demonstrated experience that matches the requirements, without a major professional reinvention.',
  scope: 'How much would you have to carry? Looks for manageable accountability, clear authority and adequate support. Bigger teams or titles do not automatically score higher.',
  direction: 'Does this support your move towards your own businesses? Values useful learning and room for outside projects, rather than promotion prospects.',
  practical: 'Does this fit your life? Considers pay, remote working, travel and employment arrangements that fit your life.',
};

// shadcn radial-chart composition with the dashboard's Card/ChartContainer pattern.
const config = { score: { label: 'Rating', color: 'var(--primary)' } };
export function ScoreGauge({ dimension, label, value, weight }) {
  const legacyIds = { 'Responsibilities fit': 'responsibilities', 'Evidence of capability': 'evidence', 'Seniority and scope': 'scope', 'Career direction': 'direction', 'Practical compatibility': 'practical' };
  const help = dimensionHelp[dimension || legacyIds[label]];
  const parsed = value === '' || value == null ? NaN : Number(value);
  const score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
  return <Card className="score-gauge">
    <h3>{help ? <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" className="dimension-help-trigger" aria-label={`About ${label}`}>
          <span>{label}</span><Info aria-hidden="true" size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="dimension-help-content" side="top" collisionPadding={12}
        aria-label={`About ${label}`} onOpenAutoFocus={event => event.preventDefault()}>
        {help}
      </PopoverContent>
    </Popover> : label}</h3>
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
