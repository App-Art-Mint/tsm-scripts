import { fileURLToPath, URL } from 'url';
import { extname, relative } from 'path';
import { glob } from 'glob';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
	plugins: [
		dts({ tsconfigPath: './tsconfig.node.json' })
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url))
		},
	},
	build: {
		lib: {
			entry: 'src',
			formats: ['es', 'cjs'],
			name: 'tsm-mint',
			fileName: (format) => `index.${format}.js`
		},
		rollupOptions: {
			input: Object.fromEntries(
				glob.sync('src/**/*.{ts,tsx}').map(file => [
					relative(
						'src',
						file.slice(0, file.length - extname(file).length)
					),
					fileURLToPath(new URL(file, import.meta.url))
				])
			),
			output: {
				exports: 'named',
				inlineDynamicImports: false,
				entryFileNames: '[name].[format].js'
			},
		},
	},
});
