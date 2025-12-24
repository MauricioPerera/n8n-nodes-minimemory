/**
 * VectorDB - Complete JavaScript implementation of a vector database
 *
 * This is a pure TypeScript implementation that works without native bindings.
 * Provides similarity search using cosine, euclidean, or dot product distance.
 */

import { BM25Index, BM25Options, BM25SearchResult, SerializedBM25Index } from './BM25Index';
import {
	SearchMode,
	FusionMethod,
	HybridSearchResult,
	VectorSearchResult,
	hybridFusion,
} from './HybridSearch';

export type DistanceMetric = 'cosine' | 'euclidean' | 'dot';
export type IndexType = 'flat' | 'hnsw';

// Re-export types from hybrid search modules
export type { SearchMode, FusionMethod, HybridSearchResult, BM25SearchResult };

export interface VectorDBOptions {
	dimensions: number;
	distance?: DistanceMetric;
	indexType?: IndexType;
}

export interface SearchResult {
	id: string;
	distance: number;
	similarity: number;
	metadata?: Record<string, unknown>;
}

// ============================================================================
// Metadata Filtering Types
// ============================================================================

/**
 * Filter operators for metadata queries
 */
export type FilterOperator =
	| '$eq'      // Equal
	| '$ne'      // Not equal
	| '$gt'      // Greater than
	| '$gte'     // Greater than or equal
	| '$lt'      // Less than
	| '$lte'     // Less than or equal
	| '$in'      // In array
	| '$nin'     // Not in array
	| '$exists'  // Field exists
	| '$contains' // String contains (case-insensitive)
	| '$startsWith' // String starts with
	| '$endsWith';  // String ends with

/**
 * Single field filter condition
 */
export type FilterCondition =
	| { $eq: unknown }
	| { $ne: unknown }
	| { $gt: number | string | Date }
	| { $gte: number | string | Date }
	| { $lt: number | string | Date }
	| { $lte: number | string | Date }
	| { $in: unknown[] }
	| { $nin: unknown[] }
	| { $exists: boolean }
	| { $contains: string }
	| { $startsWith: string }
	| { $endsWith: string };

/**
 * Metadata filter - can be a simple value (implicit $eq) or a condition object
 */
export type MetadataFilterValue = unknown | FilterCondition;

/**
 * Complete metadata filter with optional logical operators
 */
export interface MetadataFilter {
	[field: string]: MetadataFilterValue | MetadataFilter[] | undefined;
	$and?: MetadataFilter[];
	$or?: MetadataFilter[];
}

/**
 * Search options including optional metadata filter
 */
export interface SearchOptions {
	k: number;
	filter?: MetadataFilter;
	minSimilarity?: number;
	includeVectors?: boolean;
}

/**
 * Hybrid search options
 */
export interface HybridSearchOptions {
	mode: SearchMode;
	k: number;

	// Vector search options
	queryVector?: number[];
	filter?: MetadataFilter;
	minSimilarity?: number;

	// Keyword search options
	keywords?: string;
	textFields?: string[];
	bm25K1?: number;
	bm25B?: number;

	// Hybrid fusion options
	alpha?: number;           // 0 = pure keyword, 1 = pure vector (default: 0.5)
	fusionMethod?: FusionMethod;
	rrfConstant?: number;     // RRF k constant (default: 60)
}

interface StoredVector {
	id: string;
	vector: number[];
	metadata: Record<string, unknown> | null;
	norm?: number; // Pre-computed norm for faster cosine
}

export interface SerializedDB {
	version: string;
	dimensions: number;
	distance: DistanceMetric;
	indexType: IndexType;
	vectors: StoredVector[];
	// BM25 index data (optional for backward compatibility)
	bm25Index?: SerializedBM25Index;
}

/**
 * Calculates cosine distance between two vectors.
 * Returns a value between 0 (identical) and 2 (opposite).
 */
