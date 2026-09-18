import React from 'react';
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { Card } from './ui/card';
import { ChartContainer } from './ui/chart';

// shadcn radial-chart composition with the dashboard's Card/ChartContainer pattern.
const config = { score: { label: 'Rating', color: 'var(--primary)' } };
export function ScoreGauge({ label, value, weight }) {
  const parsed = value === '' || value == null ? NaN : Number(value);
  const score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
  return <Card className="score-gauge">
    <h3>{label}</h3>
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
