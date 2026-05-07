import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'react/index': 'src/react/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
})

