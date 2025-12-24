# n8n-nodes-minimemory

An n8n community node for embedded vector database operations - **100% serverless**.

Perform vector similarity search directly within n8n without any external server. Perfect for:
- RAG (Retrieval Augmented Generation)
- Semantic search
- Recommendations
- Deduplication

## Features

- **No server required** - Everything runs locally within n8n
- **Similarity search** - Find the k most similar vectors
- **Hybrid search** - Combine vector + keyword (BM25) search
- **Multiple metrics** - Cosine, Euclidean, Dot Product
- **Metadata support** - Associate additional information with each vector
- **Metadata filtering** - MongoDB-style query operators
- **Persistence** - Save/load from JSON files
- **Bulk insert** - Insert multiple vectors from previous nodes

## Installation

### From n8n UI (Recommended)

1. Go to **Settings** > **Community Nodes**
2. Search for `n8n-nodes-minimemory`
3. Click **Install**

### From npm

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-minimemory
```

Then restart n8n.

## Operations

### Create Database
Create a new vector database in memory.

| Parameter | Description | Example |
|-----------|-------------|---------|
| Database Name | Unique name for the DB | `my_vectors` |
| Dimensions | Number of dimensions | `384` (MiniLM), `1536` (OpenAI) |
| Distance Metric | Similarity metric | `cosine`, `euclidean`, `dot` |
| Index Type | Index type | `flat` (exact), `hnsw` (fast) |

### Insert Vector
Insert a single vector with ID and optional metadata.

| Parameter | Description |
|-----------|-------------|
| Vector ID | Unique identifier |
| Vector | Array of numbers `[0.1, 0.2, ...]` |
| Metadata | JSON object `{"title": "Doc 1"}` |

### Insert Many
Bulk insert vectors from input items.

| Parameter | Description | Default |
|-----------|-------------|---------|
| ID Field | Field containing the ID | `id` |
| Vector Field | Field containing the vector | `embedding` |
| Metadata Fields | Fields for metadata (empty = all) | |

**Example input:**
```json
[
  {"id": "doc1", "embedding": [0.1, 0.2, ...], "title": "Document 1"},
  {"id": "doc2", "embedding": [0.3, 0.4, ...], "title": "Document 2"}
]
```

### Search
Search for the k nearest neighbors using vector, keyword, or hybrid search.

| Parameter | Description | Default |
|-----------|-------------|---------|
| Search Mode | `vector`, `keyword`, or `hybrid` | `vector` |
| Query Vector | Vector for similarity search | (required for vector/hybrid) |
| Keywords | Text for BM25 keyword search | (required for keyword/hybrid) |
| Text Fields | Metadata fields to search | `content,text,title,description` |
| Number of Results (K) | Number of results | `10` |
| Include Vectors | Include vectors in result | `false` |
| Minimum Similarity | Filter by minimum similarity | `0` |
| Use Metadata Filter | Enable metadata filtering | `false` |
| Metadata Filter | JSON filter (see below) | `{}` |
| Hybrid Alpha | Vector(1) vs Keyword(0) balance | `0.5` |
| Fusion Method | `rrf` or `weighted` | `rrf` |
| BM25 K1 | Term saturation parameter | `1.2` |
| BM25 B | Length normalization | `0.75` |

**Output:**
```json
{
  "success": true,
  "searchMode": "hybrid",
  "filterApplied": true,
  "results": [
    {"id": "doc1", "score": 0.032, "vectorSimilarity": 0.9, "keywordScore": 12.4, "metadata": {...}},
    {"id": "doc2", "score": 0.028, "vectorSimilarity": 0.8, "keywordScore": 8.2, "metadata": {...}}
  ]
}
```

## Metadata Filtering (New in v0.2.0)

Filter search results by metadata fields using MongoDB-style operators.

### Basic Filters

```json
// Exact match
{"category": "tech"}

