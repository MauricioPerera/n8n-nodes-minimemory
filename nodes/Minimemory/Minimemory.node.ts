import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	NodeOperationError,
} from 'n8n-workflow';

import {
	createDB,
	getDB,
	loadDB,
	listDBs,
	deleteDB,
	type DistanceMetric,
	type IndexType,
} from './VectorDB';

export class Minimemory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Minimemory',
		name: 'minimemory',
		icon: 'file:minimemory.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Embedded vector database for similarity search - no server required',
		defaults: {
			name: 'Minimemory',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			// Operation selector
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Clear Database',
						value: 'clear',
						description: 'Remove all vectors from the database',
						action: 'Clear database',
					},
					{
						name: 'Create Database',
						value: 'create',
						description: 'Create a new vector database in memory',
						action: 'Create a new vector database',
					},
					{
						name: 'Create or Update',
						value: 'upsert',
						description: 'Create a new record, or update the current one if it already exists (upsert)',
						action: 'Upsert a vector',
					},
					{
						name: 'Delete Database',
						value: 'deleteDb',
						description: 'Remove database from memory',
						action: 'Delete database',
					},
					{
						name: 'Delete Vector',
						value: 'delete',
						description: 'Delete a vector by its ID',
						action: 'Delete a vector',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a vector by its ID',
						action: 'Get a vector by ID',
					},
					{
						name: 'Get Info',
						value: 'info',
						description: 'Get database information and statistics',
						action: 'Get database info',
					},
					{
						name: 'Insert Many',
						value: 'insertMany',
						description: 'Insert multiple vectors from input data',
						action: 'Insert multiple vectors',
					},
					{
						name: 'Insert Vector',
						value: 'insert',
						description: 'Insert a vector with ID and optional metadata',
						action: 'Insert a vector',
					},
					{
						name: 'List Databases',
						value: 'list',
						description: 'List all databases in memory',
						action: 'List all databases',
					},
					{
						name: 'Load From File',
						value: 'load',
						description: 'Load database from a JSON file',
						action: 'Load database from file',
					},
					{
						name: 'Save to File',
						value: 'save',
						description: 'Save database to a JSON file',
						action: 'Save database to file',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search for k nearest neighbors',
						action: 'Search for similar vectors',
					},
				],
				default: 'search',
			},

			// Database Name (used by most operations)
			{
				displayName: 'Database Name',
				name: 'databaseName',
				type: 'string',
				default: 'default',
				required: true,
				description: 'Name to identify this database instance in memory',
				displayOptions: {
					hide: {
						operation: ['list'],
					},
				},
			},

			// === CREATE operation fields ===
			{
				displayName: 'Dimensions',
				name: 'dimensions',
				type: 'number',
				default: 384,
				required: true,
				description: 'Number of dimensions for vectors. Common: 384 (MiniLM), 768 (MPNet), 1536 (OpenAI).',
				displayOptions: {
					show: {
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Distance Metric',
				name: 'distance',
				type: 'options',
				options: [
					{
						name: 'Cosine (Best for Text)',
						value: 'cosine',
						description: 'Cosine similarity - ideal for text embeddings',
					},
					{
						name: 'Euclidean (L2)',
						value: 'euclidean',
						description: 'Euclidean distance - good for normalized vectors',
					},
					{
						name: 'Dot Product',
						value: 'dot',
						description: 'Dot product - when magnitude matters',
					},
				],
				default: 'cosine',
				description: 'Distance metric for similarity calculation',
				displayOptions: {
					show: {
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Index Type',
				name: 'indexType',
				type: 'options',
				options: [
					{
						name: 'Flat (Exact Search)',
						value: 'flat',
						description: '100% accurate, best for < 10,000 vectors',
					},
					{
						name: 'HNSW (Fast Approximate)',
						value: 'hnsw',
						description: 'Very fast, slight accuracy trade-off for large datasets',
					},
				],
				default: 'flat',
				description: 'Index type - affects speed vs accuracy',
				displayOptions: {
					show: {
						operation: ['create'],
					},
				},
			},

			// === INSERT/GET/DELETE operation fields ===
			{
				displayName: 'Vector ID',
				name: 'vectorId',
				type: 'string',
				default: '',
				required: true,
				description: 'Unique identifier for the vector',
				displayOptions: {
					show: {
						operation: ['insert', 'upsert', 'get', 'delete'],
					},
				},
			},
			{
				displayName: 'Vector',
				name: 'vector',
				type: 'json',
				default: '[]',
				required: true,
				description: 'Vector as JSON array of numbers, e.g., [0.1, 0.2, 0.3, ...]. Can also use expression to get from previous node.',
				displayOptions: {
					show: {
						operation: ['insert', 'upsert'],
					},
				},
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description: 'Optional metadata as JSON object, e.g., {"title": "Document 1", "category": "tech"}',
				displayOptions: {
					show: {
						operation: ['insert', 'upsert'],
					},
				},
			},

			// === INSERT MANY operation fields ===
			{
				displayName: 'ID Field',
				name: 'idField',
				type: 'string',
				default: 'id',
				required: true,
				description: 'Field name containing the vector ID in input items',
				displayOptions: {
					show: {
						operation: ['insertMany'],
					},
				},
			},
			{
				displayName: 'Vector Field',
				name: 'vectorField',
				type: 'string',
				default: 'embedding',
				required: true,
				description: 'Field name containing the vector array in input items',
				displayOptions: {
					show: {
						operation: ['insertMany'],
					},
				},
			},
			{
				displayName: 'Metadata Fields',
				name: 'metadataFields',
				type: 'string',
				default: '',
				description: 'Comma-separated field names to include as metadata (leave empty for all other fields)',
				displayOptions: {
					show: {
						operation: ['insertMany'],
					},
				},
			},

			// === SEARCH operation fields ===
			{
				displayName: 'Query Vector',
				name: 'queryVector',
				type: 'json',
				default: '[]',
				required: true,
				description: 'Query vector as JSON array. Use expression like {{ $JSON.embedding }} to get from previous node.',
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Number of Results (K)',
				name: 'topK',
				type: 'number',
				default: 10,
				description: 'Number of nearest neighbors to return',
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Include Vectors',
				name: 'includeVectors',
				type: 'boolean',
				default: false,
				description: 'Whether to include the actual vectors in the results (increases output size)',
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Minimum Similarity',
				name: 'minSimilarity',
				type: 'number',
				default: 0,
				description: 'Filter results below this similarity threshold (0-1 for cosine)',
				displayOptions: {
					show: {
						operation: ['search'],
					},
				},
			},

			// === SAVE/LOAD operation fields ===
			{
				displayName: 'File Path',
				name: 'filePath',
				type: 'string',
				default: '',
				required: true,
				description: 'Full path to the database file (JSON format)',
				placeholder: '/data/vectors/my_database.json',
				displayOptions: {
					show: {
						operation: ['save', 'load'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Handle insertMany specially - it processes all items at once
		const operation = this.getNodeParameter('operation', 0) as string;

		if (operation === 'insertMany') {
			return executeInsertMany(this, items);
		}

		if (operation === 'list') {
			const databases = listDBs();
			returnData.push({
				json: {
					success: true,
					databases,
					count: databases.length,
				},
			});
			return [returnData];
		}

		// Process each item for other operations
		for (let i = 0; i < items.length; i++) {
			try {
				const databaseName = this.getNodeParameter('databaseName', i) as string;
				let result: IDataObject = {};

				switch (operation) {
					case 'create': {
						const dimensions = this.getNodeParameter('dimensions', i) as number;
						const distance = this.getNodeParameter('distance', i) as DistanceMetric;
						const indexType = this.getNodeParameter('indexType', i) as IndexType;

						try {
							const db = createDB(databaseName, { dimensions, distance, indexType });
							result = {
								success: true,
								message: `Database "${databaseName}" created successfully`,
								name: databaseName,
								dimensions,
								distance,
								indexType,
								vectorCount: 0,
							};
						} catch (error) {
							result = {
								success: false,
								message: error instanceof Error ? error.message : String(error),
								name: databaseName,
							};
						}
						break;
					}

					case 'insert':
					case 'upsert': {
						const db = getDB(databaseName);
						const vectorId = this.getNodeParameter('vectorId', i) as string;
						const vectorJson = this.getNodeParameter('vector', i);
						const metadataJson = this.getNodeParameter('metadata', i);

						const vector = typeof vectorJson === 'string' ? JSON.parse(vectorJson) : vectorJson;
						const metadata = typeof metadataJson === 'string'
							? JSON.parse(metadataJson)
							: metadataJson;

						const hasMetadata = metadata && Object.keys(metadata).length > 0;

						if (operation === 'upsert') {
							db.upsert(vectorId, vector, hasMetadata ? metadata : undefined);
						} else {
							db.insert(vectorId, vector, hasMetadata ? metadata : undefined);
						}

						result = {
							success: true,
							operation,
							id: vectorId,
							dimensions: vector.length,
							hasMetadata,
							totalVectors: db.length,
						};
						break;
					}

					case 'search': {
						const db = getDB(databaseName);
						const queryJson = this.getNodeParameter('queryVector', i);
						const topK = this.getNodeParameter('topK', i) as number;
						const includeVectors = this.getNodeParameter('includeVectors', i) as boolean;
						const minSimilarity = this.getNodeParameter('minSimilarity', i) as number;

						const queryVector = typeof queryJson === 'string'
							? JSON.parse(queryJson)
							: queryJson;

						let results = db.search(queryVector, topK);

						// Filter by minimum similarity if specified
						if (minSimilarity > 0) {
							results = results.filter(r => r.similarity >= minSimilarity);
						}

						// Optionally include vectors
						const formattedResults = results.map(r => {
							const item: IDataObject = {
								id: r.id,
								distance: r.distance,
								similarity: r.similarity,
							};
							if (r.metadata) {
								item.metadata = r.metadata as IDataObject;
							}
							if (includeVectors) {
								const stored = db.get(r.id);
								if (stored) {
									item.vector = stored.vector;
								}
							}
							return item;
						});

						result = {
							success: true,
							query: 'vector',
							k: topK,
							resultsCount: formattedResults.length,
							results: formattedResults,
						};
						break;
					}

					case 'get': {
						const db = getDB(databaseName);
						const vectorId = this.getNodeParameter('vectorId', i) as string;

						const data = db.get(vectorId);
						if (data) {
							result = {
								success: true,
								found: true,
								id: vectorId,
								vector: data.vector,
								metadata: data.metadata,
								dimensions: data.vector.length,
							};
						} else {
							result = {
								success: true,
								found: false,
								id: vectorId,
								message: 'Vector not found',
							};
						}
						break;
					}

					case 'delete': {
						const db = getDB(databaseName);
						const vectorId = this.getNodeParameter('vectorId', i) as string;

						const deleted = db.delete(vectorId);
						result = {
							success: true,
							deleted,
							id: vectorId,
							message: deleted ? 'Vector deleted' : 'Vector not found',
							totalVectors: db.length,
						};
						break;
					}

					case 'save': {
						const db = getDB(databaseName);
						const filePath = this.getNodeParameter('filePath', i) as string;

						db.save(filePath);
						result = {
							success: true,
							message: `Database saved to ${filePath}`,
							path: filePath,
							totalVectors: db.length,
							dimensions: db.dimensions,
						};
						break;
					}

					case 'load': {
						const filePath = this.getNodeParameter('filePath', i) as string;

						const db = loadDB(databaseName, filePath);
						result = {
							success: true,
							message: `Database loaded from ${filePath}`,
							name: databaseName,
							path: filePath,
							totalVectors: db.length,
							dimensions: db.dimensions,
							distance: db.distance,
						};
						break;
					}

					case 'info': {
						try {
							const db = getDB(databaseName);
							const stats = db.stats();
							result = {
								success: true,
								name: databaseName,
								...stats,
								allDatabases: listDBs(),
							};
						} catch {
							result = {
								success: false,
								name: databaseName,
								message: `Database "${databaseName}" not found`,
								allDatabases: listDBs(),
							};
						}
						break;
					}

					case 'clear': {
						const db = getDB(databaseName);
						const previousCount = db.length;
						db.clear();
						result = {
							success: true,
							message: `Cleared ${previousCount} vectors`,
							previousCount,
							totalVectors: 0,
						};
						break;
					}

					case 'deleteDb': {
						const deleted = deleteDB(databaseName);
						result = {
							success: deleted,
							name: databaseName,
							message: deleted
								? `Database "${databaseName}" deleted from memory`
								: `Database "${databaseName}" not found`,
							remainingDatabases: listDBs(),
						};
						break;
					}

					default:
						throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
				}

				returnData.push({
					json: result,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							error: error instanceof Error ? error.message : String(error),
						},
						pairedItem: { item: i },
					});
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}

}

/**
 * Handles insertMany operation - processes all input items at once
 */
async function executeInsertMany(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
	const databaseName = context.getNodeParameter('databaseName', 0) as string;
	const idField = context.getNodeParameter('idField', 0) as string;
	const vectorField = context.getNodeParameter('vectorField', 0) as string;
	const metadataFieldsStr = context.getNodeParameter('metadataFields', 0) as string;

	const metadataFields = metadataFieldsStr
		? metadataFieldsStr.split(',').map(f => f.trim()).filter(f => f)
		: null;

	try {
		const db = getDB(databaseName);
		let insertedCount = 0;
		const errors: string[] = [];

		for (let i = 0; i < items.length; i++) {
			const item = items[i].json;

			try {
				const id = item[idField] as string;
				const vector = item[vectorField] as number[];

				if (!id) {
					errors.push(`Item ${i}: Missing ID field "${idField}"`);
					continue;
				}

				if (!vector || !Array.isArray(vector)) {
					errors.push(`Item ${i}: Missing or invalid vector field "${vectorField}"`);
					continue;
				}

				// Extract metadata
				let metadata: Record<string, unknown> | undefined;
				if (metadataFields) {
					// Use specified fields
					metadata = {};
					for (const field of metadataFields) {
						if (field in item) {
							metadata[field] = item[field];
						}
					}
				} else {
					// Use all fields except id and vector
					metadata = {};
					for (const [key, value] of Object.entries(item)) {
						if (key !== idField && key !== vectorField) {
							metadata[key] = value;
						}
					}
				}

				const hasMetadata = metadata && Object.keys(metadata).length > 0;
				db.upsert(id, vector, hasMetadata ? metadata : undefined);
				insertedCount++;
			} catch (error) {
				errors.push(`Item ${i}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		return [[{
			json: {
				success: true,
				operation: 'insertMany',
				database: databaseName,
				processed: items.length,
				inserted: insertedCount,
				errors: errors.length,
				errorDetails: errors.length > 0 ? errors : undefined,
				totalVectors: db.length,
			},
		}]];
	} catch (error) {
		if (context.continueOnFail()) {
			return [[{
				json: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			}]];
		}
		throw error;
	}
}