function cosineDistance(a: number[], b: number[], normA?: number, normB?: number): number {
	let dot = 0;
	let nA = normA ?? 0;
	let nB = normB ?? 0;

	const needNormA = normA === undefined;
	const needNormB = normB === undefined;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		if (needNormA) nA += a[i] * a[i];
		if (needNormB) nB += b[i] * b[i];
	}

	if (needNormA) nA = Math.sqrt(nA);
	if (needNormB) nB = Math.sqrt(nB);

	const denom = nA * nB;
	if (denom === 0) return 1;

	// Clamp to avoid floating point errors
	const similarity = Math.max(-1, Math.min(1, dot / denom));
	return 1 - similarity;
}

/**
 * Calculates euclidean (L2) distance between two vectors.
 */
function euclideanDistance(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const diff = a[i] - b[i];
		sum += diff * diff;
	}
	return Math.sqrt(sum);
}

/**
 * Calculates dot product distance (negative so lower = more similar).
 */
function dotProductDistance(a: number[], b: number[]): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
	}
	return -dot; // Negative so lower = more similar
}

// ============================================================================
// Metadata Filter Evaluation
// ============================================================================

/**
 * Gets a nested value from an object using dot notation
 * Example: getNestedValue({ a: { b: 1 } }, 'a.b') => 1
 */
function getNestedValue(obj: Record<string, unknown> | null, path: string): unknown {
	if (!obj) return undefined;

	const parts = path.split('.');
	let current: unknown = obj;

	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}

/**
 * Compares two values for ordering operations
 */
function compareValues(a: unknown, b: unknown): number {
	// Handle dates
	if (a instanceof Date && b instanceof Date) {
		return a.getTime() - b.getTime();
	}

	// Handle date strings
	if (typeof a === 'string' && typeof b === 'string') {
		const dateA = Date.parse(a);
		const dateB = Date.parse(b);
		if (!isNaN(dateA) && !isNaN(dateB)) {
			return dateA - dateB;
		}
		return a.localeCompare(b);
	}

	// Handle numbers
	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}

	// Fallback to string comparison
	return String(a).localeCompare(String(b));
}

/**
 * Checks if a condition object is a filter condition (has operator keys)
 */
function isFilterCondition(value: unknown): value is FilterCondition {
	if (!value || typeof value !== 'object') return false;
	const keys = Object.keys(value);
	return keys.length > 0 && keys.every(k => k.startsWith('$'));
}

/**
 * Evaluates a single filter condition against a field value
 */
function evaluateCondition(fieldValue: unknown, condition: FilterCondition): boolean {
	const entries = Object.entries(condition);

	for (const [operator, operand] of entries) {
		switch (operator) {
			case '$eq':
				if (fieldValue !== operand) return false;
				break;

			case '$ne':
				if (fieldValue === operand) return false;
				break;

			case '$gt':
				if (fieldValue === undefined || compareValues(fieldValue, operand) <= 0) return false;
				break;

			case '$gte':
				if (fieldValue === undefined || compareValues(fieldValue, operand) < 0) return false;
				break;

			case '$lt':
				if (fieldValue === undefined || compareValues(fieldValue, operand) >= 0) return false;
				break;

			case '$lte':
				if (fieldValue === undefined || compareValues(fieldValue, operand) > 0) return false;
				break;

			case '$in':
				if (!Array.isArray(operand) || !operand.includes(fieldValue)) return false;
				break;

			case '$nin':
				if (!Array.isArray(operand) || operand.includes(fieldValue)) return false;
				break;

			case '$exists':
				if (operand === true && fieldValue === undefined) return false;
				if (operand === false && fieldValue !== undefined) return false;
				break;

			case '$contains':
				if (typeof fieldValue !== 'string' || typeof operand !== 'string') return false;
				if (!fieldValue.toLowerCase().includes(operand.toLowerCase())) return false;
				break;

			case '$startsWith':
				if (typeof fieldValue !== 'string' || typeof operand !== 'string') return false;
				if (!fieldValue.toLowerCase().startsWith(operand.toLowerCase())) return false;
				break;

			case '$endsWith':
				if (typeof fieldValue !== 'string' || typeof operand !== 'string') return false;
				if (!fieldValue.toLowerCase().endsWith(operand.toLowerCase())) return false;
				break;

			default:
				// Unknown operator, ignore
				break;
		}
	}

	return true;
}

