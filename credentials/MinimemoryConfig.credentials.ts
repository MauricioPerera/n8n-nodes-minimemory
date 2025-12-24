import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class MinimemoryConfig implements ICredentialType {
	name = 'minimemoryConfig';
	displayName = 'Minimemory Configuration';
	documentationUrl = 'https://github.com/minimemory/minimemory';

	properties: INodeProperties[] = [
		{
			displayName: 'Default Data Directory',
			name: 'dataDirectory',
			type: 'string',
			default: './data/minimemory',
			description: 'Default directory for storing .mmdb database files',
		},
		{
			displayName: 'Default Dimensions',
			name: 'defaultDimensions',
			type: 'number',
			default: 384,
			description: 'Default number of dimensions for new databases (384 for all-MiniLM-L6-v2, 1536 for OpenAI)',
		},
		{
			displayName: 'Default Distance Metric',
			name: 'defaultDistance',
			type: 'options',
			options: [
				{ name: 'Cosine', value: 'cosine' },
				{ name: 'Euclidean', value: 'euclidean' },
				{ name: 'Dot Product', value: 'dot' },
			],
			default: 'cosine',
			description: 'Default distance metric for new databases',
		},
	];
}
