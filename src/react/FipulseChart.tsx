import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineType,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  createFipulseClient,
  type GetOhlcParams,
  type OhlcAutoRange,
  type OhlcCandle,
  type OhlcInterval,
} from '@fipulse/fipulse-sdk'
import { getEdgeBaseUrl } from '../lib/edge'
import { formatCryptoAxisPrice, mergeCandles } from '../lib/kline-chart-format'

export type FipulseChartMode = 'professional' | 'simple'

export type FipulseChartProps = {
  chainId: number
  token: `0x${string}`
  mode: FipulseChartMode
  volume: boolean
  symbol?: string | null
  name?: string | null
  interval?: OhlcInterval
  range?: OhlcAutoRange
  /** Override the Edge base URL; defaults to `getEdgeBaseUrl()` (or same-origin when empty). */
  baseUrl?: string
}

const PROFESSIONAL_INTERVALS: OhlcInterval[] = ['1m', '5m', '30m', '3h', '1d']
const SIMPLE_RANGES: OhlcAutoRange[] = ['1d', '1w', '1m', '1y', 'all']

const simpleRangeOptions: ReadonlyArray<{ range: OhlcAutoRange; label: string }> = [
  { range: '1d', label: '1D' },
  { range: '1w', label: '1W' },
  { range: '1m', label: '1M' },
  { range: '1y', label: '1Y' },
  { range: 'all', label: 'All' },
]

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  const abs = Math.abs(value)
  if (abs < 0.01) return '$<0.01'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: abs >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: abs >= 10_000 ? 2 : 2,
  }).format(value)
}

function simpleRangeShortLabel(range: OhlcAutoRange): string {
  switch (range) {
    case '1d':
      return '1D'
    case '1w':
      return '1W'
    case '1m':
      return '1M'
    case '1y':
      return '1Y'
    case 'all':
      return 'All'
  }
}

function clampSymbol(raw?: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  return v.slice(0, 64)
}

function clampName(raw?: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  return v.slice(0, 240)
}

function normalizeRange(raw: OhlcAutoRange | undefined): OhlcAutoRange {
  return raw && SIMPLE_RANGES.includes(raw) ? raw : '1d'
}

function normalizeInterval(raw: OhlcInterval | undefined): OhlcInterval {
  return raw && PROFESSIONAL_INTERVALS.includes(raw) ? raw : '1m'
}

