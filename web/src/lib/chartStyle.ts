// Shared chart chrome for ECharts options, kept apart from the Chart component so pages that only
// need numbers (Home's KPIs) don't pull ECharts into the main bundle. Text wears ink tokens, never
// series colours; axes and grid stay recessive.

import type { EChartsCoreOption } from 'echarts/core';
import { ink } from './palette';

export type ChartOption = EChartsCoreOption;

export interface TableData {
  columns: string[];
  rows: string[][];
}

export const CHART_FONT = '"Public Sans Variable", system-ui, sans-serif';

export function baseOption(): ChartOption {
  const k = ink();
  return {
    backgroundColor: 'transparent',
    textStyle: { color: k.secondary, fontFamily: CHART_FONT },
    grid: { left: 64, right: 24, top: 40, bottom: 48 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: k.tooltip,
      borderColor: k.axis,
      textStyle: { color: k.primary, fontFamily: CHART_FONT },
      extraCssText: 'box-shadow: 0 6px 18px rgba(0,0,0,.18); border-radius: 6px;',
    },
    legend: { top: 0, textStyle: { color: k.secondary, fontFamily: CHART_FONT }, itemWidth: 12, itemHeight: 12, icon: 'roundRect' },
  };
}

export function axisStyle() {
  const k = ink();
  return {
    axisLine: { lineStyle: { color: k.axis } },
    axisTick: { show: false },
    axisLabel: { color: k.muted, fontFamily: CHART_FONT },
    splitLine: { lineStyle: { color: k.grid } },
    nameTextStyle: { color: k.muted, fontFamily: CHART_FONT },
  };
}