/**
 * Evaluates a complete metadata filter against a metadata object
 */
function evaluateFilter(
	metadata: Record<string, unknown> | null,
	filter: MetadataFilter
): boolean {
	// Handle $and operator
	if (filter.$and) {
		for (const subFilter of filter.$and) {
			if (!evaluateFilter(metadata, subFilter)) {
				return false;
			}
		}
	}

	// Handle $or operator
	if (filter.$or) {
		let anyMatch = false;
		for (const subFilter of filter.$or) {
			if (evaluateFilter(metadata, subFilter)) {
				anyMatch = true;
				break;
			}
		}
		if (!anyMatch && filter.$or.length > 0) {
			return false;
		}
	}

	// Handle field conditions
	for (const [field, condition] of Object.entries(filter)) {
		// Skip logical operators
		if (field === '$and' || field === '$or') continue;

		const fieldValue = getNestedValue(metadata, field);

		if (isFilterCondition(condition)) {
			// It's a condition object like { $gt: 5 }
			if (!evaluateCondition(fieldValue, condition)) {
				return false;
			}
		} else {
			// It's a simple value, treat as $eq
			if (fieldValue !== condition) {
				return false;
			}
		}
	}

	return true;
}

/**
 * In-memory vector database
 */
export class VectorDB {
	private vectors: Map<string, StoredVector> = new Map();
	private readonly _dimensions: number;
	private readonly _distance: DistanceMetric;
	private readonly _indexType: IndexType;

	// BM25 index for keyword search (lazy-initialized)
	private bm25Index: BM25Index | null = null;
	private bm25TextFields: string[] = [];

	constructor(options: VectorDBOptions) {
		this._dimensions = options.dimensions;
		this._distance = options.distance || 'cosine';
		this._indexType = options.indexType || 'flat';
	}

	/**
	 * Configured number of dimensions
	 */
	get dimensions(): number {
		return this._dimensions;
	}

	/**
	 * Configured distance metric
	 */
	get distance(): DistanceMetric {
		return this._distance;
	}

	/**
	 * Configured index type
	 */
	get indexType(): IndexType {
		return this._indexType;
	}

	/**
	 * Number of stored vectors
	 */
	get length(): number {
		return this.vectors.size;
	}

	/**
	 * Computes the norm of a vector (for cosine optimization)
	 */
	private computeNorm(vector: number[]): number {
		let sum = 0;
		for (let i = 0; i < vector.length; i++) {
			sum += vector[i] * vector[i];
		}
		return Math.sqrt(sum);
	}

	/**
	 * Calculates the distance between two vectors using the configured metric
	 */
	private calculateDistance(a: number[], b: number[], normA?: number, normB?: number): number {
		switch (this._distance) {
			case 'cosine':
				return cosineDistance(a, b, normA, normB);
			case 'euclidean':
				return euclideanDistance(a, b);
			case 'dot':
				return dotProductDistance(a, b);
			default:
				return cosineDistance(a, b, normA, normB);
		}
	}

	/**
	 * Inserts a vector with unique ID and optional metadata
	 */
	insert(id: string, vector: number[], metadata?: Record<string, unknown>): void {
		if (vector.length !== this._dimensions) {
			throw new Error(
				`Dimension mismatch: expected ${this._dimensions}, got ${vector.length}`
			);
		}

		if (this.vectors.has(id)) {
			throw new Error(`Vector with id "${id}" already exists. Use update() instead.`);
		}

		const norm = this._distance === 'cosine' ? this.computeNorm(vector) : undefined;

		this.vectors.set(id, {
			id,
			vector: [...vector], // Copy to avoid external mutations
			metadata: metadata || null,
			norm,
		});

		// Update BM25 index if configured
		if (this.bm25Index) {
			this.bm25Index.addDocument(id, metadata || null);
		}
	}

