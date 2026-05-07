# @fipulse/fipulse-widgets

React chart widgets for Fipulse, built on top of [`lightweight-charts`](https://www.npmjs.com/package/lightweight-charts) and [`@fipulse/fipulse-sdk`](../fipulse-sdk).

Currently exports:

- `@fipulse/fipulse-widgets/react`: `FipulseChart`

## Install

```bash
npm install @fipulse/fipulse-widgets
```

Peer deps: `react` and `react-dom`.

## Usage (React)

```tsx
import { FipulseChart } from '@fipulse/fipulse-widgets/react'

export function TokenChart() {
  return (
    <div style={{ height: 420 }}>
      <FipulseChart
        chainId={1}
        token="0x0000000000000000000000000000000000000000"
        mode="simple" // 'simple' (range presets) | 'professional' (fixed intervals)
        volume={true}
        // Optional display metadata:
        symbol="ETH"
        name="Ethereum"
        // Optional: override Edge base URL (otherwise uses Vite env `VITE_EDGE_BASE_URL` or same-origin)
        // baseUrl="http://localhost:8787"
      />
    </div>
  )
}
```

## Data source / configuration

`FipulseChart` fetches candles from the Fipulse Edge API:

- **Default base URL**: `getEdgeBaseUrl()` (Vite env `VITE_EDGE_BASE_URL`, trimmed; empty means “same origin”, useful with a dev proxy)
- **Endpoints**: `GET /v1/ohlc` (professional mode) and `GET /v1/ohlc/auto` (simple mode)

## Build

```bash
npm run build
```

## License

MIT. See `LICENSE`.