export function FipulseChart(props: FipulseChartProps) {
  const baseUrl = props.baseUrl ?? getEdgeBaseUrl()
  const symbol = useMemo(() => clampSymbol(props.symbol), [props.symbol])
  const name = useMemo(() => clampName(props.name), [props.name])

  const [interval, setInterval] = useState<OhlcInterval>(() => normalizeInterval(props.interval))
  const [range, setRange] = useState<OhlcAutoRange>(() => normalizeRange(props.range))

  useEffect(() => {
    setInterval(normalizeInterval(props.interval))
  }, [props.interval])
  useEffect(() => {
    setRange(normalizeRange(props.range))
  }, [props.range])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candles, setCandles] = useState<OhlcCandle[]>([])
  const candlesRef = useRef<OhlcCandle[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [simpleAutoResolution, setSimpleAutoResolution] = useState<{
    range: OhlcAutoRange
    interval: OhlcInterval
  } | null>(null)

  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

  const chartHostRef = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const areaSeries = useRef<ISeriesApi<'Area'> | null>(null)
  const volSeries = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lastNextEndTs = useRef<number | null>(null)
  const loadingRef = useRef(false)
  const visibleHandlerRef = useRef<(() => void) | null>(null)

  const tokenDisplayShort = useMemo(() => {
    const t = props.token
    return t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-6)}` : t
  }, [props.token])

  const chartSymbolLabel = useMemo(() => (symbol ? symbol.toUpperCase() : tokenDisplayShort), [symbol, tokenDisplayShort])
  const chartNameSubtitle = useMemo(() => name || null, [name])

  const lastCloseDisplay = useMemo(() => {
    if (!candles.length) return '—'
    const sorted = [...candles].sort((a, b) => a.bucketStartTs - b.bucketStartTs)
    const c = sorted[sorted.length - 1]
    return formatCryptoAxisPrice(Number(c.close))
  }, [candles])

  const transferValueDisplay = useMemo(() => {
    if (!candles.length) return '—'
    let sum = 0
    for (const c of candles) {
      const v = Number(c.volUsd)
      if (Number.isFinite(v)) sum += v
    }
    return formatUsdCompact(sum)
  }, [candles])

  const rangeChangePct = useMemo((): number | null => {
    if (candles.length < 2) return null
    const sorted = [...candles].sort((a, b) => a.bucketStartTs - b.bucketStartTs)
    const firstOpen = Number(sorted[0].open)
    const lastClose = Number(sorted[sorted.length - 1].close)
    if (!Number.isFinite(firstOpen) || firstOpen === 0 || !Number.isFinite(lastClose)) return null
    return ((lastClose - firstOpen) / firstOpen) * 100
  }, [candles])

  const chartResolutionLabel = useMemo(() => {
    if (props.mode === 'professional') return interval
    const m = simpleAutoResolution
    return m ? `${m.interval} · ${simpleRangeShortLabel(m.range)}` : simpleRangeShortLabel(range)
  }, [props.mode, interval, range, simpleAutoResolution])

  const applyPaneStretches = useCallback(() => {
    if (!chart.current) return
    const panes = chart.current.panes()
    if (panes[0] && panes[1]) {
      panes[0].setStretchFactor(props.volume ? 0.9 : 1)
      panes[1].setStretchFactor(props.volume ? 0.1 : 0)
    }
  }, [props.volume])

  const applyChartData = useCallback(
    (rows: OhlcCandle[], opts?: { fit?: boolean }) => {
      if (!candleSeries.current || !areaSeries.current || !volSeries.current) return
      const fit = opts?.fit !== false
      const sorted = [...rows].sort((a, b) => a.bucketStartTs - b.bucketStartTs)
      const candlePoints = sorted.map((c) => ({
        time: c.bucketStartTs as UTCTimestamp,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }))
      const linePoints = sorted.map((c) => ({
        time: c.bucketStartTs as UTCTimestamp,
        value: Number(c.close),
      }))
      const vols = sorted.map((c) => {
        const up = Number(c.close) >= Number(c.open)
        return {
          time: c.bucketStartTs as UTCTimestamp,
          value: Number(c.volUsd),
          color: up ? '#00d4aa80' : '#ff6b6b80',
        }
      })

      if (props.mode === 'professional') {
        candleSeries.current.setData(candlePoints)
        areaSeries.current.setData([])
      } else {
        candleSeries.current.setData([])
        areaSeries.current.setData(linePoints)
      }
      volSeries.current.setData(props.volume ? vols : [])
      applyPaneStretches()
      if (fit) chart.current?.timeScale().fitContent()
    },
    [props.mode, props.volume, applyPaneStretches],
  )

  const fetchPage = useCallback(
    async (append: boolean) => {
      if (!append) {
        setHasMore(false)
        setCandles([])
        lastNextEndTs.current = null
      }
      setLoading(true)
      loadingRef.current = true
      setError(null)
      try {
        const client = createFipulseClient({ baseUrl })

        if (props.mode === 'simple') {
          if (!append) {
            const e = range === 'all' ? null : Math.floor(Date.now() / 1000)
            const res = await client.getOhlcAuto({
              chainId: props.chainId,
              token: props.token,
              range,
              ...(e != null && Number.isFinite(e) ? { endTs: e } : {}),
            })
            setSimpleAutoResolution({ range: res.range, interval: res.interval })
            lastNextEndTs.current = res.nextEndTs
            setCandles(res.candles)
            setHasMore(res.hasMore)
            applyChartData(res.candles, { fit: true })
            return
          }

          const curCandles = candlesRef.current
          const oldest = curCandles.length ? Math.min(...curCandles.map((c) => c.bucketStartTs)) : null
          const endTsForOlder =
            lastNextEndTs.current != null ? lastNextEndTs.current : oldest != null ? oldest - 1 : null
          if (endTsForOlder == null || !Number.isFinite(endTsForOlder)) {
            setHasMore(false)
            return
          }
          const res = await client.getOhlcAuto({
            chainId: props.chainId,
            token: props.token,
            range,
            endTs: endTsForOlder,
          })
          setSimpleAutoResolution({ range: res.range, interval: res.interval })
          lastNextEndTs.current = res.nextEndTs
          const merged = mergeCandles(curCandles, res.candles)
          setCandles(merged)
          setHasMore(res.hasMore)
          applyChartData(merged, { fit: false })
          return
        }

        if (!append) setSimpleAutoResolution(null)
        const curCandles = candlesRef.current
        const req: GetOhlcParams = {
          chainId: props.chainId,
          token: props.token,
          interval,
        }
        if (append) {
          const oldestC = curCandles.length ? Math.min(...curCandles.map((c) => c.bucketStartTs)) : null
          req.endTs =
            lastNextEndTs.current != null ? lastNextEndTs.current : oldestC != null ? oldestC - 1 : undefined
        }

        const res = await client.getOhlc(req)
        lastNextEndTs.current = res.nextEndTs ?? null
        const merged = append ? mergeCandles(curCandles, res.candles) : res.candles
        setCandles(merged)
        setHasMore(res.hasMore)
        applyChartData(merged, { fit: !append })
      } catch (e: unknown) {
        setError(String((e as Error)?.message ?? e))
      } finally {
        setLoading(false)
        loadingRef.current = false
      }
    },
    [applyChartData, baseUrl, interval, props.chainId, props.mode, props.token, range],
  )

  const onVisibleLogicalRangeChanged = useEffectEvent(() => {
    if (!chart.current || loadingRef.current || !hasMore) return
    const lr = chart.current.timeScale().getVisibleLogicalRange()
    if (!lr) return
    if (lr.from > 25) return
    void fetchPage(true)
  })

  useLayoutEffect(() => {
    const el = chartHostRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const w = Math.max(1, width || 800)
    const h = Math.max(1, height || 400)

    const c = createChart(el, {
      width: w,
      height: h,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#171717',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#ececf0' },
        horzLines: { color: '#ececf0' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#a1a1aa', width: 1 },
        horzLine: { color: '#a1a1aa', width: 1 },
      },
      rightPriceScale: {
        borderColor: 'rgba(0, 0, 0, 0.1)',
        scaleMargins: { top: 0.3, bottom: 0.2 },
      },
      timeScale: {
        borderColor: 'rgba(0, 0, 0, 0.1)',
        timeVisible: true,
      },
    })
    chart.current = c
    const cs = c.addSeries(
      CandlestickSeries,
      {
        upColor: '#00d4aa',
        downColor: '#ff6b6b',
        borderVisible: false,
        wickUpColor: '#00d4aa',
        wickDownColor: '#ff6b6b',
        priceFormat: { type: 'custom', minMove: 1e-15, formatter: formatCryptoAxisPrice },
      },
      0,
    )
    candleSeries.current = cs
    const ar = c.addSeries(
      AreaSeries,
      {
        lineType: LineType.Curved,
        lineColor: '#00d4aa',
        topColor: 'rgba(0, 212, 170, 0.35)',
        bottomColor: 'rgba(0, 212, 170, 0.02)',
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat: { type: 'custom', minMove: 1e-15, formatter: formatCryptoAxisPrice },
      },
      0,
    )
    areaSeries.current = ar
    const vs = c.addSeries(
      HistogramSeries,
      { color: '#00d4aa80', priceFormat: { type: 'volume' } },
      1,
    )
    volSeries.current = vs
    const panes = c.panes()
    if (panes[0] && panes[1]) {
      panes[0].setStretchFactor(0.9)
      panes[1].setStretchFactor(0.1)
    }
    cs.priceScale().applyOptions({ mode: PriceScaleMode.Normal })
    ar.priceScale().applyOptions({ mode: PriceScaleMode.Normal })
    const visHandler = () => onVisibleLogicalRangeChanged()
    visibleHandlerRef.current = visHandler
    c.timeScale().subscribeVisibleLogicalRangeChange(visHandler)
    const ro = new ResizeObserver(() => {
      const host = chartHostRef.current
      if (!chart.current || !host) return
      const r = host.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        chart.current.applyOptions({ width: r.width, height: r.height })
      }
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      if (visibleHandlerRef.current) {
        c.timeScale().unsubscribeVisibleLogicalRangeChange(visibleHandlerRef.current)
        visibleHandlerRef.current = null
      }
      c.remove()
      chart.current = null
      candleSeries.current = null
      areaSeries.current = null
      volSeries.current = null
    }
  }, [props.token])

  useEffect(() => {
    void fetchPage(false)
  }, [fetchPage, props.chainId, props.token, props.mode, interval, range])

  useEffect(() => {
    applyChartData(candlesRef.current, { fit: false })
  }, [applyChartData, props.volume])

  const onIntervalChange = (v: OhlcInterval) => setInterval(normalizeInterval(v))
  const onSelectSimplePreset = (which: OhlcAutoRange) => setRange(normalizeRange(which))

  return (
    <div className="embed-root h-full min-h-0 w-full bg-background text-foreground flex flex-col">
      <div className="embed-token-meta flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-base sm:text-lg font-bold tracking-tight text-foreground truncate">
            {chartSymbolLabel}
          </div>
          {chartNameSubtitle ? (
            <div className="text-sm text-muted-foreground truncate mt-0.5">{chartNameSubtitle}</div>
          ) : null}
          <div className="mt-1 text-xs text-muted-foreground font-mono tabular-nums truncate">
            {tokenDisplayShort} · chain {props.chainId}
          </div>
        </div>
        <div className="flex min-w-0 max-w-full shrink-0 flex-col items-end gap-2 pt-2 sm:max-w-[min(100%,28rem)] sm:pt-0 sm:pl-2">
          <div className="w-full min-w-0 text-right">
            <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="text-4xl font-semibold tabular-nums text-foreground">{lastCloseDisplay}</span>
              <span className="inline-flex items-baseline gap-1 tabular-nums">
                <span className="text-foreground font-semibold">{transferValueDisplay}</span>
                <span className="text-muted-foreground font-normal">(transfer)</span>
              </span>
              {rangeChangePct != null ? (
                <span
                  className={
                    'inline-flex items-center gap-0.5 tabular-nums ' +
                    (rangeChangePct >= 0 ? 'text-chart-4' : 'text-destructive')
                  }
                >
                  <span className="material-symbols-outlined text-base">
                    {rangeChangePct >= 0 ? 'trending_up' : 'trending_down'}
                  </span>
                  {rangeChangePct >= 0 ? '' : '−'}
                  {(rangeChangePct < 0 ? -rangeChangePct : rangeChangePct).toFixed(2)}%
                  <span className="text-muted-foreground font-normal">(range)</span>
                </span>
              ) : null}
              <span className="text-muted-foreground">· {chartResolutionLabel}</span>
            </div>
          </div>
          <div className="h-2" />
          <div className="flex w-full max-w-[min(100%,28rem)] flex-wrap items-center justify-end gap-2">
            {props.mode === 'professional'
              ? PROFESSIONAL_INTERVALS.map((iv) => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => onIntervalChange(iv)}
                    className={
                      'px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors border ' +
                      (interval === iv
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/60 text-muted-foreground border-border hover:bg-muted')
                    }
                  >
                    {iv}
                  </button>
                ))
              : simpleRangeOptions.map((opt) => (
                  <button
                    key={opt.range}
                    type="button"
                    onClick={() => onSelectSimplePreset(opt.range)}
                    className={
                      'px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors border ' +
                      (range === opt.range
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/60 text-muted-foreground border-border hover:bg-muted')
                    }
                  >
                    {opt.label}
                  </button>
                ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="px-4 sm:px-5 py-3 text-sm text-destructive border-b border-border shrink-0">
          {error}
        </div>
      ) : null}

      <div className="embed-chart-wrap flex-1 min-h-0 flex flex-col relative min-h-[280px]">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : null}
        <div ref={chartHostRef} className="embed-chart-host flex-1 w-full min-h-0" />
      </div>
    </div>
  )
}

