/**
 * VectorDB - Complete JavaScript implementation of a vector database
 *
 * This is a pure TypeScript implementation that works without native bindings.
 * Provides similarity search using cosine, euclidean, or dot product distance.
 */

import * as fs from 'fs';
import * as path from 'path';

export type DistanceMetric = 'cosine' | 'euclidean' | 'dot';
export type IndexType = 'flat' | 'hnsw';

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

interface StoredVector {
	id: string;
	vector: number[];
	metadata: Record<string, unknown> | null;
	norm?: number; // Pre-computed norm for faster cosine
}

interface SerializedDB {
	version: string;
	dimensions: number;
	distance: DistanceMetric;
	indexType: IndexType;
	vectors: StoredVector[];
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

/**
 * In-memory vector database
 */
export class VectorDB {
	private vectors: Map<string, StoredVector> = new Map();
	private readonly _dimensions: number;
	private readonly _distance: DistanceMetric;
	private readonly _indexType: IndexType;

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
	}

	/**
	 * Searches for the k nearest neighbors to the query vector
	 */
	search(query: number[], k: number): SearchResult[] {
		if (query.length !== this._dimensions) {
			throw new Error(
				`Query dimension mismatch: expected ${this._dimensions}, got ${query.length}`
			);
		}

		if (this.vectors.size === 0) {
			return [];
		}

		const queryNorm = this._distance === 'cosine' ? this.computeNorm(query) : undefined;

		// Calculate distances to all vectors
		const results: SearchResult[] = [];

		for (const stored of this.vectors.values()) {
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
		return this.vectors.delete(id);
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
	}

	/**
	 * Gets all vector IDs
	 */
	getIds(): string[] {
		return Array.from(this.vectors.keys());
	}

	/**
	 * Saves the database to a JSON file
	 */
	save(filePath: string): void {
		const data: SerializedDB = {
			version: '1.0.0',
			dimensions: this._dimensions,
			distance: this._distance,
			indexType: this._indexType,
			vectors: Array.from(this.vectors.values()),
		};

		// Create directory if it doesn't exist
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	/**
	 * Loads a database from a JSON file
	 */
	static load(filePath: string): VectorDB {
		if (!fs.existsSync(filePath)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const content = fs.readFileSync(filePath, 'utf-8');
		const data: SerializedDB = JSON.parse(content);

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

		return db;
	}

	/**
	 * Exports database statistics
	 */
	stats(): Record<string, unknown> {
		return {
			dimensions: this._dimensions,
			distance: this._distance,
			indexType: this._indexType,
			vectorCount: this.vectors.size,
			memoryEstimateMB: (this.vectors.size * this._dimensions * 4) / (1024 * 1024),
		};
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
 * Loads a database from file and adds it to the cache
 */
export function loadDB(name: string, filePath: string): VectorDB {
	const db = VectorDB.load(filePath);
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