	/**
	 * Updates an existing vector or inserts a new one
	 */
	upsert(id: string, vector: number[], metadata?: Record<string, unknown>): void {
		if (vector.length !== this._dimensions) {
			throw new Error(
				`Dimension mismatch: expected ${this._dimensions}, got ${vector.length}`
			);
		}

		const norm = this._distance === 'cosine' ? this.computeNorm(vector) : undefined;

		this.vectors.set(id, {
			id,
			vector: [...vector],
			metadata: metadata || null,
			norm,
		});

		// Update BM25 index if configured
		if (this.bm25Index) {
			this.bm25Index.updateDocument(id, metadata || null);
		}
	}

	/**
	 * Searches for the k nearest neighbors to the query vector
	 * @param query - The query vector
	 * @param k - Number of results to return
	 * @param options - Optional search options including filter
	 */
	search(query: number[], k: number, options?: Partial<SearchOptions>): SearchResult[] {
		if (query.length !== this._dimensions) {
			throw new Error(
				`Query dimension mismatch: expected ${this._dimensions}, got ${query.length}`
			);
		}

		if (this.vectors.size === 0) {
			return [];
		}

		const filter = options?.filter;
		const minSimilarity = options?.minSimilarity ?? 0;
		const queryNorm = this._distance === 'cosine' ? this.computeNorm(query) : undefined;

		// Calculate distances to all vectors
		const results: SearchResult[] = [];

		for (const stored of this.vectors.values()) {
			// Apply metadata filter if provided
			if (filter && !evaluateFilter(stored.metadata, filter)) {
				continue;
			}

			const distance = this.calculateDistance(query, stored.vector, queryNorm, stored.norm);

			// Calculate similarity (1 - distance for cosine, inverse for others)
			let similarity: number;
			if (this._distance === 'cosine') {
				similarity = 1 - distance;
			} else if (this._distance === 'dot') {
				similarity = -distance; // Reverse the negation
			} else {
				similarity = 1 / (1 + distance); // Normalize euclidean
			}

			// Apply minimum similarity filter
			if (similarity < minSimilarity) {
				continue;
			}

			results.push({
				id: stored.id,
				distance,
				similarity,
				metadata: stored.metadata || undefined,
			});
		}

		// Sort by distance (lower = more similar)
		results.sort((a, b) => a.distance - b.distance);

		// Return the k nearest neighbors
		return results.slice(0, Math.min(k, results.length));
	}

	/**
	 * Searches with a filter object for more complex queries
	 * @param query - The query vector
	 * @param options - Search options including k, filter, minSimilarity
	 */
	searchWithOptions(query: number[], options: SearchOptions): SearchResult[] {
		return this.search(query, options.k, options);
	}

	/**
	 * Gets a vector by its ID
	 */
	get(id: string): { vector: number[]; metadata: Record<string, unknown> | null } | null {
		const stored = this.vectors.get(id);
		if (!stored) {
			return null;
		}
		return {
			vector: [...stored.vector],
			metadata: stored.metadata,
		};
	}

	/**
	 * Deletes a vector by its ID
	 */
	delete(id: string): boolean {
		const deleted = this.vectors.delete(id);

		// Update BM25 index if configured
		if (deleted && this.bm25Index) {
			this.bm25Index.removeDocument(id);
		}

		return deleted;
	}

	/**
	 * Checks if a vector with the given ID exists
	 */
	contains(id: string): boolean {
		return this.vectors.has(id);
	}

	/**
	 * Removes all vectors
	 */
	clear(): void {
		this.vectors.clear();

		// Clear BM25 index if configured
		if (this.bm25Index) {
			this.bm25Index.clear();
		}
	}

	/**
	 * Gets all vector IDs
	 */
	getIds(): string[] {
		return Array.from(this.vectors.keys());
	}

	// ============================================================================
	// BM25 Keyword Search Methods
	// ============================================================================