// Multiple conditions (implicit AND)
{"category": "tech", "author": "John"}
```

### Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal (implicit) | `{"status": "active"}` |
| `$ne` | Not equal | `{"status": {"$ne": "deleted"}}` |
| `$gt` | Greater than | `{"score": {"$gt": 0.5}}` |
| `$gte` | Greater or equal | `{"price": {"$gte": 100}}` |
| `$lt` | Less than | `{"age": {"$lt": 30}}` |
| `$lte` | Less or equal | `{"count": {"$lte": 10}}` |

### Array Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$in` | In array | `{"category": {"$in": ["tech", "science"]}}` |
| `$nin` | Not in array | `{"type": {"$nin": ["spam", "ad"]}}` |

### String Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$contains` | Contains (case-insensitive) | `{"title": {"$contains": "AI"}}` |
| `$startsWith` | Starts with | `{"name": {"$startsWith": "Dr."}}` |
| `$endsWith` | Ends with | `{"file": {"$endsWith": ".pdf"}}` |

### Other Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$exists` | Field exists | `{"email": {"$exists": true}}` |

### Logical Operators

```json
// AND - all conditions must match
{
  "$and": [
    {"category": "tech"},
    {"score": {"$gt": 0.8}}
  ]
}

// OR - any condition matches
{
  "$or": [
    {"type": "article"},
    {"type": "blog"}
  ]
}
```

### Nested Fields

Access nested object fields using dot notation:

```json
{"user.profile.country": "US"}
```

### Filter Examples

**Find tech articles with high score:**
```json
{
  "$and": [
    {"category": "tech"},
    {"score": {"$gte": 0.8}}
  ]
}
```

**Find documents from specific authors:**
```json
{"author": {"$in": ["Alice", "Bob", "Charlie"]}}
```

**Find recent documents with keyword:**
```json
{
  "timestamp": {"$gt": "2024-01-01"},
  "title": {"$contains": "machine learning"}
}
```

### Get
Get a vector by its ID.

### Delete Vector
Delete a vector by its ID.

### Save to File
Save the database to a JSON file.

### Load from File
Load a database from a JSON file.

### Get Info
Get database information and statistics.

### List Databases
List all databases in memory.

### Clear Database
Remove all vectors from the database.

### Delete Database
Remove a database from memory.

## Example Workflow

### Basic RAG with OpenAI

```
[Trigger]
    |
[OpenAI Embeddings] -> [Minimemory: Insert Many]
    |
[Query Input]
    |
[OpenAI Embeddings] -> [Minimemory: Search] -> [OpenAI Chat]
    |
[Response]
```

### Step by step:

1. **Create DB** (run once):
   - Operation: `Create Database`
   - Database Name: `docs`
   - Dimensions: `1536` (OpenAI)
   - Distance: `cosine`

2. **Index documents**:
   - Connect node that generates embeddings
   - Operation: `Insert Many`
   - ID Field: `id`
   - Vector Field: `embedding`

3. **Search**:
   - Connect query with embedding
   - Operation: `Search`
   - Query Vector: `{{ $json.embedding }}`
   - K: `5`

## Persistence

Databases live in memory while n8n is running. To persist:

```
[Startup Trigger] -> [Minimemory: Load from File]
                           |
                    (DB available for use)
                           |
[Before shutdown] -> [Minimemory: Save to File]
```

## Embedding Compatibility

| Model | Dimensions | Notes |
|-------|------------|-------|
| all-MiniLM-L6-v2 | 384 | Fast, good for short text |
| all-mpnet-base-v2 | 768 | Better quality |
| text-embedding-ada-002 | 1536 | OpenAI legacy |
| text-embedding-3-small | 1536 | OpenAI new |
| text-embedding-3-large | 3072 | OpenAI high quality |
| embed-english-v3.0 | 1024 | Cohere |

## Performance

- **Flat Index**: O(n) - Exact, ideal for < 10,000 vectors
- **HNSW Index**: O(log n) - Approximate, for large datasets

## Troubleshooting

### "Database not found"
Make sure to run `Create Database` or `Load from File` first.

### "Dimension mismatch"
The inserted/searched vector has a different number of dimensions than the DB.

### Node doesn't appear
1. Verify `npm run build` completed without errors
2. Check the link with `npm ls -g --link`
3. Restart n8n

## Support

For issues and feature requests, please visit:
https://github.com/MauricioPerera/n8n-nodes-minimemory/issues

## License

MIT
