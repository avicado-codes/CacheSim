// One chart panel: an ECharts canvas plus the table view every chart must have. Charts never
// share an axis between units; callers build one chart per unit. Colours follow the theme.

import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChartOption, TableData } from '../lib/chartStyle';
import { useApp } from '../store/useApp';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export { axisStyle, baseOption, type ChartOption, type TableData } from '../lib/chartStyle';

interface Props {
  title: string;
  subtitle?: string;
  option: ChartOption;
  table: TableData;
  height?: number;
}

export function Chart({ title, subtitle, option, table, height = 260 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  const theme = useApp((s) => s.theme);
  const id = useId();

  useEffect(() => {
    if (mode !== 'chart' || !ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    const before = () => chart.resize();
    window.addEventListener('beforeprint', before);
    return () => {
      ro.disconnect();
      window.removeEventListener('beforeprint', before);
      chart.dispose();
    };
  }, [option, mode, theme]);

  return (
    <section className="panel chart" aria-labelledby={`${id}-t`}>
      <header className="panel-head">
        <div>
          <h3 id={`${id}-t`} className="panel-title">{title}</h3>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        <div className="segmented no-print" role="group" aria-label={`${title}: view`}>
          <button type="button" aria-pressed={mode === 'chart'} onClick={() => setMode('chart')}>Chart</button>
          <button type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')}>Table</button>
        </div>
      </header>
      {mode === 'chart' ? (
        <div ref={ref} className="chart-canvas" style={{ height }} role="img" aria-label={`${title} chart; switch to Table for the values`} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j} className="num">{v}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