	/**
	 * Configures the BM25 index for keyword search
	 */
	configureBM25(options: {
		textFields: string[];
		k1?: number;
		b?: number;
	}): void {
		// If already configured with same fields, just update parameters
		if (
			this.bm25Index &&
			JSON.stringify(this.bm25TextFields) === JSON.stringify(options.textFields)
		) {
			return;
		}

		// Create new BM25 index
		this.bm25Index = new BM25Index({
			textFields: options.textFields,
			k1: options.k1,
			b: options.b,
		});
		this.bm25TextFields = [...options.textFields];

		// Index all existing documents
		for (const stored of this.vectors.values()) {
			this.bm25Index.addDocument(stored.id, stored.metadata);
		}
	}

	/**
	 * Ensures BM25 index is configured (lazy initialization)
	 */
	private ensureBM25Index(textFields: string[], k1?: number, b?: number): void {
		if (!this.bm25Index || JSON.stringify(this.bm25TextFields) !== JSON.stringify(textFields)) {
			this.configureBM25({ textFields, k1, b });
		}
	}

	/**
	 * Checks if BM25 index is configured
	 */
	hasBM25Index(): boolean {
		return this.bm25Index !== null;
	}

	/**
	 * Gets BM25 index statistics
	 */
	getBM25Stats(): Record<string, unknown> | null {
		if (!this.bm25Index) return null;
		return this.bm25Index.getStats();
	}

	/**
	 * Performs keyword-only search using BM25
	 */
	keywordSearch(
		query: string,
		k: number,
		options?: {
			textFields?: string[];
			filter?: MetadataFilter;
			k1?: number;
			b?: number;
		},
	): BM25SearchResult[] {
		const textFields = options?.textFields || this.bm25TextFields;

		if (textFields.length === 0) {
			throw new Error(
				'No text fields specified for keyword search. ' +
				'Provide textFields option or call configureBM25() first.',
			);
		}

		// Ensure BM25 index is ready
		this.ensureBM25Index(textFields, options?.k1, options?.b);

		// Perform search
		let results = this.bm25Index!.search(query, k * 2); // Fetch more for filtering

		// Apply metadata filter if provided
		if (options?.filter) {
			results = results.filter(r => {
				const stored = this.vectors.get(r.id);
				return stored && evaluateFilter(stored.metadata, options.filter!);
			});
		}

		// Return top k
		return results.slice(0, k);
	}

	/**
	 * Performs hybrid search combining vector and keyword search
	 */
	hybridSearch(options: HybridSearchOptions): HybridSearchResult[] {
		const {
			mode,
			k,
			queryVector,
			keywords,
			textFields = this.bm25TextFields.length > 0 ? this.bm25TextFields : ['content', 'text', 'title'],
			filter,
			minSimilarity,
			alpha = 0.5,
			fusionMethod = 'rrf',
			rrfConstant = 60,
			bm25K1,
			bm25B,
		} = options;

		// Vector-only search
		if (mode === 'vector') {
			if (!queryVector) {
				throw new Error('queryVector is required for vector search mode');
			}
			return this.search(queryVector, k, { filter, minSimilarity }).map(r => ({
				id: r.id,
				score: r.similarity,
				vectorSimilarity: r.similarity,
				metadata: r.metadata,
			}));
		}

		// Keyword-only search
		if (mode === 'keyword') {
			if (!keywords) {
				throw new Error('keywords is required for keyword search mode');
			}
			return this.keywordSearch(keywords, k, { textFields, filter, k1: bm25K1, b: bm25B }).map(r => ({
				id: r.id,
				score: r.score,
				keywordScore: r.score,
				metadata: r.metadata,
			}));
		}

		// Hybrid search
		if (!queryVector) {
			throw new Error('queryVector is required for hybrid search mode');
		}
		if (!keywords) {
			throw new Error('keywords is required for hybrid search mode');
		}

		// Perform both searches (fetch more to allow for filtering and fusion)
		const fetchK = Math.max(k * 3, 50);

		const vectorResults = this.search(queryVector, fetchK, { filter, minSimilarity });
		const keywordResults = this.keywordSearch(keywords, fetchK, { textFields, filter, k1: bm25K1, b: bm25B });

		// Convert to fusion format
		const vectorForFusion: VectorSearchResult[] = vectorResults.map(r => ({
			id: r.id,
			distance: r.distance,
			similarity: r.similarity,
			metadata: r.metadata,
		}));

		// Perform fusion
		return hybridFusion(
			vectorForFusion,
			keywordResults,
			k,
			fusionMethod,
			{ alpha, rrfConstant },
		);
	}

