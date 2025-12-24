module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: './tsconfig.json',
		sourceType: 'module',
	},
	plugins: ['n8n-nodes-base'],
	extends: ['plugin:n8n-nodes-base/nodes'],
	ignorePatterns: ['dist/**', 'node_modules/**', '*.js'],
	rules: {
		'n8n-nodes-base/node-param-description-missing-final-period': 'warn',
	},
};