	/**
	 * Exports the database as a serialized object (for JSON output)
	 */
	export(): SerializedDB {
		const data: SerializedDB = {
			version: '2.0.0', // Bump version for BM25 support
			dimensions: this._dimensions,
			distance: this._distance,
			indexType: this._indexType,
			vectors: Array.from(this.vectors.values()),
		};

		// Include BM25 index if configured
		if (this.bm25Index) {
			data.bm25Index = this.bm25Index.serialize();
		}

		return data;
	}

	/**
	 * Imports a database from a serialized object
	 */
	static import(data: SerializedDB): VectorDB {
		const db = new VectorDB({
			dimensions: data.dimensions,
			distance: data.distance,
			indexType: data.indexType,
		});

		// Load vectors
		for (const stored of data.vectors) {
			db.vectors.set(stored.id, {
				id: stored.id,
				vector: stored.vector,
				metadata: stored.metadata,
				norm: stored.norm,
			});
		}

		// Load BM25 index if present (v2 format)
		if (data.bm25Index) {
			db.bm25Index = BM25Index.deserialize(data.bm25Index);
			db.bm25TextFields = data.bm25Index.textFields;
		}

		return db;
	}

	/**
	 * Exports database statistics
	 */
	stats(): Record<string, unknown> {
		const stats: Record<string, unknown> = {
			dimensions: this._dimensions,
			distance: this._distance,
			indexType: this._indexType,
			vectorCount: this.vectors.size,
			memoryEstimateMB: (this.vectors.size * this._dimensions * 4) / (1024 * 1024),
		};

		// Add BM25 stats if configured
		if (this.bm25Index) {
			stats.bm25 = this.bm25Index.getStats();
		}

		return stats;
	}
}

// Global cache of database instances
const dbCache = new Map<string, VectorDB>();

/**
 * Gets a database from cache or throws an error if not found
 */
export function getDB(name: string): VectorDB {
	const db = dbCache.get(name);
	if (!db) {
		throw new Error(
			`Database "${name}" not found. Create it first with the "Create Database" operation.`
		);
	}
	return db;
}

/**
 * Creates a new database and adds it to the cache
 */
export function createDB(name: string, options: VectorDBOptions): VectorDB {
	if (dbCache.has(name)) {
		throw new Error(`Database "${name}" already exists.`);
	}
	const db = new VectorDB(options);
	dbCache.set(name, db);
	return db;
}

/**
 * Gets an existing database or creates it if options are provided
 */
export function getOrCreateDB(name: string, options?: VectorDBOptions): VectorDB {
	if (dbCache.has(name)) {
		return dbCache.get(name)!;
	}
	if (!options) {
		throw new Error(
			`Database "${name}" not found. Create it first or provide options.`
		);
	}
	return createDB(name, options);
}

/**
 * Imports a database from serialized data and adds it to the cache
 */
export function importDB(name: string, data: SerializedDB): VectorDB {
	const db = VectorDB.import(data);
	dbCache.set(name, db);
	return db;
}

/**
 * Lists all databases in the cache
 */
export function listDBs(): string[] {
	return Array.from(dbCache.keys());
}

/**
 * Deletes a database from the cache
 */
export function deleteDB(name: string): boolean {
	return dbCache.delete(name);
}

/**
 * Clears the entire database cache
 */
export function clearCache(): void {
	dbCache.clear();
}
